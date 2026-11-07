import asyncio
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
import uvicorn

from body_limit import BodyLimitMiddleware
from db.database import run_in_db
from db.modules.liveshare.ydoc_room import registry as yroom_registry

DATABASE_CHECK_SECONDS = 2
DATABASE_CHECK_TIMEOUT_SECONDS = 5
DATABASE_STALE_SECONDS = 15


def _ping_database(db):
    db.execute(text("SELECT 1"))


async def _check_database(app: FastAPI) -> None:
    try:
        await asyncio.wait_for(run_in_db(_ping_database), DATABASE_CHECK_TIMEOUT_SECONDS)
        app.state.database_ok_at = time.monotonic()
    except Exception as e:
        print(f"main: database check failed: {e}")


async def _watch_database(app: FastAPI) -> None:
    while True:
        await asyncio.sleep(DATABASE_CHECK_SECONDS)
        await _check_database(app)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.shutting_down = False
    app.state.database_ok_at = None
    await _check_database(app)
    watcher = asyncio.create_task(_watch_database(app))
    yield

    app.state.shutting_down = True
    watcher.cancel()
    await yroom_registry.shutdown()

app = FastAPI(lifespan=lifespan)
app.add_middleware(BodyLimitMiddleware)

@app.get("/health")
async def health():
    """Liveness: answered straight from the event loop, so it fails only if the loop itself is stuck."""
    return {"status": "ok"}

@app.get("/ready")
async def ready():
    """Readiness: reports the result of a background database check. Querying the database here would make a probe wait behind a busy connection pool and pull a healthy but loaded replica out of service."""
    if getattr(app.state, "shutting_down", False):
        raise HTTPException(status_code=503, detail="shutting down")
    checked_at = getattr(app.state, "database_ok_at", None)
    if checked_at is None or time.monotonic() - checked_at > DATABASE_STALE_SECONDS:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ready"}


_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
origins = [
    "http://localhost:12000",
    "http://127.0.0.1:12000",
    *_extra_origins,
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from modules.test.routes import router as test_router
from db.modules.docs.routes import router as doc_router
from db.modules.users.routes import router as user_router
from db.modules.liveshare.routes import router as liveshare_router

for router in [
    test_router,
    doc_router,
    user_router,
    liveshare_router
]:
    app.include_router(router)







def main():
    pass

if __name__ == "__main__":
    port = int(os.getenv("PORT", 12001))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
