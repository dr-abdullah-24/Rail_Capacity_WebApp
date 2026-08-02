from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["meta"])


@router.get("/health")
def health():
    return {"status": "ok",
            "app": settings.app_name,
            "milp_repo": str(settings.milp_repo),
            "milp_repo_exists": settings.milp_repo.exists()}
