"""Central runtime configuration.  Reads env vars via pydantic-settings."""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Rail Corridor Capacity"

    # Filesystem paths - default to sibling folders under backend/data/
    data_root: Path = Path(__file__).resolve().parents[2] / "data"
    uploads_dir: Path = data_root / "uploads"
    runs_dir: Path = data_root / "runs"
    sqlite_url: str = f"sqlite:///{(data_root / 'app.db').as_posix()}"

    # Legacy — kept only so the /health endpoint can report if the old
    # external MILP repo exists on disk. Nothing else uses it.
    milp_repo: Path = Path(
        r"C:\Users\LOQ\OneDrive - Liverpool John Moores University"
        r"\LIV_MAN_Capacity_MILP_2018"
    )
    # Rail Insights location dataset (berths-geo.json) - local copy
    berths_geo: Path = data_root / "berths-geo.json"
    # Scripts bundled with the web app (self-contained pipeline code)
    local_scripts: Path = Path(__file__).resolve().parents[2] / "scripts"

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    model_config = SettingsConfigDict(env_prefix="CAP_", env_file=".env",
                                       extra="ignore")


settings = Settings()
settings.uploads_dir.mkdir(parents=True, exist_ok=True)
settings.runs_dir.mkdir(parents=True, exist_ok=True)
