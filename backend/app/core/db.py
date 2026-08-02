"""SQLite engine + session dependency."""
from sqlmodel import SQLModel, Session, create_engine

from app.core.config import settings

engine = create_engine(
    settings.sqlite_url,
    connect_args={"check_same_thread": False},
    echo=False,
)


def init_db() -> None:
    # Import models so SQLModel picks them up before create_all
    from app.models import run, upload, corridor  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
