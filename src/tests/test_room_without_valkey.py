"""Live editing must keep working with no Valkey, or with a Valkey that is unreachable, and several rooms for one
document must merge through the database without losing edits. None of these tests needs a Valkey server.

Moved out of the old multi-replica suite so these paths stay covered after that suite was removed.
"""
import asyncio
import sys

import pycrdt
import pytest

from db.modules.docs.models import DocumentBlock
from db.modules.liveshare import ydoc_room
from db.modules.liveshare.backfill import BLOCKS_KEY, ydoc_blocks
from db.modules.liveshare.ydoc_room import RoomRegistry
from tests.test_docs_permissions import create_doc, signup
from tests.test_liveshare_ws import new_block_update

DEAD_VALKEY = "redis://127.0.0.1:1/0"


class DeadBus:
    """Stands in for coordination.Bus talking to a Valkey server that cannot be reached: every call fails, as the real client's would."""

    def __init__(self, url):
        pass

    async def _fail(self, *args, **kwargs):
        raise ConnectionError("valkey unreachable")

    publish_update = read_updates = trim_stream = delete_stream = _fail
    set_presence = clear_presence = publish_awareness = _fail
    subscribe_awareness = unsubscribe_awareness = _fail

    async def close(self):
        pass


class FakeSocket:
    def __init__(self):
        self.sent: list[bytes] = []

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)


def block_ids(ydoc) -> list[str]:
    return [b["id"] for b in ydoc_blocks(ydoc)]


def blocks_seen_by(socket: FakeSocket) -> set[str]:
    replica = pycrdt.Doc()
    for message in socket.sent:
        if message[0] == pycrdt.YMessageType.SYNC:
            pycrdt.handle_sync_message(message[1:], replica)
    return {b["id"] for b in replica.get(BLOCKS_KEY, type=pycrdt.Array).to_py()}


async def wait_until(condition, timeout=6.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if condition():
            return True
        await asyncio.sleep(0.05)
    return condition()


async def shutdown_all(*registries):
    for registry in registries:
        await registry.shutdown()


@pytest.fixture()
def doc_id(client):
    _, token = signup(client, "owner", "owner@example.com")
    return create_doc(client, token)


@pytest.fixture(autouse=True)
def manual_flushes(monkeypatch):
    """Keep flushes and reconciles under each test's control so results don't depend on timers."""
    monkeypatch.setattr(ydoc_room, "DEBOUNCE_SECONDS", 3600)
    monkeypatch.setattr(ydoc_room, "MAX_INTERVAL_SECONDS", 3600)
    monkeypatch.setattr(ydoc_room, "RECONCILE_SECONDS", 0)
    monkeypatch.setattr(ydoc_room.YRoom, "maybe_flush_on_interval", lambda self: None)


def test_flushing_merges_instead_of_overwriting(doc_id, db_session):
    """The original bug: with two replicas, whichever flushed last replaced the other's edits."""
    async def scenario():
        a, b = RoomRegistry(None), RoomRegistry(None)
        try:
            room_a, room_b = await a.get_or_create(doc_id), await b.get_or_create(doc_id)
            sock_a, sock_b = FakeSocket(), FakeSocket()
            await room_a.add_socket(sock_a)
            await room_b.add_socket(sock_b)

            await room_a.handle_sync(new_block_update("edit-a", "from a"), sock_a)
            await room_b.handle_sync(new_block_update("edit-b", "from b"), sock_b)

            await room_a.flush()
            await room_b.flush()

            stored = {row.id for row in db_session.query(DocumentBlock).filter(DocumentBlock.doc_id == doc_id)}
            assert {"edit-a", "edit-b"} <= stored

            await room_a.flush()
            assert "edit-b" in block_ids(room_a.ydoc)
            assert await wait_until(lambda: "edit-b" in blocks_seen_by(sock_a))
            assert block_ids(room_a.ydoc) == block_ids(room_b.ydoc)
        finally:
            await shutdown_all(a, b)

    asyncio.run(scenario())


def test_replicas_converge_through_the_database_when_valkey_is_absent(doc_id, monkeypatch):
    monkeypatch.setattr(ydoc_room, "RECONCILE_SECONDS", 0.2)

    async def scenario():
        a, b = RoomRegistry(None), RoomRegistry(None)
        try:
            room_a, room_b = await a.get_or_create(doc_id), await b.get_or_create(doc_id)
            sock_a, sock_b = FakeSocket(), FakeSocket()
            await room_a.add_socket(sock_a)
            await room_b.add_socket(sock_b)

            await room_a.handle_sync(new_block_update("via-db", "x"), sock_a)
            await room_a.flush()

            assert await wait_until(lambda: "via-db" in blocks_seen_by(sock_b))
        finally:
            await shutdown_all(a, b)

    asyncio.run(scenario())


def test_editing_still_works_when_valkey_is_down(doc_id, monkeypatch):
    monkeypatch.setattr(ydoc_room, "RECONCILE_SECONDS", 0.2)
    # The valkey package is optional, so stand in for an unreachable server instead of needing the client library.
    monkeypatch.setattr(ydoc_room, "Bus", DeadBus)
    monkeypatch.setattr(ydoc_room, "valkey_available", lambda: True)

    async def scenario():
        a, b = RoomRegistry(DEAD_VALKEY), RoomRegistry(DEAD_VALKEY)
        try:
            room_a, room_b = await a.get_or_create(doc_id), await b.get_or_create(doc_id)
            assert isinstance(room_a.bus, DeadBus), "the rooms must really be talking to the failing bus"
            sock_a, sock_b = FakeSocket(), FakeSocket()
            await room_a.add_socket(sock_a)
            await room_b.add_socket(sock_b)

            await room_a.handle_sync(new_block_update("no-valkey", "still works"), sock_a)
            assert "no-valkey" in block_ids(room_a.ydoc)
            await room_a.flush()

            assert await wait_until(lambda: "no-valkey" in blocks_seen_by(sock_b))
        finally:
            await shutdown_all(a, b)

    asyncio.run(scenario())


def test_rooms_run_without_a_bus_when_the_valkey_package_is_not_installed(doc_id, monkeypatch):
    import db.coordination as coordination

    monkeypatch.setitem(sys.modules, "valkey", None)
    monkeypatch.setattr(coordination, "_warned_missing_package", False)

    async def scenario():
        registry = RoomRegistry(DEAD_VALKEY)
        try:
            room = await registry.get_or_create(doc_id)
            assert room.bus is None
            sock = FakeSocket()
            await room.add_socket(sock)
            await room.handle_sync(new_block_update("no-package", "still works"), sock)
            assert "no-package" in block_ids(room.ydoc)
        finally:
            await shutdown_all(registry)

    asyncio.run(scenario())


def test_a_registry_can_be_reused_on_a_new_event_loop_after_shutdown():
    """The production registry is a module-level singleton, so it can outlive an event loop (tests start a new one per client). An asyncio.Lock that has ever been contended is bound to that loop; if shutdown left it behind, the next loop's first contention on the same document id raised "bound to a different event loop", intermittently, depending on timing."""
    registry = RoomRegistry(bus_url=None)

    async def contend_for_a_document():
        lock = registry._lock_for(1)

        async def holder():
            async with lock:
                await asyncio.sleep(0.05)

        async def waiter():
            await asyncio.sleep(0.01)
            async with lock:
                pass

        await asyncio.gather(holder(), waiter())
        await registry.shutdown()

    asyncio.run(contend_for_a_document())
    asyncio.run(contend_for_a_document())
