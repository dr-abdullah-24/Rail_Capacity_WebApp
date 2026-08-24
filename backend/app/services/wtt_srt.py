"""WTT-based Sectional Running Time lookup.

Loads wtt_data.json once (lazily, on first call) and builds an in-memory
index of freight inter-station running times derived from real Working
Timetable paths.  The SRT preview endpoint uses this in preference to the
formulaic chainage estimate whenever enough observations are available.

Index structure
---------------
seg_times[(a_wtt_idx, b_wtt_idx)] = [delta_minutes, ...]

  a→b  means a's timetabled time was earlier than b's in the same service
       (i.e. the train ran FROM a TO b in that direction).

For a corridor with stations ordered seq 0..N:
  NB SRT for segment (f, t): seg_times[(wtt_idx_f, wtt_idx_t)]
  SB SRT for segment (f, t): seg_times[(wtt_idx_t, wtt_idx_f)]
"""
from __future__ import annotations

import json
import math
import threading
from collections import defaultdict
from pathlib import Path

WTT_PATH = Path(__file__).resolve().parents[2] / "data" / "wtt_data.json"

# Only 4xxx (intermodal) and 6xxx (heavy freight) are used for SRT derivation.
FREIGHT_DIGITS = frozenset("46")

# Require at least this many observations to trust the WTT-derived p10.
MIN_OBS = 5

# Percentile to use as the SRT (minimum technically feasible time).
PCTILE = 10

_cache: dict | None = None
_lock = threading.Lock()


# ── Internal helpers ─────────────────────────────────────────────────────────

def _parse_stop_time(stop: list) -> int | None:
    """Return minute-of-day from a WTT stop record, or None."""
    def _hhmm(s: str) -> int | None:
        try:
            h, m = str(s).split(":")
            return int(h) * 60 + int(m)
        except Exception:
            return None

    # Record formats (determined by position):
    #   [loc, ?, arr]           – terminus arrival
    #   [loc, ?, arr, dep]      – stopping call (dep preferred)
    #   [loc, ?, ?, ?, pass]    – passing without stopping
    if len(stop) >= 4 and stop[3] and ":" in str(stop[3]):
        return _hhmm(stop[3])        # departure
    if len(stop) >= 3 and stop[2] and ":" in str(stop[2]):
        return _hhmm(stop[2])        # arrival
    if len(stop) >= 5 and stop[4] and ":" in str(stop[4]):
        return _hhmm(stop[4])        # pass
    return None


def _percentile(vals: list[int], p: int) -> float:
    vals = sorted(vals)
    n = len(vals)
    idx = (p / 100) * (n - 1)
    lo, hi = math.floor(idx), math.ceil(idx)
    if lo == hi:
        return float(vals[lo])
    return vals[lo] + (idx - lo) * (vals[hi] - vals[lo])


def _norm(name: str) -> str:
    """Normalise a location name for fuzzy matching."""
    import re
    # Strip parenthetical suffixes like "(Coal Yard / CS)" or "(London)"
    name = re.sub(r"\s*\(.*?\)", "", name)
    return (
        name.upper()
        .replace("JUNCTION", "JN")
        .replace("JUNCTN", "JN")
        .replace("  ", " ")
        .strip()
    )


# ── Public API ────────────────────────────────────────────────────────────────

def load() -> dict:
    """Return (and cache) the WTT index.  Thread-safe, loads once."""
    global _cache
    if _cache is not None:
        return _cache
    with _lock:
        if _cache is not None:   # double-checked
            return _cache
        if not WTT_PATH.exists():
            _cache = {"locs": [], "seg": {}}
            return _cache

        with WTT_PATH.open(encoding="utf-8") as fh:
            raw = json.load(fh)

        locs: list[str] = raw["locs"]
        svcs: list[dict] = raw["svcs"]

        seg_times: dict[tuple, list[int]] = defaultdict(list)

        for svc in svcs:
            if svc.get("h", "")[:1] not in FREIGHT_DIGITS:
                continue
            # Build a deduplicated {loc_idx: minute} map for this service.
            seen: dict[int, int] = {}
            for stop in svc.get("s", []):
                idx = stop[0]
                t = _parse_stop_time(stop)
                if t is not None and idx not in seen:
                    seen[idx] = t

            # Record consecutive-stop deltas (a→b = forward direction).
            ordered = sorted(seen.items(), key=lambda x: x[1])
            for (a_idx, a_t), (b_idx, b_t) in zip(ordered[:-1], ordered[1:]):
                delta = b_t - a_t
                if 0 < delta <= 90:
                    seg_times[(a_idx, b_idx)].append(delta)

        # Build normalised name → wtt_idx lookup
        name_to_idx: dict[str, int] = {_norm(n): i for i, n in enumerate(locs)}

        _cache = {
            "locs":       locs,
            "seg":        dict(seg_times),
            "name_to_idx": name_to_idx,
        }
        return _cache


def find_wtt_idx(station_name: str) -> int | None:
    """Map a corridor station name to a WTT location index, or None."""
    import re
    wtt = load()
    name_to_idx: dict[str, int] = wtt["name_to_idx"]

    # Extract parenthetical keywords before normalising — they often disambiguate
    # a generic place name (e.g. "Crewe (Coal Yard / CS)" → base="CREWE",
    # paren_words=["COAL","YARD"] → prefer "CREWE COAL YARD" over "CREWE").
    paren_match = re.search(r"\(([^)]+)\)", station_name)
    paren_words: list[str] = []
    if paren_match:
        paren_words = [
            w for w in re.split(r"[\s/,]+", paren_match.group(1).upper())
            if len(w) > 2
        ]

    n = _norm(station_name)  # strips parenthetical, normalises JUNCTION→JN etc.

    # 1. If the name had parenthetical content, find the WTT entry whose name
    #    contains both the base name and all parenthetical keywords.  This
    #    avoids "Crewe (Coal Yard)" collapsing to the generic "CREWE" match.
    if paren_words:
        base = n  # already stripped of parenthetical by _norm
        for wname, widx in name_to_idx.items():
            if base in wname and all(pw in wname for pw in paren_words):
                return widx

    # 2. Exact match after normalisation.
    if n in name_to_idx:
        return name_to_idx[n]

    # 3. Strip common suffixes and retry.
    for suffix in (" JN", " JCN", " STATION", " STN", " HL", " LL"):
        if n.endswith(suffix):
            stripped = n[: -len(suffix)].strip()
            if stripped in name_to_idx:
                return name_to_idx[stripped]

    # 4. All significant words present in a WTT name.
    words = [w for w in n.split() if len(w) > 3]
    if words:
        for wname, widx in name_to_idx.items():
            if all(w in wname for w in words):
                return widx

    return None


def get_wtt_idx_pair(from_name: str, to_name: str) -> tuple[int | None, int | None]:
    """Return (a_idx, b_idx) WTT indices for two station names."""
    return find_wtt_idx(from_name), find_wtt_idx(to_name)


def get_segment_srt(
    from_name: str,
    to_name: str,
    min_obs: int = MIN_OBS,
    km_ratio: float | None = None,
) -> dict | None:
    """Return WTT-derived SRT for a corridor segment, or None.

    Parameters
    ----------
    from_name, to_name : str
        Corridor station names.
    min_obs : int
        Minimum observations required to use WTT data.
    km_ratio : float | None
        If provided (0 < ratio < 1), this segment is a sub-section of a
        longer WTT timing pair.  The WTT times are scaled by km_ratio so
        that consecutive sub-segments sum to the full inter-station time.
    """
    """Return WTT-derived SRT for a corridor segment, or None if insufficient data.

    Returns a dict with keys:
        srt_nb   – 10th-percentile NB running time (int minutes)
        srt_sb   – 10th-percentile SB running time (int minutes)
        n_nb     – number of NB freight observations
        n_sb     – number of SB freight observations
        source   – "wtt"
    """
    wtt = load()
    seg: dict = wtt["seg"]

    a_idx = find_wtt_idx(from_name)
    b_idx = find_wtt_idx(to_name)

    if a_idx is None or b_idx is None:
        return None

    # NB = trains that visited `from` before `to`
    # SB = trains that visited `to` before `from`
    times_nb = seg.get((a_idx, b_idx), [])
    times_sb = seg.get((b_idx, a_idx), [])

    if len(times_nb) < min_obs and len(times_sb) < min_obs:
        return None

    ratio = km_ratio if (km_ratio and 0 < km_ratio < 1) else 1.0

    def _srt(times: list[int]) -> int | None:
        if len(times) < min_obs:
            return None
        raw = _percentile(times, PCTILE) * ratio
        return max(1, round(raw))

    srt_nb = _srt(times_nb)
    srt_sb = _srt(times_sb)

    return {
        "srt_nb": srt_nb,
        "srt_sb": srt_sb,
        "n_nb":   len(times_nb),
        "n_sb":   len(times_sb),
        "source": "wtt" if ratio == 1.0 else "wtt-scaled",
    }
