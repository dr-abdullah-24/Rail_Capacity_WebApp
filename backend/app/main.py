"""FastAPI application entry."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import corridors, health, locations, runs, uploads, websocket
from app.core.config import settings
from app.core.db import init_db


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
app.include_router(websocket.router)


@app.get("/")
def root():
    return {"name": settings.app_name, "docs": "/docs"}
