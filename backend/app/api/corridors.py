"""Corridor library - built-in station chains from data/corridors.json
plus user-defined corridors stored in SQLite."""
from __future__ import annotations

import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.db import get_session
from app.models.corridor import UserCorridor

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "corridors.json"

router = APIRouter(prefix="/corridors", tags=["corridors"])


def _builtins() -> dict:
    with DATA_FILE.open(encoding="utf-8") as fh:
        return json.load(fh)


def _summary(c: dict, kind: str) -> dict:
    return {"id":          c["id"],
            "name":        c["name"],
            "description": c.get("description", ""),
            "km_length":   c.get("km_length", 0),
            "n_stations":  len(c.get("stations", [])),
            "kind":        kind}


def _slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s.strip().lower()).strip("_")
    return s or "corridor"


def _haversine_km(a: dict, b: dict) -> float:
    if None in (a.get("lat"), a.get("lon"), b.get("lat"), b.get("lon")):
        return 0.0
    lat1, lon1 = math.radians(a["lat"]), math.radians(a["lon"])
    lat2, lon2 = math.radians(b["lat"]), math.radians(b["lon"])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _annotate_chainage(stations: list[dict]) -> list[dict]:
    """Assign seq, chainage_km via haversine along the ordered station list."""
    total = 0.0
    out = []
    prev = None
    for i, s in enumerate(stations):
        if prev is not None:
            total += _haversine_km(prev, s)
        out.append({**s, "seq": i, "chainage_km": round(total, 3)})
        prev = s
    return out


def _user_to_public(row: UserCorridor) -> dict:
    return {"id":          row.slug,
            "name":        row.name,
            "description": row.description,
            "km_length":   (row.stations[-1]["chainage_km"]
                            if row.stations else 0),
            "stations":    row.stations,
            "kind":        "user",
            "created_at":  row.created_at.isoformat(),
            "updated_at":  row.updated_at.isoformat()}


# ── List / Get ───────────────────────────────────────────────────────────────
@router.get("/")
def list_corridors(session: Session = Depends(get_session)):
    result = [_summary(c, "builtin") for c in _builtins().values()]
    for row in session.exec(select(UserCorridor)
                            .order_by(UserCorridor.created_at.desc())).all():
        result.append(_summary(_user_to_public(row), "user"))
    return result


@router.get("/{corridor_id}")
def get_corridor(corridor_id: str,
                 session: Session = Depends(get_session)):
    b = _builtins()
    if corridor_id in b:
        return {**b[corridor_id], "kind": "builtin"}
    row = session.exec(select(UserCorridor)
                        .where(UserCorridor.slug == corridor_id)).first()
    if row is not None:
        return _user_to_public(row)
    raise HTTPException(404, f"corridor {corridor_id} not found")


# ── Create / Update / Delete (user corridors only) ───────────────────────────
class CorridorIn(BaseModel):
    name: str
    description: str = ""
    stations: list[dict]     # each with name, tiploc, crs, stanox, stanme, lat, lon


@router.post("/")
def create_corridor(payload: CorridorIn,
                    session: Session = Depends(get_session)):
    if not payload.name.strip():
        raise HTTPException(400, "name required")
    if len(payload.stations) < 2:
        raise HTTPException(400, "at least 2 stations required")
    slug = _slugify(payload.name)
    # Ensure slug is unique across builtins + user table
    if slug in _builtins():
        slug += "_user"
    existing = session.exec(select(UserCorridor)
                             .where(UserCorridor.slug == slug)).first()
    if existing is not None:
        i = 2
        while session.exec(select(UserCorridor)
                            .where(UserCorridor.slug == f"{slug}_{i}")).first():
            i += 1
        slug = f"{slug}_{i}"
    stations = _annotate_chainage(payload.stations)
    row = UserCorridor(slug=slug, name=payload.name.strip(),
                       description=payload.description.strip(),
                       stations=stations)
    session.add(row); session.commit(); session.refresh(row)
    return _user_to_public(row)


@router.patch("/{corridor_id}")
def update_corridor(corridor_id: str, payload: CorridorIn,
                    session: Session = Depends(get_session)):
    if corridor_id in _builtins():
        raise HTTPException(400, "built-in corridors are read-only")
    row = session.exec(select(UserCorridor)
                        .where(UserCorridor.slug == corridor_id)).first()
    if row is None:
        raise HTTPException(404, "corridor not found")
    if len(payload.stations) < 2:
        raise HTTPException(400, "at least 2 stations required")
    row.name = payload.name.strip()
    row.description = payload.description.strip()
    row.stations = _annotate_chainage(payload.stations)
    row.updated_at = datetime.utcnow()
    session.add(row); session.commit(); session.refresh(row)
    return _user_to_public(row)


@router.delete("/{corridor_id}")
def delete_corridor(corridor_id: str,
                    session: Session = Depends(get_session)):
    if corridor_id in _builtins():
        raise HTTPException(400, "built-in corridors cannot be deleted")
    row = session.exec(select(UserCorridor)
                        .where(UserCorridor.slug == corridor_id)).first()
    if row is None:
        raise HTTPException(404, "corridor not found")
    session.delete(row); session.commit()
    return {"deleted": corridor_id}
