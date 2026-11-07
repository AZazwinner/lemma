import asyncio
import os
import time
import uuid

import anyio
import pycrdt
from fastapi import WebSocket

from db.coordination import (
    KIND_AWARENESS,
    KIND_HELLO,
    PRESENCE_TTL_SECONDS,
    Bus,
    decode_awareness_payload,
    valkey_available,
)
from db.database import run_in_db
from db.modules.liveshare.backfill import (
    create_version_snapshot,
    load_or_create_ydoc,
    read_state,
    write_snapshot,
)

DEBOUNCE_SECONDS = 2
MAX_INTERVAL_SECONDS = 5

SNAPSHOT_INTERVAL_SECONDS = 10 * 60

MIN_SNAPSHOT_GAP_SECONDS = 30

RECONCILE_SECONDS = float(os.getenv("YROOM_RECONCILE_SECONDS", "10"))
PRESENCE_REFRESH_SECONDS = PRESENCE_TTL_SECONDS / 3
CLOSE_DRAIN_TIMEOUT_SECONDS = 3
RETRY_BACKOFF_MAX_SECONDS = 10

_REMOTE = object()


class YRoom:
    """Owns this replica's copy of one document's Y.Doc + Awareness, and the set of sockets connected to it.

    With several backend replicas, each replica has its own room for the same document. Local edits are applied, relayed to local sockets, and appended to a Valkey stream; every other replica's room reads that stream and applies the same updates. Yjs updates commute and are idempotent, so the copies converge whatever order or number of times updates arrive. Periodic flushes merge into Postgres, which doubles as the fallback path when Valkey is unavailable.
    """

    def __init__(
        self,
        doc_id: int,
        ydoc: pycrdt.Doc,
        bus: Bus | None = None,
        stream_id: str | None = None,
        db_state: bytes | None = None,
    ):
        self.doc_id = doc_id
        self.ydoc = ydoc
        self.awareness = pycrdt.Awareness(ydoc)
        self.sockets: set[WebSocket] = set()
        self.socket_client_ids: dict[WebSocket, set[int]] = {}

        self.uid = uuid.uuid4().hex
        self.bus = bus
        self.applied_stream_id = stream_id or "0-0"

        self._last_db_state = db_state
        self._capture: list[bytes] | None = None
        self._publish_queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._tasks: list[asyncio.Task] = []

        self._save_task: asyncio.Task | None = None
        self._flush_lock = asyncio.Lock()
        self._background: set[asyncio.Task] = set()
        self._last_save_time: float = 0.0
        self._last_snapshot_time: float = 0.0

        self.ydoc.observe(self._on_ydoc_update)
        self.awareness.observe(self._on_awareness_change)


    async def start(self) -> None:
        self._tasks.append(asyncio.create_task(self._reconcile_loop()))
        if self.bus is None:
            return
        self._tasks.extend([
            asyncio.create_task(self._subscribe_awareness()),
            asyncio.create_task(self._publish_loop()),
            asyncio.create_task(self._consume_loop()),
            asyncio.create_task(self._presence_loop()),
        ])

    async def close(self) -> None:
        """Send what's pending, persist a final snapshot, then stop background work. If the flush fails the room stays fully running so nothing is lost."""
        self.cancel_pending_save()
        await self._drain_outgoing()
        await self.flush(snapshot=True)
        await self._stop_tasks()

    async def _drain_outgoing(self) -> None:
        if self.bus is None:
            return
        pending = list(self._background)
        try:
            await asyncio.wait_for(
                asyncio.gather(self._publish_queue.join(), *pending, return_exceptions=True),
                CLOSE_DRAIN_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            pass

    async def _stop_tasks(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        if self.bus is not None:
            for cleanup in (self.bus.unsubscribe_awareness(self.doc_id), self.bus.clear_presence(self.doc_id, self.uid)):
                try:
                    await cleanup
                except Exception as e:
                    print(f"liveshare: cleanup failed for doc {self.doc_id}: {e}")

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)


    async def add_socket(self, websocket: WebSocket) -> None:
        self.sockets.add(websocket)

        await websocket.send_bytes(pycrdt.create_sync_message(self.ydoc))



        existing_ids = [
            cid for cid in self.awareness.states.keys() if cid != self.ydoc.client_id
        ]
        if existing_ids:
            update = self.awareness.encode_awareness_update(existing_ids)
            await websocket.send_bytes(pycrdt.create_awareness_message(update))

    def remove_socket(self, websocket: WebSocket) -> set[int]:
        """Detach a socket, returning any awareness client ids it owned."""
        self.sockets.discard(websocket)
        return self.socket_client_ids.pop(websocket, set())

    def forget_clients(self, client_ids: set[int], origin: WebSocket) -> None:
        if client_ids:
            self.awareness.remove_awareness_states(list(client_ids), origin=origin)


    async def handle_sync(self, raw_message: bytes, sender: WebSocket) -> None:
        inner = raw_message[1:]
        self._capture = []
        try:
            reply = pycrdt.handle_sync_message(inner, self.ydoc)
        finally:
            updates, self._capture = self._capture, None
        if reply is not None:

            await sender.send_bytes(reply)
            return


        await self.broadcast(raw_message, sender)
        for update in updates:
            if self.bus is not None:
                self._publish_queue.put_nowait(update)
        self.touch_save_timer()
        self.maybe_flush_on_interval()

    async def handle_awareness(self, raw_message: bytes, sender: WebSocket) -> None:
        inner = pycrdt.read_message(raw_message[1:])
        self.awareness.apply_awareness_update(inner, origin=sender)

    def apply_external(self, update: bytes) -> None:
        """Apply an update that didn't come from a local socket (another replica, or the database) and relay whatever it changed to every local socket. Never republished, so replicas can't echo each other."""
        self._capture = []
        try:
            self.ydoc.apply_update(update)
        finally:
            changes, self._capture = self._capture, None
        for change in changes:
            self._spawn(self.broadcast(pycrdt.create_update_message(change), None))

    async def apply_server_edit(self, edit) -> bool:
        """Runs `edit(ydoc)` and sends what it changed exactly as an update from a local socket is sent: to every socket in this room, to the other replicas through the bus, and to the database through the debounced save. Used by modules (the Sidekick) that write into a document on a user's behalf. Normal editing never goes through here. Returns False if the edit changed nothing.

        Nothing here awaits between starting and stopping the capture, so a socket's own update can't be mixed in."""
        self._capture = []
        try:
            edit(self.ydoc)
        finally:
            updates, self._capture = self._capture, None
        for update in updates:
            await self.broadcast(pycrdt.create_update_message(update), None)
            if self.bus is not None:
                self._publish_queue.put_nowait(update)
        if updates:
            self.touch_save_timer()
            self.maybe_flush_on_interval()
        return bool(updates)

    def _on_ydoc_update(self, event) -> None:
        if self._capture is not None:
            self._capture.append(event.update)


    def _on_awareness_change(self, topic: str, payload) -> None:
        if topic != "update":
            return
        changes, origin = payload
        changed_ids = changes["added"] + changes["updated"] + changes["removed"]
        if not changed_ids:
            return

        is_remote = origin is _REMOTE
        if origin is not None and not is_remote:
            ids = self.socket_client_ids.setdefault(origin, set())
            ids.update(changes["added"] + changes["updated"])
            for cid in changes["removed"]:
                ids.discard(cid)

        update = self.awareness.encode_awareness_update(changed_ids)
        message = pycrdt.create_awareness_message(update)
        sender = origin if origin is not None and not is_remote else None
        asyncio.create_task(self.broadcast(message, sender))

        if self.bus is not None and not is_remote:
            self._spawn(self._publish_awareness(update))

    async def _publish_awareness(self, update: bytes, kind: int = KIND_AWARENESS) -> None:
        try:
            await self.bus.publish_awareness(self.doc_id, self.uid, kind, update)
        except Exception as e:
            print(f"liveshare: awareness publish failed for doc {self.doc_id}: {e}")

    def _on_bus_awareness(self, data: bytes) -> None:
        origin_uid, kind, payload = decode_awareness_payload(data)
        if origin_uid == self.uid:
            return
        if kind == KIND_AWARENESS:
            self.awareness.apply_awareness_update(payload, origin=_REMOTE)
        elif kind == KIND_HELLO:
            local_ids = [cid for ids in self.socket_client_ids.values() for cid in ids]
            if local_ids:
                self._spawn(self._publish_awareness(self.awareness.encode_awareness_update(local_ids)))

    async def broadcast(self, message: bytes, sender: WebSocket | None) -> None:
        dead = []
        for ws in list(self.sockets):
            if ws is sender:
                continue
            try:
                await ws.send_bytes(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.sockets.discard(ws)
            self.socket_client_ids.pop(ws, None)


    async def _subscribe_awareness(self) -> None:
        backoff = 0.5
        while True:
            try:
                await self.bus.subscribe_awareness(self.doc_id, self._on_bus_awareness)
                await self.bus.publish_awareness(self.doc_id, self.uid, KIND_HELLO)
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"liveshare: awareness subscribe failed for doc {self.doc_id}: {e}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, RETRY_BACKOFF_MAX_SECONDS)

    async def _publish_loop(self) -> None:
        while True:
            update = await self._publish_queue.get()
            try:
                await self.bus.publish_update(self.doc_id, self.uid, update)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"liveshare: update publish failed for doc {self.doc_id}, other replicas will catch up via the database: {e}")
            finally:
                self._publish_queue.task_done()

    async def _consume_loop(self) -> None:
        backoff = 0.5
        while True:
            try:
                entries = await self.bus.read_updates(self.doc_id, self.applied_stream_id)
                backoff = 0.5
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"liveshare: stream read failed for doc {self.doc_id}: {e}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, RETRY_BACKOFF_MAX_SECONDS)
                continue

            for entry_id, origin_uid, update in entries:
                if origin_uid != self.uid:
                    self.apply_external(update)
                self.applied_stream_id = entry_id

    async def _reconcile_loop(self) -> None:
        """Pulls in what other replicas have persisted. Redundant while Valkey is healthy; it's what keeps replicas converging when it isn't."""
        if RECONCILE_SECONDS <= 0:
            return
        while True:
            await asyncio.sleep(RECONCILE_SECONDS)
            if self._flush_lock.locked():
                continue
            try:
                state = await run_in_db(read_state, self.doc_id)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"liveshare: reconcile failed for doc {self.doc_id}: {e}")
                continue
            if state is not None and state != self._last_db_state:
                self._last_db_state = state
                self.apply_external(state)

    async def _presence_loop(self) -> None:
        while True:
            try:
                await self.bus.set_presence(self.doc_id, self.uid)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"liveshare: presence update failed for doc {self.doc_id}: {e}")
            await asyncio.sleep(PRESENCE_REFRESH_SECONDS)


    def touch_save_timer(self) -> None:
        if self._save_task is not None:
            self._save_task.cancel()
        self._save_task = asyncio.create_task(self._debounce_save())

    async def _debounce_save(self) -> None:
        try:
            await asyncio.sleep(DEBOUNCE_SECONDS)
            await asyncio.shield(self._flush_logged())
        except asyncio.CancelledError:
            return

    async def _flush_logged(self, snapshot: bool = False) -> None:
        try:
            await self.flush(snapshot=snapshot)
        except Exception as e:
            print(f"liveshare: flush failed for doc {self.doc_id}: {e}")

    def cancel_pending_save(self) -> None:
        if self._save_task is not None:
            self._save_task.cancel()
            self._save_task = None

    async def flush(self, snapshot: bool = False) -> None:
        """Merges this replica's state into the database under the document lock. Serialized per room, and the Y.Doc is read on the event loop before the DB write moves to a worker thread, so an older snapshot can't land after a newer one and the doc is never touched from two threads."""
        async with self._flush_lock:
            state = self.ydoc.get_update()
            applied_stream_id = self.applied_stream_id
            now = time.time()
            self._last_save_time = now

            result = await run_in_db(write_snapshot, self.doc_id, state, applied_stream_id, snapshot)

            if result.prior_state is not None and result.prior_state != self._last_db_state:
                self.apply_external(result.prior_state)
            self._last_db_state = result.merged_state

            if self.bus is not None:
                try:
                    await self.bus.trim_stream(self.doc_id, result.stream_id)
                except Exception as e:
                    print(f"liveshare: stream trim failed for doc {self.doc_id}: {e}")

            if snapshot and now - self._last_snapshot_time > MIN_SNAPSHOT_GAP_SECONDS:
                await run_in_db(create_version_snapshot, self.doc_id, result.blocks)
                self._last_snapshot_time = now

    def maybe_flush_on_interval(self) -> None:
        now = time.time()
        if self._flush_lock.locked() or now - self._last_save_time <= MAX_INTERVAL_SECONDS:
            return

        self._last_save_time = now
        due_for_snapshot = now - self._last_snapshot_time > SNAPSHOT_INTERVAL_SECONDS
        self._spawn(self._flush_logged(snapshot=due_for_snapshot))


_FROM_ENV = object()


class RoomRegistry:
    def __init__(self, bus_url: str | None | object = _FROM_ENV):
        self.rooms: dict[int, YRoom] = {}
        self._locks: dict[int, asyncio.Lock] = {}
        self._bus_url = bus_url
        self._bus: Bus | None = None
        self._bus_loop: asyncio.AbstractEventLoop | None = None

    def _lock_for(self, doc_id: int) -> asyncio.Lock:
        return self._locks.setdefault(doc_id, asyncio.Lock())

    def _current_bus(self) -> Bus | None:
        url = os.getenv("VALKEY_URL") if self._bus_url is _FROM_ENV else self._bus_url
        if not url or not valkey_available():
            return None
        loop = asyncio.get_running_loop()
        if self._bus is None or self._bus_loop is not loop:
            self._bus = Bus(url)
            self._bus_loop = loop
        return self._bus

    async def get_or_create(self, doc_id: int) -> YRoom:
        async with self._lock_for(doc_id):
            room = self.rooms.get(doc_id)
            if room is None:
                loaded = await run_in_db(load_or_create_ydoc, doc_id)
                bus = self._current_bus()
                if loaded.created and bus is not None:
                    try:
                        await bus.delete_stream(doc_id)
                    except Exception as e:
                        print(f"liveshare: could not clear stale stream for doc {doc_id}: {e}")

                ydoc = pycrdt.Doc()
                ydoc.apply_update(loaded.state)
                room = YRoom(doc_id, ydoc, bus, stream_id=loaded.stream_id, db_state=loaded.state)
                await room.start()
                self.rooms[doc_id] = room
            return room

    async def drop_socket(self, doc_id: int, websocket: WebSocket) -> None:
        """Shielded from cancellation: this runs from the endpoint's `finally`, and if the server cancels the handler the last flush must still finish."""
        with anyio.CancelScope(shield=True):
            async with self._lock_for(doc_id):
                room = self.rooms.get(doc_id)
                if room is None:
                    return
                client_ids = room.remove_socket(websocket)
                room.forget_clients(client_ids, origin=websocket)

                if not room.sockets:
                    await room.close()
                    del self.rooms[doc_id]

    async def shutdown(self) -> None:
        """Called from the FastAPI lifespan shutdown hook."""
        rooms = list(self.rooms.values())
        for room in rooms:
            room.cancel_pending_save()
        results = await asyncio.gather(*(room.close() for room in rooms), return_exceptions=True)
        for room, result in zip(rooms, results):
            if isinstance(result, Exception):
                print(f"liveshare: final flush failed for doc {room.doc_id}: {result}")
        if self._bus is not None:
            await self._bus.close()
            self._bus = None
        # Rooms are closed and their tasks stopped, and an asyncio.Lock that has been contended stays bound to
        # this event loop. Leaving either behind would break the next loop that uses this registry.
        self.rooms.clear()
        self._locks.clear()


registry = RoomRegistry()
