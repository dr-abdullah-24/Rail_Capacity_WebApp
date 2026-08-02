"""Search index over the RailInsights berths-geo dataset.

berths-geo.json ships as a positional-array file with a schema header.
We load it once at startup, normalise into per-location records
(deduplicated by (station, tiploc, crs, stanox, lat, lon)) and expose a
scored search API used by the frontend corridor builder.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from app.core.config import settings


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


@lru_cache(maxsize=1)
def _load_locations() -> list[dict]:
    path: Path = settings.berths_geo
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    schema: list[str] = data["schema"]
    idx = {name: i for i, name in enumerate(schema)}
    seen: dict[tuple, dict] = {}
    for row in data["records"]:
        loc_name = str(row[idx["locationName"]] or "").strip()
        tiploc   = str(row[idx["tiploc"]]       or "").strip()
        crs      = str(row[idx["crs"]]          or "").strip()
        stanox   = str(row[idx["stanox"]]       or "").strip()
        station  = str(row[idx["station"]]      or "").strip()
        lat = row[idx["latitude"]]
        lon = row[idx["longitude"]]
        try:
            lat = float(lat) if lat not in (None, "", " ") else None
            lon = float(lon) if lon not in (None, "", " ") else None
        except (TypeError, ValueError):
            lat = lon = None
        # Deduplicate: aggregate by (tiploc, stanox); prefer records with coords
        key = (tiploc, stanox, station)
        if key in seen and seen[key]["lat"] is not None:
            continue
        if not (loc_name or station or tiploc or crs):
            continue
        seen[key] = {
            "name":    loc_name or station,
            "station": station,
            "tiploc":  tiploc,
            "crs":     crs,
            "stanox":  stanox,
            "stanme":  station,
            "lat":     lat,
            "lon":     lon,
        }
    return list(seen.values())


def _score(row: dict, raw: str, tokens: list[str]) -> int:
    q  = _norm(raw)
    qc = _compact(raw)
    name_n = _norm(row["name"])
    fields = _norm(" ".join([row["name"], row["station"], row["tiploc"],
                              row["crs"], row["stanox"]]))
    if not all(tok in fields for tok in tokens):
        return -1
    score = 0
    if name_n == q:                    score += 100
    if name_n.startswith(q):           score += 60
    if _compact(row["crs"])    == qc:  score += 70
    if _compact(row["tiploc"]) == qc:  score += 70
    if _compact(row["stanox"]) == qc:  score += 60
    if row["lat"] is not None:         score += 8
    return score


def search(query: str, limit: int = 25) -> list[dict]:
    query = (query or "").strip()
    if not query:
        return []
    rows = _load_locations()
    tokens = _norm(query).split()
    if not tokens:
        return []
    scored: list[tuple[int, dict]] = []
    for r in rows:
        s = _score(r, query, tokens)
        if s >= 0:
            scored.append((s, r))
    scored.sort(key=lambda t: (-t[0], t[1]["name"]))
    return [r for _, r in scored[:limit]]


def stats() -> dict:
    rows = _load_locations()
    with_geo = sum(1 for r in rows if r["lat"] is not None)
    return {"total": len(rows), "with_coords": with_geo,
            "source": str(settings.berths_geo),
            "available": settings.berths_geo.exists()}
