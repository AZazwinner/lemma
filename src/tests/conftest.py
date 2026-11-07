import os
import tempfile
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
IS_POSTGRES = bool(TEST_DATABASE_URL) and TEST_DATABASE_URL.startswith("postgres")

if TEST_DATABASE_URL:
    _database_name = make_url(TEST_DATABASE_URL).database or ""
    assert "test" in _database_name, (
        "TEST_DATABASE_URL must point at a database whose name contains 'test': "
        "the suite drops and recreates its schema"
    )
    _TMP_DB_PATH = None
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
else:
    _TMP_DB_FD, _TMP_DB_PATH = tempfile.mkstemp(suffix=".db")
    os.close(_TMP_DB_FD)
    os.environ["DATABASE_URL"] = f"sqlite:///{_TMP_DB_PATH}"

TEST_VALKEY_URL = os.getenv("TEST_VALKEY_URL")
if TEST_VALKEY_URL:
    os.environ["VALKEY_URL"] = TEST_VALKEY_URL
else:
    os.environ.pop("VALKEY_URL", None)

os.environ["SECRET_KEY"] = "test-secret-key-do-not-use-in-production"
os.environ["CORS_ORIGINS"] = ""
for _name in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_PORT", "SMTP_FROM", "ALLOW_DEV_RESET_LINK", "SIGNUP_MAX_ATTEMPTS"):
    os.environ.pop(_name, None)

from sqlalchemy import text

from db.base import Base
from db.database import engine, SessionLocal


from db.core.auth import models as _auth_models  # noqa: F401
from db.modules.users import models as _user_models  # noqa: F401
from db.modules.docs import models as _doc_models  # noqa: F401


ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"


def _migrate_postgres_to_head() -> None:
    from alembic import command
    from alembic.config import Config

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    command.upgrade(Config(str(ALEMBIC_INI)), "head")


@pytest.fixture(scope="session", autouse=True)
def _setup_database():
    if IS_POSTGRES:
        _migrate_postgres_to_head()
    else:
        Base.metadata.create_all(bind=engine)
    yield
    engine.dispose()
    if _TMP_DB_PATH is not None:
        os.remove(_TMP_DB_PATH)


@pytest.fixture(autouse=True)
def _clean_tables():
    """Each test starts with empty tables, regardless of what a previous test committed."""
    yield
    with engine.begin() as conn:
        if IS_POSTGRES:
            names = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
            conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        else:
            for table in reversed(Base.metadata.sorted_tables):
                conn.execute(table.delete())


@pytest.fixture(autouse=True)
def _clean_valkey():
    def wipe():
        if not TEST_VALKEY_URL:
            return
        import valkey
        client = valkey.Valkey.from_url(TEST_VALKEY_URL)
        for key in client.scan_iter(match="mb:*", count=500):
            client.delete(key)
        client.close()

    wipe()
    yield
    wipe()


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The rate limiter's login/signup throttle state is a module-level dict shared
    across the whole process - reset it so one test's lockout can't bleed into another."""
    from db.core.auth import rate_limit
    rate_limit._attempts.clear()
    rate_limit._locked_until.clear()
    yield


@pytest.fixture()
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app) as c:
        yield c
