"""TPR Library endpoint.

Lists all Network Rail Train Planning Rule documents available under
backend/data/TPR <year>/ and serves them as file downloads.

Documents are scanned from the filesystem at request time so that newly
added PDF folders are automatically picked up without a server restart.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/tpr", tags=["tpr"])

# Root of the data directory (two levels up from this file: api/ → app/ → backend/).
_DATA_ROOT = Path(__file__).resolve().parents[2] / "data"

# Human-readable labels for TPR route codes.
_ROUTE_LABELS: dict[str, str] = {
    "AR":  "Anglia",
    "EM":  "East Midlands",
    "KS":  "Kent",
    "KT":  "Kent",
    "LNE": "London North Eastern",
    "LNW": "North West & Central",
    "NAT": "National",
    "NWC": "North West & Central",
    "SC":  "Scotland",
    "SX":  "Sussex",
    "WR":  "Western",
    "WW":  "Wales & Western",
    "WX":  "Wales & Western",
}

# Patterns for filenames like "TPR 2026 V3 NWC.pdf" or "TPR 2021 V4.pdf"
_RE_ROUTE    = re.compile(r"^TPR\s+(\d{4})\s+(V\d+)\s+([A-Z]+)\.pdf$", re.I)
_RE_NATIONAL = re.compile(r"^TPR\s+(\d{4})\s+(V\d+)\.pdf$", re.I)


def _scan_tpr_dirs() -> list[Path]:
    """Return all 'TPR <year>' sub-directories that exist under _DATA_ROOT."""
    return sorted(
        p for p in _DATA_ROOT.iterdir()
        if p.is_dir() and re.match(r"^TPR\s+\d{4}$", p.name, re.I)
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/index")
def tpr_index() -> list[dict]:
    """Return metadata for every TPR PDF found in data/TPR <year>/ folders."""
    docs: list[dict] = []
    for tpr_dir in _scan_tpr_dirs():
        folder = tpr_dir.name
        for pdf in sorted(tpr_dir.glob("*.pdf")):
            m = _RE_ROUTE.match(pdf.name)
            if m:
                year, version, route = m.group(1), m.group(2), m.group(3).upper()
                docs.append({
                    "year":        int(year),
                    "version":     version,
                    "route":       route,
                    "route_label": _ROUTE_LABELS.get(route, route),
                    "filename":    pdf.name,
                    "folder":      folder,
                    "size_bytes":  pdf.stat().st_size,
                })
            else:
                m2 = _RE_NATIONAL.match(pdf.name)
                if m2:
                    year, version = m2.group(1), m2.group(2)
                    docs.append({
                        "year":        int(year),
                        "version":     version,
                        "route":       "NAT",
                        "route_label": "National",
                        "filename":    pdf.name,
                        "folder":      folder,
                        "size_bytes":  pdf.stat().st_size,
                    })
    return docs


@router.get("/structured")
def tpr_structured() -> dict:
    """Return the pre-parsed TPR structured data (EA, SRT, loops per route/year)."""
    path = _DATA_ROOT / "tpr_structured.json"
    if not path.exists():
        raise HTTPException(404, "tpr_structured.json not found")
    return json.loads(path.read_text(encoding="utf-8"))


@router.get("/document")
def serve_tpr(folder: str, filename: str) -> FileResponse:
    """Stream a specific TPR PDF to the client.

    Both ``folder`` (e.g. ``TPR 2026``) and ``filename`` are validated
    against the filesystem to prevent path-traversal attacks.
    """
    # Reject path-traversal attempts.
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "invalid filename")
    if ".." in folder or "/" in folder:
        raise HTTPException(400, "invalid folder")
    if not re.match(r"^TPR\s+\d{4}$", folder, re.I):
        raise HTTPException(400, "unknown folder format")

    path = _DATA_ROOT / folder / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "document not found")

    return FileResponse(
        path,
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
