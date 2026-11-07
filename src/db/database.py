import asyncio
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

from db.url import default_database_url, normalize_database_url

load_dotenv()

DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL") or default_database_url())

is_sqlite = DATABASE_URL.startswith("sqlite")

pool_options = {} if is_sqlite else {
    "pool_size": int(os.getenv("DB_POOL_SIZE", "10")),
    "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "20")),
}

pool_limit = pool_options.get("pool_size", 0) + pool_options.get("max_overflow", 0)

engine = create_engine(
    DATABASE_URL,

    connect_args={"check_same_thread": False} if is_sqlite else {},
    pool_pre_ping=True,
    **pool_options,
)

if is_sqlite:
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def run_in_db(fn, *args):
    """Runs `fn(*args, db)` in a worker thread with a session that lives only for the call, so async code never blocks the event loop on the DB or holds a connection across awaits."""
    def call():
        with SessionLocal() as db:
            return fn(*args, db)

    return await asyncio.to_thread(call)