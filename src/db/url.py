from pathlib import Path

# The src/ folder, wherever the backend is started from.
SRC_DIR = Path(__file__).resolve().parent.parent


def default_database_url() -> str:
    """A SQLite file next to the backend code (src/mathboard.db), so the app runs with no configuration at all. The path is absolute, so it is the same file whatever directory the backend or Alembic is started from."""
    return f"sqlite:///{(SRC_DIR / 'mathboard.db').as_posix()}"


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url
