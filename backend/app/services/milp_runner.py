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
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models.run import Run
from app.models.upload import Upload
from app.services.broker import broker
from app.services.smart_berths import corridor_berths


import csv as _csv

PHASE_WEIGHTS = {"extract": 0.20, "baseline": 0.10, "milp": 0.70}
DIVERSION_WEIGHTS = {"divertible": 0.15, "shifting": 0.20, "milp": 0.65}


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


LOCAL_SCRIPTS = settings.local_scripts               # backend/scripts/
INP           = settings.data_root / "milp"          # backend/data/milp/
MILP_RESULTS  = settings.data_root / "milp_results"  # backend/data/milp_results/
MILP_RESULTS.mkdir(parents=True, exist_ok=True)
SCRIPTS       = LOCAL_SCRIPTS                        # alias; all scripts bundled

PY = sys.executable


async def _stream_subprocess(run_id: int, prefix: str, cmd: list[str],
                             cwd: Path,
                             tracker: ProgressTracker | None = None) -> int:
    """Run cmd, tee each stdout line into broker as {type: log, ...}.
    If a tracker is provided, also emit progress events derived from the
    stream. Returns the exit code."""
    await broker.publish(run_id, {
        "type": "log", "prefix": prefix,
        "ts": datetime.now(timezone.utc).isoformat(),
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
                "ts": datetime.now(timezone.utc).isoformat(),
                "line": line,
            })
            if tracker is not None:
                ev = tracker.observe(line)
                if ev is not None:
                    await broker.publish(run_id, ev)
    code = await proc.wait()
    await broker.publish(run_id, {
        "type": "log", "prefix": prefix,
        "ts": datetime.now(timezone.utc).isoformat(),
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
    """Dispatch to the capacity or diversion pipeline based on run.model_type."""
    with Session(engine) as s:
        run = s.get(Run, run_id)
        if run is None:
            return
    if (run.model_type or "capacity") == "diversion":
        await run_diversion_pipeline(run_id)
    else:
        await run_capacity_pipeline(run_id)


async def run_capacity_pipeline(run_id: int) -> None:
    """Execute the extract -> baseline -> capacity MILP chain."""
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

    _update_run(run_id, status="running", started_at=datetime.now(timezone.utc),
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
            ], cwd=settings.data_root.parent, tracker=tracker)
            if code != 0:
                raise RuntimeError("extract failed")

        elif upload and upload.kind == "td_jsonl":
            code = await _stream_subprocess(run_id, "extract", [
                PY, str(SCRIPTS / "extract_route3_steer_single.py"),
                "--jsonl", upload.stored_path,
                "--date",  date,
                "--out",   str(events_csv),
            ], cwd=settings.data_root.parent, tracker=tracker)
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
        ], cwd=settings.data_root.parent, tracker=tracker)
        if code != 0:
            raise RuntimeError("build_baseline failed")

        default_baseline = settings.data_root / "milp_scratch" / f"baseline_traffic_{date}.csv"
        default_frjs     = settings.data_root / "milp_scratch" / f"freight_lines_by_junction_{date}.json"
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
        ], cwd=settings.data_root.parent, tracker=tracker)
        if code != 0:
            raise RuntimeError("MILP failed")
        await broker.publish(run_id, tracker.phase_done())

        # Collect outputs from the shared results dir
        shared_results = MILP_RESULTS
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
                    completed_at=datetime.now(timezone.utc),
                    **kpi_fields)
        await broker.publish(run_id, {"type": "status", "value": "complete",
                                       "kpis": kpi_fields})
    except Exception as e:
        _update_run(run_id, status="failed",
                    completed_at=datetime.now(timezone.utc),
                    error=str(e))
        await broker.publish(run_id, {"type": "status", "value": "failed",
                                       "error": str(e)})
    finally:
        await broker.complete(run_id)


# ══════════════════════════════════════════════════════════════════════════════
#   Diversion pipeline (generic, Commit 1)
# ══════════════════════════════════════════════════════════════════════════════
#
# Flow:
#   1. Serialise source + target corridor definitions to the run dir.
#   2. extract_two_corridors_generic.py  ->  source/target events + summaries
#   3. identify_divertible_generic.py    ->  divertible_trains.csv
#   4. Stage the outputs into inputs/ paths that the 2018 shifting-strategy
#      + MILP scripts expect, then run them (unchanged).  Commit 2 will
#      replace stages 4-5 with a fully-generic assignment MILP.
#
async def run_diversion_pipeline(run_id: int) -> None:
    from app.api.corridors import _builtins as builtin_corridors
    from sqlmodel import select
    from app.models.corridor import UserCorridor
    with Session(engine) as s:
        run = s.get(Run, run_id)
        if run is None: return
        upload_ids: list[int] = []
        multi = (getattr(run, "source_upload_ids", None) or "").strip()
        print(f"[runner] run {run_id} source_upload_ids='{multi}' "
              f"source_upload_id={run.source_upload_id}", flush=True)
        if multi:
            for tok in multi.replace(",", " ").split():
                try: upload_ids.append(int(tok))
                except ValueError: pass
        if not upload_ids and run.source_upload_id is not None:
            upload_ids = [run.source_upload_id]
        uploads: list[Upload] = []
        for uid in upload_ids:
            u = s.get(Upload, uid)
            if u is not None: uploads.append(u)
            else: print(f"[runner] upload id {uid} not found in DB",
                        flush=True)
        print(f"[runner] resolved {len(uploads)} of {len(upload_ids)} "
              f"upload rows: "
              f"{[u.original_name for u in uploads]}", flush=True)

    run_dir = settings.runs_dir / str(run_id)
    run_dir.mkdir(parents=True, exist_ok=True)

    _update_run(run_id, status="running", started_at=datetime.now(timezone.utc),
                result_dir=str(run_dir))
    await broker.publish(run_id, {"type": "status", "value": "running"})

    async def emit(phase: str, pct: float, message: str = "") -> None:
        await broker.publish(run_id, {
            "type": "progress", "phase": phase,
            "phase_pct": round(pct * 100, 1),
            "percent": round(pct * 100, 1),
            "done_blocks": 0, "total_blocks": 0, "message": message,
        })

    # ─── Load source + target corridor definitions ────────────────────────
    def load_corridor(cid: str) -> dict:
        b = builtin_corridors()
        if cid in b: return b[cid]
        with Session(engine) as sess:
            row = sess.exec(select(UserCorridor)
                             .where(UserCorridor.slug == cid)).first()
            if row is None:
                raise RuntimeError(f"corridor '{cid}' not found")
            return {"id": row.slug, "name": row.name,
                    "description": row.description,
                    "km_length": row.stations[-1]["chainage_km"]
                                    if row.stations else 0,
                    "stations": row.stations}

    class_digit = (run.class_filter or "4").strip() or "4"
    endpoint_strictness = (run.endpoint_strictness or "relaxed").strip() \
                            or "relaxed"
    excluded_terminals = (run.excluded_terminals or "").strip()

    try:
        if not uploads:
            raise RuntimeError("diversion needs at least one source upload "
                               "(TD .jsonl / .tbz2 / events CSV)")
        src_cid = (run.source_corridor_id or "").strip()
        tgt_cid = (run.target_corridor_id or "").strip()
        date_iso = (run.date_tag or "").strip()
        if not src_cid or not tgt_cid:
            raise RuntimeError("diversion needs both source_corridor_id "
                               "and target_corridor_id")

        source = load_corridor(src_cid)
        target = load_corridor(tgt_cid)
        (run_dir / "source_corridor.json").write_text(
            json.dumps(source, indent=2), encoding="utf-8")
        (run_dir / "target_corridor.json").write_text(
            json.dumps(target, indent=2), encoding="utf-8")

        names = ", ".join(u.original_name for u in uploads)
        await emit("extract", 0.0,
                    f"extracting from {len(uploads)} file(s): {names}")
        for u in uploads:
            await broker.publish(run_id, {
                "type": "log", "prefix": "extract",
                "line": f"  input file: {u.original_name}"
                         f"  ({u.size_bytes/1024/1024:.1f} MB)",
            })

        # ── Stage 1 - Two-corridor extraction ─────────────────────────
        # Write paths to a file to avoid Windows MAX_CMDLINE overflow
        # when many large uploads are selected.
        src_list_path = run_dir / "td_source_list.txt"
        src_list_path.write_text(
            "\n".join(u.stored_path for u in uploads), encoding="utf-8")
        extract_cmd: list[str] = [
            PY, str(LOCAL_SCRIPTS / "extract_two_corridors_generic.py"),
            "--source-corridor", str(run_dir / "source_corridor.json"),
            "--target-corridor", str(run_dir / "target_corridor.json"),
            "--date",            date_iso,
            "--out-dir",         str(run_dir),
            "--td-source-list",  str(src_list_path),
        ]
        code = await _stream_subprocess(run_id, "extract", extract_cmd,
                                         cwd=settings.data_root.parent)
        if code != 0: raise RuntimeError("extraction failed")
        await emit("extract", 1.0, "extraction complete")

        # ── Stage 2 - Divertibility identification ────────────────────
        await emit("divertible", 0.0, "identifying divertible trains")
        code = await _stream_subprocess(run_id, "divertible", [
            PY, str(LOCAL_SCRIPTS / "identify_divertible_generic.py"),
            "--source-summary",  str(run_dir / "source_summary.csv"),
            "--source-corridor", str(run_dir / "source_corridor.json"),
            "--target-corridor", str(run_dir / "target_corridor.json"),
            "--classes",         class_digit,
            "--endpoint-strictness", endpoint_strictness,
            "--exclude-terminal", excluded_terminals,
            "--out",             str(run_dir / "divertible_trains.csv"),
        ], cwd=settings.data_root.parent)
        if code != 0: raise RuntimeError("divertibility identification failed")
        await emit("divertible", 1.0, "divertibility complete")

        # Count divertibles for KPI
        divertible_n = 0
        div_csv = run_dir / "divertible_trains.csv"
        if div_csv.exists():
            with div_csv.open(encoding="utf-8") as fh:
                divertible_n = max(0, sum(1 for _ in fh) - 1)

        if divertible_n == 0:
            _update_run(run_id, status="complete",
                        completed_at=datetime.now(timezone.utc),
                        divertible_total=0, div_placed=0,
                        div_rescheduled=0, div_conflict=0,
                        div_placed_pct=0.0,
                        div_solver_status="no_divertibles")
            await broker.publish(run_id, {"type": "log",
                "prefix": "diversion",
                "line": "no divertible trains - stopping"})
            await broker.publish(run_id, {"type": "status",
                "value": "complete", "kpis": {"divertible_total": 0}})
            return

        # ── Stage 3 - Prepare MILP inputs from divertibles + target
        await emit("prepare", 0.0, "preparing MILP inputs")
        code = await _stream_subprocess(run_id, "prepare", [
            PY, str(LOCAL_SCRIPTS / "prepare_diversion_inputs.py"),
            "--divertible",     str(run_dir / "divertible_trains.csv"),
            "--target-events",  str(run_dir / "target_events.csv"),
            "--target-corridor", str(run_dir / "target_corridor.json"),
            "--flex-min",       str(run.flex_min or 60),
            "--smart-json",     str(settings.data_root / "SMART.json"),
            "--out-dir",        str(run_dir),
        ], cwd=settings.data_root.parent)
        if code != 0: raise RuntimeError("prepare MILP inputs failed")
        await emit("prepare", 1.0, "MILP inputs ready")

        # ── Stage 4 - Shift-assignment MILP (paper formulation)
        #     x_{t,s} ∈ {0,1}, C1 Σ_s x_{t,s} ≤ 1, C2 berth capacity per
        #     (station, 15-min window), obj = Σ x_{t,s} − λ·Σ|s|·x_{t,s}
        await emit("milp", 0.0, "solving assignment MILP")

        # Build per-station berth file from SMART data for the target corridor
        berths_json_path = run_dir / "berths_per_station.json"
        try:
            tgt_corridor_json = json.loads(
                (run_dir / "target_corridor.json").read_text(encoding="utf-8"))
            bps = corridor_berths(
                tgt_corridor_json.get("stations", []),
                fallback=int(getattr(run, "n_berths", 6) or 6),
            )
            berths_json_path.write_text(
                json.dumps(bps, indent=2), encoding="utf-8")
            await broker.publish(run_id, {
                "type": "log", "prefix": "milp",
                "line": f"SMART berths: "
                        + ", ".join(
                            f"seq{k}={v}"
                            for k, v in sorted(bps.items())
                        ),
            })
        except Exception as exc:
            berths_json_path = None
            await broker.publish(run_id, {
                "type": "log", "prefix": "milp",
                "line": f"[warn] could not build SMART berths: {exc} "
                        f"— falling back to --n-berths",
            })

        assign_time_limit = str(max(60, int(run.time_limit_per_block or 300)))
        milp_cmd = [
            PY, str(LOCAL_SCRIPTS / "assignment_diversion_milp.py"),
            "--divertible",      str(run_dir / "candidate_paths_diversion.csv"),
            "--baseline",        str(run_dir / "baseline_traffic_diversion.csv"),
            "--target-corridor", str(run_dir / "target_corridor.json"),
            "--flex-min",        str(run.flex_min or 60),
            "--shift-step",      "5",
            "--n-berths",        str(getattr(run, "n_berths", 6) or 6),
            "--time-limit",      assign_time_limit,
            "--out",             str(run_dir / "solution.csv"),
            "--kpis",            str(run_dir / "kpis.json"),
            "--log",             str(run_dir / "assign_cbc.log"),
        ]
        if berths_json_path:
            milp_cmd += ["--berths-json", str(berths_json_path)]
        code = await _stream_subprocess(run_id, "milp", milp_cmd,
                                         cwd=settings.data_root.parent,
                                         tracker=None)
        if code != 0: raise RuntimeError("assignment MILP failed")
        await emit("milp", 1.0, "MILP complete")

        # ── Read KPIs from kpis.json (authoritative — written directly by
        #     the MILP subprocess).  Use these for the DB update so the
        #     counts always match what the solver actually found.
        kpi_path = run_dir / "kpis.json"
        milp_kpis: dict = {}
        if kpi_path.exists():
            try:
                milp_kpis = json.loads(
                    kpi_path.read_text(encoding="utf-8"))
            except Exception:
                milp_kpis = {}

        placed   = int(milp_kpis.get("n_placed",     0) or 0)
        resched  = int(milp_kpis.get("n_rescheduled", 0) or 0)
        slot     = int(milp_kpis.get("n_slot",        0) or 0)
        conflict = int(milp_kpis.get("n_conflict",    0) or 0)
        pct      = float(milp_kpis.get("placed_pct",  0.0) or 0.0)
        mean_abs = float(milp_kpis.get("mean_abs_shift_min", 0.0) or 0.0)
        wall     = milp_kpis.get("wall_solve_time_s")
        solver_status = milp_kpis.get("solver_status", "Optimal")

        print(f"[runner] kpis.json: placed={placed} slot={slot} "
              f"resched={resched} conflict={conflict} pct={pct}",
              flush=True)

        # ── Build per-train outcome table from solution.csv (for the
        #     UI detail table and diversion_outcome.csv download).
        outcome_rows: list[dict] = []
        sol_p = run_dir / "solution.csv"
        if sol_p.exists():
            with sol_p.open(newline="", encoding="utf-8") as fh:
                for r in _csv.DictReader(fh):
                    outc = (r.get("outcome") or "").upper()
                    try:
                        shift_val = int(r["shift_min"]) \
                                    if r.get("shift_min") not in ("", None) \
                                    else 0
                    except ValueError:
                        shift_val = 0
                    outcome_rows.append({
                        "path_id":       r.get("path_id", ""),
                        "headcode":      r.get("headcode", ""),
                        "original_hhmm": r.get("original_hhmm", ""),
                        "assigned_hhmm": r.get("assigned_hhmm", ""),
                        "shift_min":     shift_val if outc != "CONFLICT" else "",
                        "outcome":       outc or "CONFLICT",
                    })
        print(f"[runner] solution.csv rows={len(outcome_rows)}", flush=True)

        # Persist outcome CSV
        with (run_dir / "diversion_outcome.csv").open(
                "w", newline="", encoding="utf-8") as fh:
            w = _csv.DictWriter(fh, fieldnames=["path_id", "headcode",
                "original_hhmm", "assigned_hhmm", "shift_min", "outcome"])
            w.writeheader(); w.writerows(outcome_rows)

        _update_run(run_id, status="complete",
                    completed_at=datetime.now(timezone.utc),
                    divertible_total=divertible_n,
                    div_placed=placed,
                    div_rescheduled=resched,
                    div_conflict=conflict,
                    div_placed_pct=pct,
                    div_mean_abs_shift_min=round(mean_abs, 2),
                    wall_solve_time_s=wall,
                    div_solver_status=solver_status)
        await broker.publish(run_id, {"type": "status", "value": "complete",
                                       "kpis": {"divertible_total": divertible_n,
                                                 "div_placed": placed,
                                                 "div_conflict": conflict}})
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        _update_run(run_id, status="failed",
                    completed_at=datetime.now(timezone.utc),
                    error=f"{type(e).__name__}: {e}")
        await broker.publish(run_id, {"type": "log", "prefix": "error",
                                       "line": tb.splitlines()[-1]})
        await broker.publish(run_id, {"type": "status", "value": "failed",
                                       "error": f"{type(e).__name__}: {e}"})
    finally:
        await broker.complete(run_id)
