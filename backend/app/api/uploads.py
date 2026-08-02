"""Upload endpoints for TD JSONL, events CSV, or pre-built baselines."""
import shutil
import uuid
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import get_session
from app.models.upload import Upload
from app.services.td_scanner import scan as scan_dates

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/", response_model=Upload)
async def upload_file(
    file: UploadFile = File(...),
    kind: str = Form("td_jsonl"),
    date_tag: Optional[str] = Form(None),
    session: Session = Depends(get_session),
):
    if kind not in {"td_jsonl", "td_tbz2", "events_csv", "baseline_csv",
                    "candidate_paths_csv", "srt_profile_csv",
                    "freight_lines_json"}:
        raise HTTPException(400, f"unknown kind '{kind}'")

    filename = f"{uuid.uuid4().hex}_{Path(file.filename).name}"
    dest = settings.uploads_dir / filename
    async with aiofiles.open(dest, "wb") as fh:
        while chunk := await file.read(1024 * 1024):
            await fh.write(chunk)

    row = Upload(
        original_name=file.filename or "unnamed",
        stored_path=str(dest),
        kind=kind,
        date_tag=date_tag,
        size_bytes=dest.stat().st_size,
    )
    session.add(row); session.commit(); session.refresh(row)
    return row


@router.get("/", response_model=list[Upload])
def list_uploads(session: Session = Depends(get_session)):
    return session.exec(select(Upload).order_by(Upload.uploaded_at.desc())).all()


@router.delete("/{upload_id}")
def delete_upload(upload_id: int, session: Session = Depends(get_session)):
    row = session.get(Upload, upload_id)
    if not row:
        raise HTTPException(404, "upload not found")
    p = Path(row.stored_path)
    if p.exists():
        p.unlink()
    session.delete(row); session.commit()
    return {"deleted": upload_id}


@router.post("/{upload_id}/scan", response_model=Upload)
def scan_upload(upload_id: int, session: Session = Depends(get_session)):
    row = session.get(Upload, upload_id)
    if not row:
        raise HTTPException(404, "upload not found")
    dates = scan_dates(Path(row.stored_path), row.kind)
    row.available_dates = dates
    # If no explicit date_tag and exactly one date detected, adopt it
    if not row.date_tag and len(dates) == 1:
        row.date_tag = dates[0]
    session.add(row); session.commit(); session.refresh(row)
    return row
