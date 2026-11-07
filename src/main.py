import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from body_limit import BodyLimitMiddleware
from db.modules.liveshare.ydoc_room import registry as yroom_registry


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await yroom_registry.shutdown()

app = FastAPI(lifespan=lifespan)
app.add_middleware(BodyLimitMiddleware)

@app.get("/health")
async def health():
    """Liveness: answered straight from the event loop, so it fails only if the loop itself is stuck."""
    return {"status": "ok"}


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
