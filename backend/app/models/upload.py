"""Uploaded TD JSONL (or events CSV) file record."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class Upload(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    original_name: str
    stored_path: str
    kind: str = Field(default="td_jsonl")   # td_jsonl | events_csv | baseline_csv
    date_tag: str | None = None             # e.g. 2018-04-25
    size_bytes: int
    # Dates detected inside the file (populated by /uploads/{id}/scan)
    available_dates: list[str] = Field(default_factory=list,
                                        sa_column=Column(JSON))
    uploaded_at: datetime = Field(default_factory=_now_utc)
