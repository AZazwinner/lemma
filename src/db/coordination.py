import asyncio
import importlib.util
import os
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import valkey

# Valkey is optional and its package is not in requirements.txt: it is only needed to share live edits and
# login rate limits between several backend processes. Install it with `pip install valkey` and set VALKEY_URL.
# Everything below imports it lazily, so this module loads without it.

STREAM_TTL_SECONDS = 3600
STREAM_MAXLEN = 50_000
STREAM_TRIM_SAFETY_MS = 5 * 60 * 1000
PRESENCE_TTL_SECONDS = 30
READ_BLOCK_MS = 5000

KIND_AWARENESS = 0
KIND_HELLO = 1
_UID_LEN = 32


def stream_key(doc_id: int) -> str:
    return f"mb:ydoc:{doc_id}"


def awareness_channel(doc_id: int) -> str:
    return f"mb:aw:{doc_id}"


def presence_key(doc_id: int, room_uid: str) -> str:
    return f"mb:live:{doc_id}:{room_uid}"


def parse_stream_id(stream_id: str | None) -> tuple[int, int]:
    if not stream_id:
        return (0, 0)
    ms, _, seq = stream_id.partition("-")
    return (int(ms), int(seq or 0))


def max_stream_id(a: str | None, b: str | None) -> str | None:
    if parse_stream_id(a) >= parse_stream_id(b):
        return a or b
    return b


def encode_awareness_payload(room_uid: str, kind: int, payload: bytes) -> bytes:
    return room_uid.encode() + bytes([kind]) + payload


def decode_awareness_payload(data: bytes) -> tuple[str, int, bytes]:
    return data[:_UID_LEN].decode(), data[_UID_LEN], data[_UID_LEN + 1:]


class Bus:
    """Async Valkey access for live rooms: an update stream per document (durable, replayable), a pub/sub channel per document for ephemeral awareness (cursors), and presence keys."""

    def __init__(self, url: str):
        import valkey.asyncio as avalkey

        self._client = avalkey.Valkey.from_url(
            url,
            socket_connect_timeout=3,
            socket_timeout=READ_BLOCK_MS / 1000 + 10,
            health_check_interval=15,
        )
        self._pubsub = None
        self._handlers: dict[bytes, object] = {}
        self._listener: asyncio.Task | None = None
        self._has_handlers = asyncio.Event()

    async def publish_update(self, doc_id: int, room_uid: str, update: bytes) -> None:
        key = stream_key(doc_id)
        async with self._client.pipeline(transaction=False) as pipe:
            pipe.xadd(key, {"o": room_uid, "u": update}, maxlen=STREAM_MAXLEN, approximate=True)
            pipe.expire(key, STREAM_TTL_SECONDS)
            await pipe.execute()

    async def read_updates(self, doc_id: int, after_id: str) -> list[tuple[str, str, bytes]]:
        response = await self._client.xread({stream_key(doc_id): after_id}, count=200, block=READ_BLOCK_MS)
        entries = []
        for _key, items in response or []:
            for entry_id, fields in items:
                entries.append((entry_id.decode(), fields[b"o"].decode(), fields[b"u"]))
        return entries

    async def trim_stream(self, doc_id: int, flushed_id: str | None) -> None:
        flushed_ms = parse_stream_id(flushed_id)[0]
        threshold_ms = min(flushed_ms, int(time.time() * 1000) - STREAM_TRIM_SAFETY_MS)
        if threshold_ms > 0:
            await self._client.xtrim(stream_key(doc_id), minid=f"{threshold_ms}-0", approximate=True)

    async def delete_stream(self, doc_id: int) -> None:
        await self._client.delete(stream_key(doc_id))

    async def set_presence(self, doc_id: int, room_uid: str) -> None:
        await self._client.set(presence_key(doc_id, room_uid), 1, ex=PRESENCE_TTL_SECONDS)

    async def clear_presence(self, doc_id: int, room_uid: str) -> None:
        await self._client.delete(presence_key(doc_id, room_uid))

    async def publish_awareness(self, doc_id: int, room_uid: str, kind: int, payload: bytes = b"") -> None:
        await self._client.publish(awareness_channel(doc_id), encode_awareness_payload(room_uid, kind, payload))

    async def subscribe_awareness(self, doc_id: int, handler) -> None:
        channel = awareness_channel(doc_id).encode()
        self._handlers[channel] = handler
        if self._pubsub is None:
            self._pubsub = self._client.pubsub()
        await self._pubsub.subscribe(channel)
        self._has_handlers.set()
        if self._listener is None:
            self._listener = asyncio.create_task(self._listen())

    async def unsubscribe_awareness(self, doc_id: int) -> None:
        channel = awareness_channel(doc_id).encode()
        self._handlers.pop(channel, None)
        if not self._handlers:
            self._has_handlers.clear()
        if self._pubsub is not None:
            await self._pubsub.unsubscribe(channel)

    async def _listen(self) -> None:
        while True:
            await self._has_handlers.wait()
            try:
                async for message in self._pubsub.listen():
                    if message["type"] != "message":
                        continue
                    handler = self._handlers.get(message["channel"])
                    if handler is not None:
                        handler(message["data"])
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"coordination: awareness listener error: {e}")
                await asyncio.sleep(1)
                await self._resubscribe()
            await asyncio.sleep(0.05)

    async def _resubscribe(self) -> None:
        try:
            await self._pubsub.aclose()
        except Exception:
            pass
        self._pubsub = self._client.pubsub()
        if self._handlers:
            await self._pubsub.subscribe(*self._handlers.keys())

    async def close(self) -> None:
        if self._listener is not None:
            self._listener.cancel()
        if self._pubsub is not None:
            await self._pubsub.aclose()
        await self._client.aclose()


_sync_client: "valkey.Valkey | None" = None
_warned_missing_package = False


def valkey_available() -> bool:
    """Whether the valkey package can be imported. Call it only once a URL is configured: if the package is missing, warn once and let the caller carry on without Valkey instead of failing logins or live editing."""
    global _warned_missing_package
    if importlib.util.find_spec("valkey") is not None:
        return True
    if not _warned_missing_package:
        _warned_missing_package = True
        print("coordination: VALKEY_URL is set but the valkey package is not installed (pip install valkey); running without Valkey")
    return False


def get_sync_client() -> "valkey.Valkey | None":
    """Blocking client for the sync request handlers (rate limiting, restore checks); None when Valkey isn't configured or its package isn't installed."""
    global _sync_client
    url = os.getenv("VALKEY_URL")
    if not url or not valkey_available():
        return None
    if _sync_client is None:
        import valkey
        _sync_client = valkey.Valkey.from_url(url, socket_connect_timeout=1, socket_timeout=1)
    return _sync_client


def is_document_live_elsewhere(doc_id: int) -> bool:
    """True if any backend replica has a live room for this document. Fails closed: if Valkey is configured but unreachable, assume it is live."""
    client = get_sync_client()
    if client is None:
        return False
    try:
        return next(client.scan_iter(match=f"mb:live:{doc_id}:*", count=100), None) is not None
    except Exception:
        return True


def clear_document_stream(doc_id: int) -> None:
    client = get_sync_client()
    if client is None:
        return
    try:
        client.delete(stream_key(doc_id))
    except Exception as e:
        print(f"coordination: could not clear stream for doc {doc_id}: {e}")
