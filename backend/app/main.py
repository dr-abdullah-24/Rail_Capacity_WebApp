"""FastAPI application entry."""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import corridors, health, locations, runs, srt, tpr, uploads, websocket
from app.core.config import settings
from app.core.db import init_db

_DIST = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(uploads.router)
app.include_router(runs.router)
app.include_router(corridors.router)
app.include_router(locations.router)
app.include_router(srt.router)
app.include_router(tpr.router)
app.include_router(websocket.router)

# Serve built React frontend when the dist folder exists.
# All API routes are registered above so they take priority.
if os.path.isdir(_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_DIST, "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str = ""):
        return FileResponse(os.path.join(_DIST, "index.html"))
else:
    @app.get("/")
    def root():
        return {"name": settings.app_name, "docs": "/docs"}
