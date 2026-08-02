"""Search UK rail locations by name / TIPLOC / CRS / STANOX for the
corridor builder."""
from fastapi import APIRouter, Query

from app.services.locations import search as search_locations, stats

router = APIRouter(prefix="/locations", tags=["locations"])


@router.get("/search")
def search(q: str = Query("", description="Free-text query"),
           limit: int = Query(25, ge=1, le=100)):
    return search_locations(q, limit=limit)


@router.get("/stats")
def get_stats():
    return stats()
