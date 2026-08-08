"""Run endpoints - create/list, launch the pipeline in the background."""
import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import get_session
from app.models.run import Run
from app.services.milp_runner import run_pipeline
from app.services.traffic import bundle_run

router = APIRouter(prefix="/runs", tags=["runs"])


@router.post("/", response_model=Run)
def create_run(payload: Run, background: BackgroundTasks,
               session: Session = Depends(get_session)):
    model_type = (payload.model_type or "capacity").lower()

    if model_type == "capacity":
        if payload.baseline_upload_id is None:
            raise HTTPException(400,
                "capacity model needs baseline_upload_id "
                "(TD JSONL / .tbz2 / events CSV)")
    elif model_type == "diversion":
        multi = (payload.source_upload_ids or "").strip()
        has_multi = bool([t for t in multi.replace(",", " ").split()])
        if payload.source_upload_id is None and not has_multi:
            raise HTTPException(400,
                "diversion model needs at least one source upload "
                "(source_upload_id or source_upload_ids)")
        if not payload.source_corridor_id or not payload.target_corridor_id:
            raise HTTPException(400,
                "diversion model needs source_corridor_id and "
                "target_corridor_id")
    else:
        raise HTTPException(400, f"unknown model_type '{model_type}'")

    row = Run(
        name=payload.name or f"run @ {payload.date_tag or 'unknown'}",
        model_type=model_type,
        date_tag=payload.date_tag,
        traction=payload.traction,
        headway_min=payload.headway_min,
        dwell_max=payload.dwell_max,
        block_hours=payload.block_hours,
        time_limit_per_block=payload.time_limit_per_block,
        operating_hours_enabled=payload.operating_hours_enabled,
        operating_start_hour=payload.operating_start_hour,
        operating_end_hour=payload.operating_end_hour,
        baseline_upload_id=payload.baseline_upload_id,
        source_upload_id=payload.source_upload_id,
        source_upload_ids=(payload.source_upload_ids or "").strip(),
        target_upload_id=payload.target_upload_id,
        source_corridor_id=payload.source_corridor_id,
        target_corridor_id=payload.target_corridor_id,
        class_filter=payload.class_filter,
        flex_min=payload.flex_min,
        n_berths=payload.n_berths,
        endpoint_strictness=payload.endpoint_strictness,
        excluded_terminals=payload.excluded_terminals,
    )
    session.add(row); session.commit(); session.refresh(row)
    background.add_task(_launch, row.id)
    return row


async def _launch(run_id: int) -> None:
    # Schedule the coroutine on the event loop
    await run_pipeline(run_id)


@router.get("/", response_model=list[Run])
def list_runs(session: Session = Depends(get_session)):
    return session.exec(select(Run).order_by(Run.created_at.desc())).all()


@router.get("/{run_id}", response_model=Run)
def get_run(run_id: int, session: Session = Depends(get_session)):
    row = session.get(Run, run_id)
    if not row:
        raise HTTPException(404, "run not found")
    return row


@router.get("/{run_id}/solution")
def get_solution(run_id: int, session: Session = Depends(get_session)):
    row = session.get(Run, run_id)
    if not row or not row.result_dir:
        raise HTTPException(404, "no result yet")
    p = Path(row.result_dir) / "solution.csv"
    if not p.exists():
        raise HTTPException(404, "solution not yet written")
    return FileResponse(str(p), media_type="text/csv",
                        filename=f"solution_run_{run_id}.csv")


@router.get("/{run_id}/kpis")
def get_kpis(run_id: int, session: Session = Depends(get_session)):
    row = session.get(Run, run_id)
    if not row or not row.result_dir:
        raise HTTPException(404, "no result yet")
    p = Path(row.result_dir) / "kpis.json"
    if not p.exists():
        raise HTTPException(404, "kpis not yet written")
    import json
    return json.loads(p.read_text(encoding="utf-8"))


@router.get("/{run_id}/baseline")
def get_baseline(run_id: int, session: Session = Depends(get_session)):
    row = session.get(Run, run_id)
    if not row or not row.result_dir or not row.date_tag:
        raise HTTPException(404, "no baseline yet")
    p = Path(row.result_dir) / f"baseline_{row.date_tag}.csv"
    if not p.exists():
        raise HTTPException(404, "baseline not yet written")
    return FileResponse(str(p), media_type="text/csv",
                        filename=f"baseline_run_{run_id}.csv")


@router.get("/{run_id}/traffic")
def get_traffic(run_id: int, session: Session = Depends(get_session)):
    row = session.get(Run, run_id)
    if not row or not row.result_dir or not row.date_tag:
        raise HTTPException(404, "no traffic bundle yet")
    return bundle_run(Path(row.result_dir), row.date_tag,
                       traction=row.traction)


@router.get("/{run_id}/diversion")
def get_diversion_outcome(run_id: int,
                          session: Session = Depends(get_session)):
    """Return the per-train diversion outcome table + summary stats."""
    row = session.get(Run, run_id)
    if not row or not row.result_dir:
        raise HTTPException(404, "no result dir")
    csv_p = Path(row.result_dir) / "diversion_outcome.csv"
    if not csv_p.exists():
        raise HTTPException(404, "diversion outcome not written")
    import csv as _csv

    rdir = Path(row.result_dir)
    flex = row.flex_min or 60

    # --- direction + original_dep_min per path_id from candidates CSV ---
    cand_info: dict[str, dict] = {}
    cand_p = rdir / "candidate_paths_diversion.csv"
    if cand_p.exists():
        with cand_p.open(newline="", encoding="utf-8") as fh:
            for r in _csv.DictReader(fh):
                try:
                    orig = int(r.get("original_dep_min") or 0)
                except ValueError:
                    orig = 0
                cand_info[r["path_id"]] = {
                    "direction":       r.get("direction", ""),
                    "original_dep_min": orig,
                }

    # --- target corridor entry/exit station names ---
    import json as _json
    target_first_station = ""
    target_last_station  = ""
    tgt_corr_p = rdir / "target_corridor.json"
    if tgt_corr_p.exists():
        try:
            tc_stations = _json.loads(
                tgt_corr_p.read_text(encoding="utf-8")
            ).get("stations", [])
            if tc_stations:
                target_first_station = (tc_stations[0].get("name")
                                        or tc_stations[0].get("stanme", ""))
                target_last_station  = (tc_stations[-1].get("name")
                                        or tc_stations[-1].get("stanme", ""))
        except Exception:
            pass

    # --- first/last station per headcode from divertible_trains CSV ---
    divert_info: dict[str, dict] = {}
    divert_p = rdir / "divertible_trains.csv"
    if divert_p.exists():
        with divert_p.open(newline="", encoding="utf-8") as fh:
            for r in _csv.DictReader(fh):
                hc = r.get("headcode", "")
                if hc and hc not in divert_info:
                    divert_info[hc] = {
                        "first_station": r.get("first_station", ""),
                        "last_station":  r.get("last_station", ""),
                    }

    # --- deduplicated baseline trains per direction ---
    # Keep the minimum-t_min row per (headcode, journey_num) as the
    # corridor-entry record; store headcode + train_class alongside t_min.
    baseline_by_dir: dict[str, list[dict]] = {}
    baseline_p = rdir / "baseline_traffic_diversion.csv"
    if baseline_p.exists():
        _entry: dict[str, dict[tuple, dict]] = {}  # dir->{(hc,jn)->record}
        with baseline_p.open(newline="", encoding="utf-8") as fh:
            for r in _csv.DictReader(fh):
                dirn = (r.get("direction") or "").strip()
                hc   = r.get("headcode", "")
                jn   = r.get("journey_num", "")
                tc   = r.get("train_class", "")
                loc  = r.get("junction_name", "")
                try:
                    t = int(r["t_min"])
                except (ValueError, KeyError):
                    continue
                key = (hc, jn)
                _entry.setdefault(dirn, {})
                if key not in _entry[dirn] or t < _entry[dirn][key]["t_min"]:
                    _entry[dirn][key] = {
                        "t_min": t,
                        "headcode": hc,
                        "journey_num": jn,
                        "train_class": tc,
                        "junction_name": loc,
                    }
        for dirn, mapping in _entry.items():
            baseline_by_dir[dirn] = sorted(
                mapping.values(), key=lambda x: x["t_min"])

    def _parse_hhmm(s: str) -> int | None:
        """HH:MM string → minute-of-day, or None on failure."""
        try:
            h, m = map(int, (s or "").split(":"))
            return h * 60 + m
        except Exception:
            return None

    # --- build enriched outcome rows ---
    outcomes = []
    with csv_p.open(newline="", encoding="utf-8") as fh:
        for r in _csv.DictReader(fh):
            # --- numeric coercions (tolerate missing columns) ---
            try:
                r["shift_min"] = int(r.get("shift_min") or 0)
            except (ValueError, TypeError):
                r["shift_min"] = 0

            # dep_min: present in newer CSV (field added mid-project);
            # fall back to parsing assigned_hhmm for older runs.
            raw_dep = r.get("dep_min") or ""
            try:
                r["dep_min"] = int(raw_dep) if raw_dep else (
                    _parse_hhmm(r.get("assigned_hhmm", "")))
            except (ValueError, TypeError):
                r["dep_min"] = _parse_hhmm(r.get("assigned_hhmm", ""))

            # --- enrich with candidate direction + original_dep_min ---
            cand = cand_info.get(r.get("path_id", ""), {})
            dirn = cand.get("direction", "")
            orig_min = cand.get("original_dep_min") or \
                       _parse_hhmm(r.get("original_hhmm", "")) or 0

            r["original_dep_min"] = orig_min
            r["direction"] = dirn

            # enrich with departure/arrival station names
            dinfo = divert_info.get(r.get("headcode", ""), {})
            r["first_station"] = dinfo.get("first_station", "")
            r["last_station"]  = dinfo.get("last_station", "")

            # baseline trains within the flex window (+ 15 min headway buffer)
            nearby = [
                rec for rec in baseline_by_dir.get(dirn, [])
                if abs(rec["t_min"] - orig_min) <= flex + 15
            ]
            r["nearby_baseline"] = nearby[:80]

            outcomes.append(r)

    return {
        "run_id": run_id,
        "flex_min":               flex,
        "divertible_total":       row.divertible_total,
        "div_placed":             row.div_placed,
        "div_rescheduled":        row.div_rescheduled,
        "div_conflict":           row.div_conflict,
        "div_placed_pct":         row.div_placed_pct,
        "div_mean_abs_shift_min": row.div_mean_abs_shift_min,
        "source_corridor_id":     row.source_corridor_id,
        "target_corridor_id":     row.target_corridor_id,
        "class_filter":           row.class_filter,
        "target_first_station":   target_first_station,
        "target_last_station":    target_last_station,
        "outcomes":               outcomes,
    }


@router.get("/{run_id}/file/{filename:path}")
def get_run_file(run_id: int, filename: str,
                 session: Session = Depends(get_session)):
    """Generic download for any artefact under the run's result dir."""
    row = session.get(Run, run_id)
    if not row or not row.result_dir:
        raise HTTPException(404, "no result dir")
    # Sanitise: prevent path traversal
    if "/" in filename or "\\" in filename or filename.startswith("."):
        raise HTTPException(400, "invalid filename")
    p = Path(row.result_dir) / filename
    if not p.exists():
        raise HTTPException(404, f"{filename} not found")
    media = "text/csv" if filename.endswith(".csv") \
            else "application/json" if filename.endswith(".json") \
            else "text/plain"
    return FileResponse(str(p), media_type=media, filename=filename)
