"""
derive_srt.py
=============
Derive a Sectional Running Time (SRT) profile CSV from observed baseline
traffic for any corridor.

Algorithm:
  • Group baseline rows by (headcode, journey_num, direction).
  • Sort each group by t_min ascending (journey order).
  • For each consecutive pair of adjacent junction-seq rows, record the
    travel-time delta as an observation for that direction.
  • Per segment (from_seq, to_seq), the SRT is the PCTILE-th percentile
    of observed times (requires MIN_OBS observations; otherwise falls
    back to a chainage-speed estimate).

Output CSV columns match srt_profile.csv so capacity_gap_milp.py can
consume it without modification:
  from_seq, to_seq, from_name, to_name,
  srt_min_northbound, srt_min_southbound,
  eng_alw_nb_min, eng_alw_sb_min,
  loop_available, notes
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path


MIN_OBS            = 3      # minimum observations to trust percentile
PCTILE             = 10     # 10th-percentile → minimum feasible time
FREIGHT_SPEED_KMPH = 80.0   # fallback speed for chainage-based estimate
MAX_PLAUSIBLE_MIN  = 120    # discard inter-junction deltas above this
LOOP_THRESHOLD_KM  = 5.0    # segments >= this length are assumed to have a
                             # passing loop. Raised from 3.0 to 5.0 km to
                             # reduce false-positive loop assignments.
                             # Validate against NWR Sectional Appendix.
MIN_SRT_MIN        = 2      # physical minimum SRT per segment (acceleration
                             # + braking floor for a heavy freight train)
EA_PCT             = 0.05   # TPR engineering allowance: 5% of SRT, min 1 min


def _percentile(vals: list[int], p: int) -> int:
    vals = sorted(vals)
    n = len(vals)
    idx = (p / 100) * (n - 1)
    lo, hi = math.floor(idx), math.ceil(idx)
    if lo == hi:
        return vals[lo]
    return int(vals[lo] + (idx - lo) * (vals[hi] - vals[lo]))


def derive(baseline_csv: Path, corridor: dict, out_srt: Path,
           use_loop_heuristic: bool = True) -> None:
    stations = sorted(corridor.get("stations", []), key=lambda s: int(s["seq"]))
    n = len(stations)
    seq_to_name: dict[int, str] = {
        int(s["seq"]): s.get("name", str(s["seq"])) for s in stations
    }
    seq_to_km: dict[int, float] = {
        int(s["seq"]): float(s.get("chainage_km", 0)) for s in stations
    }

    # (canonical_from_seq, to_seq) where from < to → {NB: [...], SB: [...]}
    nb_obs: dict[tuple[int, int], list[int]] = defaultdict(list)
    sb_obs: dict[tuple[int, int], list[int]] = defaultdict(list)

    grouped: dict[tuple, list[dict]] = defaultdict(list)
    with baseline_csv.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            key = (r["headcode"], r["journey_num"], r["direction"])
            grouped[key].append({
                "seq":   int(r["junction_seq"]),
                "t_min": int(r["t_min"]),
            })

    for (hc, jn, dirn), rows in grouped.items():
        rows.sort(key=lambda r: r["t_min"])
        for row_a, row_b in zip(rows[:-1], rows[1:]):
            sa, sb_seq = row_a["seq"], row_b["seq"]
            if abs(sa - sb_seq) != 1:
                continue  # not physically adjacent junctions
            delta = row_b["t_min"] - row_a["t_min"]
            if delta <= 0 or delta > MAX_PLAUSIBLE_MIN:
                continue  # implausible crossing or wrap
            canonical = (min(sa, sb_seq), max(sa, sb_seq))
            if dirn == "northbound":
                nb_obs[canonical].append(delta)
            else:
                sb_obs[canonical].append(delta)

    rows_out = []
    for i in range(n - 1):
        f_seq = int(stations[i]["seq"])
        t_seq = int(stations[i + 1]["seq"])
        canonical = (min(f_seq, t_seq), max(f_seq, t_seq))
        km_span = abs(seq_to_km.get(t_seq, 0) - seq_to_km.get(f_seq, 0))
        fallback = max(MIN_SRT_MIN, round(km_span / (FREIGHT_SPEED_KMPH / 60)))

        nb_list = nb_obs.get(canonical, [])
        sb_list = sb_obs.get(canonical, [])
        srt_nb = max(MIN_SRT_MIN, _percentile(nb_list, PCTILE) if len(nb_list) >= MIN_OBS
                     else fallback)
        srt_sb = max(MIN_SRT_MIN, _percentile(sb_list, PCTILE) if len(sb_list) >= MIN_OBS
                     else fallback)

        # Heuristic loop detection: UK passing loops are installed on longer
        # sections where overtaking provides an operational benefit.  Segments
        # ≥ LOOP_THRESHOLD_KM are assumed to have a loop available so the MILP
        # can use dwell manoeuvres to resolve conflicts on those sections.
        loop = 0
        if use_loop_heuristic and km_span >= LOOP_THRESHOLD_KM:
            loop = 1

        is_fallback = len(nb_list) < MIN_OBS or len(sb_list) < MIN_OBS
        note = (
            f"nb_obs={len(nb_list)} sb_obs={len(sb_list)}"
            + (" fallback" if is_fallback else "")
            + (f" loop_heuristic={km_span:.1f}km" if loop else "")
        )
        print(f"  seg ({f_seq},{t_seq}) NB={srt_nb}m (n={len(nb_list)})"
              f"  SB={srt_sb}m (n={len(sb_list)})"
              f"  km={km_span:.1f}  loop={loop}", flush=True)
        ea_nb = max(1, round(srt_nb * EA_PCT))
        ea_sb = max(1, round(srt_sb * EA_PCT))
        rows_out.append({
            "from_seq":            f_seq,
            "to_seq":              t_seq,
            "from_name":           seq_to_name.get(f_seq, str(f_seq)),
            "to_name":             seq_to_name.get(t_seq, str(t_seq)),
            "srt_min_northbound":  srt_nb,
            "srt_min_southbound":  srt_sb,
            "eng_alw_nb_min":      ea_nb,
            "eng_alw_sb_min":      ea_sb,
            "loop_available":      loop,
            "notes":               note,
        })

    out_srt.parent.mkdir(parents=True, exist_ok=True)
    with out_srt.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "from_seq", "to_seq", "from_name", "to_name",
            "srt_min_northbound", "srt_min_southbound",
            "eng_alw_nb_min", "eng_alw_sb_min",
            "loop_available", "notes",
        ])
        w.writeheader()
        w.writerows(rows_out)
    print(f"[srt] wrote {out_srt.name}  ({len(rows_out)} segments)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline",  required=True)
    ap.add_argument("--corridor",  required=True)
    ap.add_argument("--out",       required=True)
    ap.add_argument("--no-loops",  action="store_true",
                    help="disable the chainage-based loop-availability heuristic "
                         "(all loop_available=0; conservative, no dwells allowed)")
    args = ap.parse_args()
    corridor = json.loads(Path(args.corridor).read_text(encoding="utf-8"))
    derive(Path(args.baseline), corridor, Path(args.out),
           use_loop_heuristic=not args.no_loops)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
