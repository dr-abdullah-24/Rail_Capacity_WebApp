"""Orchestrates the extract -> baseline -> MILP pipeline for one Run.

Spawns the existing Python scripts as subprocesses, streams their stdout
lines back through the Broker, and updates the Run row on completion.

Progress model: three phases (extract, baseline, milp) contribute weighted
percentages. Within the MILP phase we parse "[hourly] direction block N"
lines to advance sub-block progress.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import sys
import tarfile
import time
from datetime import datetime
from pathlib import Path

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models.run import Run
from app.models.upload import Upload
from app.services.broker import broker


import csv as _csv

PHASE_WEIGHTS = {"extract": 0.20, "baseline": 0.10, "milp": 0.70}


def _filter_candidates(src: Path, dst: Path,
                       start_hour: int, end_hour: int) -> tuple[int, int]:
    """Copy rows from src candidate CSV to dst, keeping only those whose
    hour (earliest_dep_min // 60) is in [start_hour, end_hour).
    Returns (kept, total)."""
    kept = total = 0
    with src.open(newline="", encoding="utf-8") as fh_in, \
         dst.open("w", newline="", encoding="utf-8") as fh_out:
        rdr = _csv.DictReader(fh_in)
        wr = _csv.DictWriter(fh_out, fieldnames=rdr.fieldnames or [])
        wr.writeheader()
        for row in rdr:
            total += 1
            try:
                h = int(row["earliest_dep_min"]) // 60
            except (KeyError, ValueError):
                wr.writerow(row); kept += 1
                continue
            if start_hour <= h < end_hour:
                wr.writerow(row); kept += 1
    return kept, total

# TD areas we keep when converting tbz2 -> jsonl (matches the 2018 pipeline)
CORRIDOR_TDS = {"CE", "MS", "MP", "M3", "WD", "WA"}


def _tbz2_to_jsonl(tbz2_path: Path, jsonl_path: Path) -> tuple[int, int]:
    """Stream a .tbz2 TD archive into a JSONL file, keeping only CA_MSG
    events in corridor TD areas. Returns (n_kept, n_scanned)."""
    n_kept = n_seen = 0
    with tarfile.open(str(tbz2_path), "r|bz2") as tar, \
         jsonl_path.open("wb") as out:
        for m in tar:
            if not m.isfile() or not m.name.endswith(".td"):
                continue
            f = tar.extractfile(m)
            if f is None:
                continue
            data = f.read()
            if not data:
                continue
            for raw in data.splitlines():
                n_seen += 1
                line = raw.strip()
                if not line:
                    continue
                try:
                    items = json.loads(line)
                except json.JSONDecodeError:
                    continue
                kept = []
                for it in items:
                    ca = it.get("CA_MSG") if isinstance(it, dict) else None
                    if ca is None:
                        continue
                    if ca.get("area_id", "").strip() not in CORRIDOR_TDS:
                        continue
                    kept.append(it)
                if kept:
                    out.write(
                        (json.dumps(kept, separators=(",", ":")) + "\n")
                        .encode("utf-8"))
                    n_kept += 1
    return n_kept, n_seen


class ProgressTracker:
    """Tracks pipeline progress and turns log lines into progress events."""

    _BLOCK_START  = re.compile(r"\[hourly\]\s+(\w+)\s+block\s+(\d+)\s+h(\d+)-h(\d+)")
    _BLOCK_END    = re.compile(r"\[hourly\]\s+->\s+(\w+)\s+inserted=(\d+)/(\d+)\s+time=([\d.]+)s")
    _BLOCK_HOURS  = re.compile(r"block_hours=(\d+)")

    def __init__(self, run_id: int) -> None:
        self.run_id       = run_id
        self.phase        = "extract"
        self.phase_pct    = 0.0
        self.total_blocks = 12       # fallback until we parse block_hours
        self.done_blocks  = 0
        self.current_block: dict | None = None

    def start_phase(self, phase: str) -> dict:
        self.phase = phase
        self.phase_pct = 0.0
        return self._event(f"{phase} started")

    def phase_progress(self, pct: float) -> dict:
        self.phase_pct = max(0.0, min(1.0, pct))
        return self._event()

    def phase_done(self) -> dict:
        self.phase_pct = 1.0
        return self._event(f"{self.phase} complete")

    def observe(self, line: str) -> dict | None:
        """If the line advances progress, return an event, otherwise None."""
        if self.phase == "milp":
            m = self._BLOCK_HOURS.search(line)
            if m:
                bh = int(m.group(1))
                # 24 h day split into 24/bh blocks per direction x 2 directions
                self.total_blocks = (24 // max(1, bh)) * 2
                return self._event("initialised block count")
            m = self._BLOCK_END.match(line.strip())
            if m:
                self.done_blocks += 1
                self.phase_pct = self.done_blocks / max(1, self.total_blocks)
                extra = {
                    "block_status": m.group(1),
                    "block_inserted": int(m.group(2)),
                    "block_candidates": int(m.group(3)),
                    "block_solve_s": float(m.group(4)),
                }
                return self._event(
                    f"block {self.done_blocks}/{self.total_blocks} "
                    f"{m.group(1)} · inserted {m.group(2)}/{m.group(3)}",
                    extra=extra,
                )
            m = self._BLOCK_START.match(line.strip())
            if m:
                self.current_block = {
                    "direction": m.group(1),
                    "index": int(m.group(2)),
                    "hour_start": int(m.group(3)),
                    "hour_end": int(m.group(4)),
                }
                return self._event(
                    f"solving {m.group(1)} block {m.group(2)} "
                    f"({m.group(3)}h-{m.group(4)}h)",
                    extra={"current_block": self.current_block},
                )
        elif self.phase == "extract":
            if "R3 journeys qualified" in line or "done" in line:
                self.phase_pct = min(1.0, self.phase_pct + 0.3)
                return self._event()
        elif self.phase == "baseline":
            if "kept" in line and "touches" in line:
                self.phase_pct = 0.7
                return self._event()
        return None

    @property
    def overall_pct(self) -> float:
        prev = 0.0
        for p, w in PHASE_WEIGHTS.items():
            if p == self.phase:
                return round((prev + w * self.phase_pct) * 100, 1)
            prev += w
        return 100.0

    def _event(self, message: str = "", extra: dict | None = None) -> dict:
        e = {
            "type": "progress",
            "phase": self.phase,
            "phase_pct": round(self.phase_pct * 100, 1),
            "percent": self.overall_pct,
            "done_blocks": self.done_blocks,
            "total_blocks": self.total_blocks,
            "message": message,
        }
        if extra:
            e.update(extra)
        return e


SCRIPTS = settings.milp_repo / "scripts"
INP     = settings.milp_repo / "inputs"

PY = sys.executable


async def _stream_subprocess(run_id: int, prefix: str, cmd: list[str],
                             cwd: Path,
                             tracker: ProgressTracker | None = None) -> int:
    """Run cmd, tee each stdout line into broker as {type: log, ...}.
    If a tracker is provided, also emit progress events derived from the
    stream. Returns the exit code."""
    await broker.publish(run_id, {
        "type": "log", "prefix": prefix,
        "ts": datetime.utcnow().isoformat(),
        "line": f"$ {' '.join(cmd[-3:])}",
    })
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None
    while True:
        raw = await proc.stdout.readline()
        if not raw:
            break
        try:
            line = raw.decode("utf-8", errors="replace").rstrip()
        except Exception:
            line = repr(raw)
        if line:
            await broker.publish(run_id, {
                "type": "log", "prefix": prefix,
                "ts": datetime.utcnow().isoformat(),
                "line": line,
            })
            if tracker is not None:
                ev = tracker.observe(line)
                if ev is not None:
                    await broker.publish(run_id, ev)
    code = await proc.wait()
    await broker.publish(run_id, {
        "type": "log", "prefix": prefix,
        "ts": datetime.utcnow().isoformat(),
        "line": f"(exit {code})",
    })
    return code


def _update_run(run_id: int, **fields) -> None:
    with Session(engine) as s:
        row = s.get(Run, run_id)
        if not row:
            return
        for k, v in fields.items():
            setattr(row, k, v)
        s.add(row); s.commit()


def _load_upload(upload_id: int) -> Upload | None:
    with Session(engine) as s:
        return s.get(Upload, upload_id)


async def run_pipeline(run_id: int) -> None:
    """Execute the full extract -> baseline -> MILP chain for a Run."""
    with Session(engine) as s:
        run = s.get(Run, run_id)
        if run is None:
            return
        upload = None
        if run.baseline_upload_id is not None:
            upload = s.get(Upload, run.baseline_upload_id)

    date = run.date_tag or "unknown"
    run_dir = settings.runs_dir / str(run_id)
    run_dir.mkdir(parents=True, exist_ok=True)

    _update_run(run_id, status="running", started_at=datetime.utcnow(),
                result_dir=str(run_dir))
    await broker.publish(run_id, {"type": "status", "value": "running"})

    tracker = ProgressTracker(run_id)
    # Seed total blocks from the requested config so the bar starts sane
    tracker.total_blocks = (24 // max(1, run.block_hours)) * 2
    await broker.publish(run_id, tracker.start_phase("extract"))

    try:
        # ── Step 1 - single-day extract from uploaded source
        events_csv = run_dir / f"events_{date}.csv"

        if upload and upload.kind == "td_tbz2":
            # Convert bz2 tarball -> JSONL first
            await broker.publish(run_id, {"type": "log", "prefix": "extract",
                "line": f"decompressing {Path(upload.stored_path).name} ..."})
            jsonl_path = run_dir / f"td_{date}.jsonl"
            loop = asyncio.get_event_loop()
            n_kept, n_seen = await loop.run_in_executor(
                None, _tbz2_to_jsonl,
                Path(upload.stored_path), jsonl_path)
            await broker.publish(run_id, {"type": "log", "prefix": "extract",
                "line": f"tbz2 -> jsonl: kept {n_kept:,} of {n_seen:,} lines"})
            code = await _stream_subprocess(run_id, "extract", [
                PY, str(SCRIPTS / "extract_route3_steer_single.py"),
                "--jsonl", str(jsonl_path),
                "--date",  date,
                "--out",   str(events_csv),
            ], cwd=settings.milp_repo, tracker=tracker)
            if code != 0:
                raise RuntimeError("extract failed")

        elif upload and upload.kind == "td_jsonl":
            code = await _stream_subprocess(run_id, "extract", [
                PY, str(SCRIPTS / "extract_route3_steer_single.py"),
                "--jsonl", upload.stored_path,
                "--date",  date,
                "--out",   str(events_csv),
            ], cwd=settings.milp_repo, tracker=tracker)
            if code != 0:
                raise RuntimeError("extract failed")

        elif upload and upload.kind == "events_csv":
            shutil.copyfile(upload.stored_path, events_csv)
            await broker.publish(run_id, {"type": "log", "prefix": "extract",
                                          "line": "using pre-extracted events CSV"})
        else:
            raise RuntimeError(
                "baseline_upload_id required (td_tbz2, td_jsonl, or events_csv)")
        await broker.publish(run_id, tracker.phase_done())

        # ── Step 2 - build baseline
        await broker.publish(run_id, tracker.start_phase("baseline"))
        baseline_csv = run_dir / f"baseline_{date}.csv"
        freight_lines_json = run_dir / f"freight_lines_by_junction_{date}.json"
        code = await _stream_subprocess(run_id, "baseline", [
            PY, str(SCRIPTS / "build_baseline_traffic.py"),
            "--dates",  date,
            "--tag",    date,
            "--events", str(events_csv),
        ], cwd=settings.milp_repo, tracker=tracker)
        if code != 0:
            raise RuntimeError("build_baseline failed")

        default_baseline = INP / f"baseline_traffic_{date}.csv"
        default_frjs     = INP / f"freight_lines_by_junction_{date}.json"
        if default_baseline.exists():
            shutil.copyfile(default_baseline, baseline_csv)
        if default_frjs.exists():
            shutil.copyfile(default_frjs, freight_lines_json)
        await broker.publish(run_id, tracker.phase_done())

        # ── Step 3 - MILP
        await broker.publish(run_id, tracker.start_phase("milp"))
        paths_csv = INP / ("candidate_paths_steer_class4.csv"
                            if run.traction == "c4"
                            else "candidate_paths_steer.csv")
        srt_csv = INP / ("srt_profile_class4.csv"
                          if run.traction == "c4"
                          else "srt_profile.csv")

        # Filter candidates by the optional operating window
        if run.operating_hours_enabled:
            filtered = run_dir / f"candidates_windowed.csv"
            kept, total = _filter_candidates(
                paths_csv, filtered,
                run.operating_start_hour, run.operating_end_hour)
            await broker.publish(run_id, {
                "type": "log", "prefix": "milp",
                "line": (f"operating window "
                         f"{run.operating_start_hour:02d}:00-"
                         f"{run.operating_end_hour:02d}:00 -> "
                         f"kept {kept} of {total} candidate slots")})
            paths_csv = filtered

        code = await _stream_subprocess(run_id, "milp", [
            PY, str(SCRIPTS / "run_steer_hourly.py"),
            "--baseline", str(baseline_csv),
            "--paths",    str(paths_csv),
            "--srt",      str(srt_csv),
            "--freight-lines", str(freight_lines_json),
            "--tag",      f"webapp_run_{run_id}",
            "--block-hours", str(run.block_hours),
            "--time-limit-per-block", str(run.time_limit_per_block),
            "--headway",  str(run.headway_min),
            "--dwell-max", str(run.dwell_max),
        ], cwd=settings.milp_repo, tracker=tracker)
        if code != 0:
            raise RuntimeError("MILP failed")
        await broker.publish(run_id, tracker.phase_done())

        # Collect outputs from the shared results dir
        shared_results = settings.milp_repo / "results"
        kpi_src = shared_results / f"capacity_kpis_webapp_run_{run_id}.json"
        sol_src = shared_results / f"capacity_solution_webapp_run_{run_id}.csv"
        if kpi_src.exists():
            shutil.copyfile(kpi_src, run_dir / "kpis.json")
        if sol_src.exists():
            shutil.copyfile(sol_src, run_dir / "solution.csv")

        # Parse KPIs to update run record
        kpi_fields: dict = {}
        if (run_dir / "kpis.json").exists():
            k = json.loads((run_dir / "kpis.json").read_text(encoding="utf-8"))
            kpi_fields = {
                "nb_inserted":            k.get("nb_inserted"),
                "sb_inserted":            k.get("sb_inserted"),
                "total_dwell_min":        k.get("total_dwell_min"),
                "blocks_hit_time_limit":  k.get("blocks_hit_time_limit"),
                "wall_solve_time_s":      k.get("wall_solve_time_s"),
            }

        _update_run(run_id, status="complete",
                    completed_at=datetime.utcnow(),
                    **kpi_fields)
        await broker.publish(run_id, {"type": "status", "value": "complete",
                                       "kpis": kpi_fields})
    except Exception as e:
        _update_run(run_id, status="failed",
                    completed_at=datetime.utcnow(),
                    error=str(e))
        await broker.publish(run_id, {"type": "status", "value": "failed",
                                       "error": str(e)})
    finally:
        await broker.complete(run_id)
