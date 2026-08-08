"""Parse SMART.json once and expose per-station berth counts.

Each SMART BERTHDATA record describes a berth step (FROMBERTH → TOBERTH) at
a station (STANME / STANOX).  The number of unique FROMBERTH values recorded
for a station is a reliable proxy for the number of independently-signalled
track circuits (= platform/loop berths) available to a train.  This matches
the original milp_v2 analysis which found ~15 berths at Warrington BQ, ~6 at
Acton Bridge, ~5 at Winsford, etc.
"""
from __future__ import annotations

import json
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

# smart_berths.py lives at  backend/app/services/smart_berths.py
# parents[2] = backend/
SMART_PATH = Path(__file__).resolve().parents[2] / "data" / "SMART.json"


@lru_cache(maxsize=1)
def _raw() -> list[dict]:
    try:
        return json.loads(SMART_PATH.read_text(encoding="utf-8")).get("BERTHDATA", [])
    except Exception:
        return []


@lru_cache(maxsize=1)
def berths_by_stanme() -> dict[str, int]:
    """STANME (upper-cased) → number of unique FROMBERTH codes in SMART."""
    buckets: dict[str, set[str]] = defaultdict(set)
    for rec in _raw():
        sm = rec.get("STANME", "").strip().upper()
        fb = rec.get("FROMBERTH", "").strip()
        if sm and fb:
            buckets[sm].add(fb)
    return {k: len(v) for k, v in buckets.items()}


@lru_cache(maxsize=1)
def berths_by_stanox() -> dict[str, int]:
    """STANOX → number of unique FROMBERTH codes in SMART."""
    buckets: dict[str, set[str]] = defaultdict(set)
    for rec in _raw():
        sx = rec.get("STANOX", "").strip()
        fb = rec.get("FROMBERTH", "").strip()
        if sx and fb:
            buckets[sx].add(fb)
    return {k: len(v) for k, v in buckets.items()}


def lookup_berths(stanox: str, stanme: str, fallback: int = 6) -> int:
    """Return berth count for a station, preferring STANOX match."""
    by_sx = berths_by_stanox()
    if stanox and stanox in by_sx:
        return by_sx[stanox]
    by_sm = berths_by_stanme()
    key = (stanme or "").strip().upper()
    if key and key in by_sm:
        return by_sm[key]
    return fallback


def corridor_berths(stations: list[dict], fallback: int = 6) -> dict[int, int]:
    """Return {seq: n_berths} for a list of corridor station dicts."""
    return {
        int(s.get("seq", i)): lookup_berths(
            str(s.get("stanox", "") or ""),
            str(s.get("stanme", "") or ""),
            fallback,
        )
        for i, s in enumerate(stations)
    }
