"""SQLite engine + session dependency."""
from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine

from app.core.config import settings

engine = create_engine(
    settings.sqlite_url,
    connect_args={"check_same_thread": False},
    echo=False,
)


def _sqlite_type(py_type: object) -> str:
    """Map a SQLAlchemy column type to a SQLite-flavoured DDL string."""
    n = py_type.__class__.__name__.upper()
    if n in {"INTEGER", "BIGINTEGER", "SMALLINTEGER", "BOOLEAN"}: return "INTEGER"
    if n in {"FLOAT", "NUMERIC", "REAL"}: return "REAL"
    if n in {"DATETIME", "DATE", "TIME"}: return "TIMESTAMP"
    return "TEXT"


def _auto_add_missing_columns() -> None:
    """
    Very small self-migration: for every mapped SQLModel table, add any
    columns that exist on the model but not on the physical SQLite table.
    Only handles additive schema changes (which is 99% of what we do here)
    - never drops or retypes.
    """
    insp = inspect(engine)
    for table_name, table in SQLModel.metadata.tables.items():
        if not insp.has_table(table_name):
            continue
        existing = {c["name"] for c in insp.get_columns(table_name)}
        for col in table.columns:
            if col.name in existing:
                continue
            col_type = _sqlite_type(col.type)
            default = col.default.arg if col.default is not None \
                      and getattr(col.default, "is_scalar", False) else None
            ddl = f'ALTER TABLE "{table_name}" ADD COLUMN "{col.name}" {col_type}'
            if default is not None:
                ddl += f" DEFAULT {default!r}"
            with engine.begin() as conn:
                conn.execute(text(ddl))
            print(f"[db] added missing column {table_name}.{col.name} "
                  f"({col_type})", flush=True)


def init_db() -> None:
    # Import models so SQLModel picks them up before create_all
    from app.models import run, upload, corridor  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _auto_add_missing_columns()


def get_session():
    with Session(engine) as session:
        yield session
