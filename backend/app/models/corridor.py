"""User-defined corridor stored in SQLite. Predefined corridors continue
to live in the shipped JSON file and are read-only."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class UserCorridor(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    slug: str = Field(index=True, unique=True)     # e.g. crewe_manchester_v1
    name: str
    description: str = ""
    # Each station: {seq, name, tiploc, crs, stanox, stanme, lat, lon,
    #                chainage_km (0 for user corridors)}
    stations: list[dict] = Field(default_factory=list,
                                  sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
