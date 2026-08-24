"""A MILP run - one solve of the corridor capacity problem."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


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

    # Which analytical model to run
    model_type: str = Field(default="capacity")   # capacity | diversion

    # Capacity model input (existing)
    baseline_upload_id: int | None = Field(default=None,
                                            foreign_key="upload.id")

    # Diversion model inputs (new)
    source_upload_id: int | None = Field(default=None,
                                          foreign_key="upload.id")
    # Multi-file diversion input.  If non-empty, this comma-separated
    # list of Upload IDs is used instead of the singular source_upload_id
    # (all listed files are concatenated at extract time).
    source_upload_ids: str = Field(default="")
    target_upload_id: int | None = Field(default=None,
                                          foreign_key="upload.id")
    source_corridor_id: str | None = Field(default=None)
    target_corridor_id: str | None = Field(default=None)
    # Comma-separated list of headcode class digits (0-9). e.g. "4" or "4,6"
    # or "1,2,4,6" for passenger + freight together.
    class_filter: str | None = Field(default=None)
    # Diversion flex window (± minutes around each divertible's original
    # source departure). Capacity mode ignores this.
    flex_min: int = 60
    # Berth / platform slots available per station per 15-min window on the
    # TARGET corridor.  The original SMART analysis found 3-15 slow berths per
    # station on the WCML; the default of 6 reflects a conservative mid-range.
    # Increase for busier multi-berth stations; decrease for single-track loops.
    n_berths: int = 6
    # Divertibility rule tunables
    endpoint_strictness: str = Field(default="relaxed")   # relaxed | strict
    excluded_terminals: str = Field(default="")           # comma-separated stanmes / tiplocs

    # Result fields — capacity model
    up_inserted: int | None = None
    down_inserted: int | None = None
    total_dwell_min: int | None = None
    blocks_hit_time_limit: int | None = None
    wall_solve_time_s: float | None = None
    result_dir: str | None = None        # path under runs/<id>/
    error: str | None = None

    # Result fields — diversion model
    divertible_total: int | None = None
    div_placed: int | None = None
    div_rescheduled: int | None = None
    div_conflict: int | None = None
    div_placed_pct: float | None = None
    div_mean_abs_shift_min: float | None = None
    div_objective_value: float | None = None
    div_solver_status: str | None = None

    # User-defined SRT profile for generic corridors.  JSON string encoding
    # a list of segment dicts: [{from_seq, to_seq, from_name, to_name,
    # srt_up, srt_down, eng_up, eng_down, loop_available, notes}].
    # When set, _run_generic_capacity skips derive_srt.py and writes this
    # directly as srt_profile.csv so the MILP uses the user-supplied values.
    srt_json: str | None = None

    created_at: datetime = Field(default_factory=_now_utc)
    started_at: datetime | None = None
    completed_at: datetime | None = None
