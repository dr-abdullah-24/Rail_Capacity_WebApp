"""A MILP run - one solve of the corridor capacity problem."""
from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel


class Run(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    status: str = Field(default="pending")  # pending | running | complete | failed
    date_tag: str | None = None
    traction: str = Field(default="c6")     # c4 | c6
    headway_min: int = 3
    dwell_max: int = 30
    block_hours: int = 4
    time_limit_per_block: int = 180

    # Optional operational-hours window. When enabled, candidates whose
    # hour falls outside [start_hour, end_hour) are dropped.  Default off
    # matches STEER (which considered all 24 hours).
    operating_hours_enabled: bool = False
    operating_start_hour: int = 5    # inclusive
    operating_end_hour:   int = 24   # exclusive

    baseline_upload_id: int | None = Field(default=None,
                                            foreign_key="upload.id")

    # Result fields (populated on complete)
    nb_inserted: int | None = None
    sb_inserted: int | None = None
    total_dwell_min: int | None = None
    blocks_hit_time_limit: int | None = None
    wall_solve_time_s: float | None = None
    result_dir: str | None = None        # path under runs/<id>/
    error: str | None = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None
