"""SRT preview endpoint.

Returns Sectional Running Times for a corridor.  Values come from three
sources, in priority order:

  1. WTT-derived (wtt_srt.py)
     Real Working Timetable freight paths from wtt_data.json.
     10th-percentile of observed inter-station times for 4xxx/6xxx services.
     Used when >= 5 observations are available for both directions.
     Direction-specific (NB ≠ SB from real traffic).

  2. Chainage formula (fallback)
     Effective average speed × track distance estimate.
     Applied per-segment when the WTT has insufficient freight paths.
     NB = SB (symmetric — user should adjust for gradients).

Engineering Allowances (EA) come from:
  - tpr_ea.json for stations specifically listed in NR Train Planning Rules
    (NW1001 WCML slow / NW2015 Chat Moss — sourced from TPR 2021 V4 LNW,
     confirmed unchanged in TPR 2026 V3 NWC and TPR 2027 V1 NWC).
  - Formula fallback (5 % of SRT, min 1 min) for all other segments.

The frontend displays all values as an editable table so the user can
override any cell against their Working Timetable before launching a run.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/srt", tags=["srt"])

# ── TPR EA lookup (loaded once) ───────────────────────────────────────────────

_TPR_EA_FILE = Path(__file__).resolve().parents[2] / "data" / "tpr_ea.json"
_tpr_ea: dict | None = None


def _load_tpr_ea() -> dict:
    global _tpr_ea
    if _tpr_ea is None:
        try:
            _tpr_ea = json.loads(_TPR_EA_FILE.read_text(encoding="utf-8"))
        except Exception:
            _tpr_ea = {"NB": {}, "SB": {}}
    return _tpr_ea


def _tpr_ea_for(station_name: str, direction: str) -> dict | None:
    """Return the TPR EA entry for *station_name* if it appears as an
    approach location in the given direction ('NB' or 'SB'), else None."""
    ea = _load_tpr_ea()
    return ea.get(direction, {}).get(station_name)


# ── Formula constants ─────────────────────────────────────────────────────────

# Maximum line speeds (mph) per UK TPR train class digit.
_MAX_SPEED_MPH: dict[str, float] = {
    "c0": 50,    # light locomotive / on-track machine
    "c1": 110,   # express passenger
    "c2": 75,    # ordinary / stopping passenger
    "c3": 75,    # empty coaching stock / parcels
    "c4": 75,    # freight 75 mph (intermodal)
    "c5": 60,    # empty freight
    "c6": 60,    # heavy freight 60 mph (Class 66 ~1400 t)
    "c7": 45,    # freight 45 mph
    "c8": 35,    # unfitted freight 35 mph
    "c9": 75,    # charter / special passenger
}

# 65 % of max speed approximates the effective average a freight train
# achieves once acceleration, braking, AHB crossings and signal checks
# are accounted for.  Calibrated against Crewe-Parkside WTT observations.
_SPEED_EFFICIENCY = 0.65

# User-corridor chainages are haversine-derived (straight-line).
# UK rail routes are typically 10-20 % longer; apply a correction factor.
# Not applied to built-in corridors which carry manually-set track chainages.
_TRACK_FACTOR_USER = 1.15

# TPR engineering allowance: 5 % of SRT, minimum 1 min per segment.
_EA_PCT     = 0.05
_MIN_EA_MIN = 1

# Physical minimum: a heavy freight train needs at least 2 min per segment.
_MIN_SRT_MIN = 2

# Segments >= this track-km are assumed likely to have a passing loop.
_LOOP_THRESHOLD_KM = 5.0


# ── Request model ─────────────────────────────────────────────────────────────

class SrtPreviewRequest(BaseModel):
    corridor_id: str
    traction: str = "c6"


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/preview")
def preview_srt(body: SrtPreviewRequest) -> list[dict]:
    """Return SRT segments for a corridor (WTT-derived where available,
    formulaic fallback otherwise).
    """
    from app.api.corridors import _builtins as builtin_corridors
    from app.services.wtt_srt import get_segment_srt
    from sqlmodel import Session, select
    from app.models.corridor import UserCorridor
    from app.core.db import engine

    builtins = builtin_corridors()
    is_builtin = body.corridor_id in builtins
    if is_builtin:
        corridor = builtins[body.corridor_id]
    else:
        with Session(engine) as s:
            row = s.exec(
                select(UserCorridor).where(UserCorridor.slug == body.corridor_id)
            ).first()
            if row is None:
                raise HTTPException(404, f"corridor '{body.corridor_id}' not found")
            corridor = {"stations": row.stations}

    stations = sorted(
        corridor.get("stations", []), key=lambda s: int(s["seq"])
    )
    if len(stations) < 2:
        raise HTTPException(400, "corridor needs at least 2 stations")

    # Formula parameters (used as fallback).
    max_mph    = _MAX_SPEED_MPH.get(body.traction, 60.0)
    eff_mph    = max_mph * _SPEED_EFFICIENCY
    eff_kmph   = eff_mph * 1.60934
    km_per_min = eff_kmph / 60.0
    track_factor = 1.0 if is_builtin else _TRACK_FACTOR_USER

    # Pre-compute all chainages for span-ratio lookups.
    km_list = [float(s.get("chainage_km", 0)) for s in stations]

    segments: list[dict] = []
    for i in range(len(stations) - 1):
        f = stations[i]
        t = stations[i + 1]

        f_name = f.get("name", str(f["seq"]))
        t_name = t.get("name", str(t["seq"]))

        km_chainage = abs(km_list[i + 1] - km_list[i])
        km_track = km_chainage * track_factor

        # ── Try WTT lookup first (direct segment) ────────────────────────
        wtt = get_segment_srt(f_name, t_name)

        # ── If no direct match, try spanning a skipped intermediate ──────
        # Some WTT timing-point pairs skip over corridor stations that
        # freight trains pass without a separate timetabled time (e.g.
        # Winsford → Hartford Jn skips Hartford station).  Walk outward
        # one station at a time to find a spanning WTT pair, then scale
        # the time by the chainage ratio of this sub-segment.
        if wtt is None:
            for span in range(2, min(4, len(stations) - i)):
                if i + span >= len(stations):
                    break
                outer = stations[i + span]
                outer_name = outer.get("name", str(outer["seq"]))
                km_outer = abs(
                    float(outer.get("chainage_km", 0)) - km_list[i]
                ) * track_factor
                if km_outer <= 0:
                    continue
                ratio = km_track / km_outer
                candidate = get_segment_srt(f_name, outer_name, km_ratio=ratio)
                if candidate:
                    wtt = candidate
                    wtt["_span_to"] = outer_name
                    break

        # ── Compute EA (Engineering Allowance) ───────────────────────────
        # TPR-sourced values take priority over the 5 % formula for the
        # specific approach locations listed in tpr_ea.json.
        tpr_nb = _tpr_ea_for(t_name, "NB")
        tpr_sb = _tpr_ea_for(t_name, "SB")

        def _ea(srt_val: int, tpr_entry: dict | None) -> tuple[int, str]:
            """Return (ea_minutes, source_note)."""
            if tpr_entry:
                return tpr_entry["ea_min"], f"TPR ({tpr_entry['tpr_ref']})"
            return max(_MIN_EA_MIN, round(srt_val * _EA_PCT)), "formula (5% min 1 min)"

        if wtt and wtt["srt_nb"] is not None and wtt["srt_sb"] is not None:
            srt_nb = max(_MIN_SRT_MIN, wtt["srt_nb"])
            srt_sb = max(_MIN_SRT_MIN, wtt["srt_sb"])
            ea_nb, ea_nb_src = _ea(srt_nb, tpr_nb)
            ea_sb, ea_sb_src = _ea(srt_sb, tpr_sb)
            loop   = 1 if km_track >= _LOOP_THRESHOLD_KM else 0
            span_note = (
                f" (scaled from WTT pair {f_name}-{wtt['_span_to']})"
                if "_span_to" in wtt else ""
            )
            note   = (
                f"WTT freight p10{span_note}: NB {srt_nb} min (n={wtt['n_nb']}), "
                f"SB {srt_sb} min (n={wtt['n_sb']}). "
                f"EA NB={ea_nb} min [{ea_nb_src}], SB={ea_sb} min [{ea_sb_src}]. "
                f"Source: wtt_data.json 4xxx/6xxx services."
            )

        elif wtt and (wtt["srt_nb"] is not None or wtt["srt_sb"] is not None):
            # One direction from WTT, other from formula.
            formula_srt = max(_MIN_SRT_MIN, round(km_track / km_per_min))
            srt_nb = max(_MIN_SRT_MIN, wtt["srt_nb"]) if wtt["srt_nb"] else formula_srt
            srt_sb = max(_MIN_SRT_MIN, wtt["srt_sb"]) if wtt["srt_sb"] else formula_srt
            ea_nb, ea_nb_src = _ea(srt_nb, tpr_nb)
            ea_sb, ea_sb_src = _ea(srt_sb, tpr_sb)
            loop   = 1 if km_track >= _LOOP_THRESHOLD_KM else 0
            span_note = (
                f" (scaled from WTT pair {f_name}-{wtt['_span_to']})"
                if "_span_to" in wtt else ""
            )
            note   = (
                f"WTT partial{span_note}: NB n={wtt['n_nb']}, SB n={wtt['n_sb']}. "
                f"Direction(s) with <5 obs use formula fallback "
                f"({max_mph:.0f} mph × {int(_SPEED_EFFICIENCY*100)}% = "
                f"{eff_mph:.0f} mph eff, ~{km_track:.1f} km track). "
                f"EA NB={ea_nb} min [{ea_nb_src}], SB={ea_sb} min [{ea_sb_src}]."
            )

        else:
            # ── Formula fallback ──────────────────────────────────────────
            formula_srt = max(_MIN_SRT_MIN, round(km_track / km_per_min))
            srt_nb = formula_srt
            srt_sb = formula_srt
            ea_nb, ea_nb_src = _ea(srt_nb, tpr_nb)
            ea_sb, ea_sb_src = _ea(srt_sb, tpr_sb)
            loop   = 1 if km_track >= _LOOP_THRESHOLD_KM else 0
            dist_str = (
                f"{km_chainage:.1f} km haversine × {_TRACK_FACTOR_USER} "
                f"= {km_track:.1f} km track"
                if not is_builtin
                else f"{km_chainage:.1f} km (track chainage)"
            )
            note = (
                f"No WTT freight data for this segment. "
                f"Formula: {dist_str}; "
                f"{max_mph:.0f} mph max × {int(_SPEED_EFFICIENCY*100)}% "
                f"= {eff_mph:.0f} mph eff ({eff_kmph:.0f} km/h); "
                f"SRT {formula_srt} min. "
                f"EA NB={ea_nb} min [{ea_nb_src}], SB={ea_sb} min [{ea_sb_src}]. "
                f"NB=SB: adjust for route gradients against WTT."
            )

        segments.append({
            "from_seq":       int(f["seq"]),
            "to_seq":         int(t["seq"]),
            "from_name":      f_name,
            "to_name":        t_name,
            "srt_nb":         srt_nb,
            "srt_sb":         srt_sb,
            "eng_nb":         ea_nb,
            "eng_sb":         ea_sb,
            "loop_available": loop,
            "notes":          note,
        })

    return segments
