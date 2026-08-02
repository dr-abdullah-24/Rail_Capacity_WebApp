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
    if payload.baseline_upload_id is None:
        raise HTTPException(400,
            "baseline_upload_id (uploaded TD JSONL or events CSV) required")
    row = Run(
        name=payload.name or f"run @ {payload.date_tag or 'unknown'}",
        date_tag=payload.date_tag,
        traction=payload.traction,
        headway_min=payload.headway_min,
        dwell_max=payload.dwell_max,
        block_hours=payload.block_hours,
        time_limit_per_block=payload.time_limit_per_block,
        baseline_upload_id=payload.baseline_upload_id,
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
