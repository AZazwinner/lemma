"""The Sidekick as a collaborator in a live document.

While it works on something a user asked for, it shows up in the document's presence list like another person ("Sidekick",
with its own colour), and what it writes arrives as a normal edit: a new block, inserted into the room's Y.Doc and sent to
everyone through the room's usual path (sockets, other replicas, the debounced save).

It only ever acts on a request from a signed-in user who can write to the document, and only while that request is running
and for a few seconds afterwards. It never watches the document and never edits on its own.

This file holds no sync logic: presence is an ordinary awareness entry applied to the room's Awareness, and the edit goes
through YRoom.apply_server_edit.
"""

import asyncio
import json
import random
import time
import uuid

import pycrdt
from fastapi import HTTPException

from db.database import run_in_db
from db.modules.docs.services import user_can_write_document
from db.modules.liveshare.backfill import BLOCKS_KEY
from db.modules.liveshare.ydoc_room import YRoom, registry

NAME = "Sidekick"
COLOR = "hsl(265, 70%, 55%)"
COLOR_LIGHT = "hsl(265, 70%, 92%)"

# How long it stays in the presence list after it finishes, so people see where it wrote.
LINGER_SECONDS = 8
# Browsers forget a collaborator they haven't heard from for 30 seconds. This keeps one fresh while it works.
HEARTBEAT_SECONDS = 10
# How often it looks at the clock to see whether it should go. Cheap, and keeps "leave in 8 seconds" accurate.
CHECK_SECONDS = 0.5
# The longest a single request can take (Google timeout plus a margin), so a crashed request can't leave it hanging around.
MAX_WORK_SECONDS = 90

_ORIGIN = object()


class SidekickPresence:
    """One awareness entry in one room, under its own client id."""

    def __init__(self, room: YRoom):
        self.room = room
        # A throwaway Doc, only to get an awareness client id that can't collide with a person's.
        self._awareness = pycrdt.Awareness(pycrdt.Doc(client_id=random.randrange(2**31, 2**32)))
        self._cursor: dict | None = None
        self._until = 0.0
        self._joined = False
        self._task: asyncio.Task | None = None

    def _state(self) -> dict:
        state: dict = {"user": {"name": NAME, "color": COLOR, "colorLight": COLOR_LIGHT, "kind": "ai"}}
        if self._cursor:
            state["cursor"] = self._cursor
        return state

    def _publish(self, state: dict | None) -> None:
        self._awareness.set_local_state(state)
        update = self._awareness.encode_awareness_update([self._awareness.client_id])
        self.room.awareness.apply_awareness_update(update, origin=_ORIGIN)

    def _room_is_live(self) -> bool:
        return registry.rooms.get(self.room.doc_id) is self.room

    def stay(self, seconds: float) -> None:
        """Be present for at least `seconds` more, joining if not already here."""
        self._until = max(self._until, time.monotonic() + seconds)
        if not self._joined and self._room_is_live():
            self._joined = True
            self._publish(self._state())
        if self._joined and (self._task is None or self._task.done()):
            self._task = asyncio.create_task(self._keep_present())

    def finish(self, linger: float) -> None:
        """Work is done: stay `linger` more seconds, then go."""
        self._until = time.monotonic() + linger
        if linger <= 0:
            self.leave()

    def point_at_end_of(self, text: pycrdt.Text) -> None:
        """Park the cursor at the end of `text`, which shows as Sidekick's caret in that block."""
        position = text.sticky_index(len(text), pycrdt.Assoc.BEFORE).to_json()
        if isinstance(position, str):
            position = json.loads(position)
        self._cursor = {"anchor": position, "head": position}
        if self._joined:
            self._publish(self._state())

    def leave(self) -> None:
        if self._joined:
            self._joined = False
            self._cursor = None
            try:
                self._publish(None)
            except Exception as e:
                print(f"sidekick: could not remove presence: {e}")
        if _presences.get(self.room.doc_id) is self:
            del _presences[self.room.doc_id]

    async def _keep_present(self) -> None:
        """Re-announces itself every HEARTBEAT_SECONDS and leaves once `_until` has passed. It checks often, because `_until` can be pulled in when work finishes."""
        last_announced = time.monotonic()
        try:
            while self._joined and self._room_is_live():
                now = time.monotonic()
                if now >= self._until:
                    break
                if now - last_announced >= HEARTBEAT_SECONDS:
                    self._publish(self._state())
                    last_announced = now
                await asyncio.sleep(min(CHECK_SECONDS, HEARTBEAT_SECONDS))
        finally:
            self.leave()


_presences: dict[int, SidekickPresence] = {}


def presence_for(room: YRoom) -> SidekickPresence:
    existing = _presences.get(room.doc_id)
    if existing is None or existing.room is not room:
        existing = SidekickPresence(room)
        _presences[room.doc_id] = existing
    return existing


def _can_write(doc_id: int, user_id: int, db) -> bool:
    return user_can_write_document(doc_id, user_id, db)


async def require_room(doc_id: int, user_id: int) -> YRoom:
    """The live room for a document the user can write to, or an HTTP error. Never creates a room: if nobody has the document open there is nothing to collaborate in."""
    if not await run_in_db(_can_write, doc_id, user_id):
        raise HTTPException(403, detail={"code": "forbidden", "message": "You can't edit this document."})
    room = registry.rooms.get(doc_id)
    if room is None:
        raise HTTPException(409, detail={"code": "not_open", "message": "Open the document first."})
    return room


def working(room: YRoom) -> None:
    presence_for(room).stay(MAX_WORK_SECONDS)


def done(room: YRoom, linger: float | None = None) -> None:
    presence = _presences.get(room.doc_id)
    if presence is not None and presence.room is room:
        presence.finish(LINGER_SECONDS if linger is None else linger)


async def insert_block_after(room: YRoom, after_block_id: str | None, content: str) -> str:
    """Adds a paragraph block holding `content` after the block with id `after_block_id` (or at the end), as Sidekick. Returns the new block's id."""
    block_id = str(uuid.uuid4())
    created: dict = {}

    def edit(ydoc: pycrdt.Doc) -> None:
        blocks = ydoc.get(BLOCKS_KEY, type=pycrdt.Array)
        index = len(blocks)
        if after_block_id:
            for i in range(len(blocks)):
                if blocks[i]["id"] == after_block_id:
                    index = i + 1
                    break
        with ydoc.transaction():
            blocks.insert(index, pycrdt.Map({"id": block_id, "type": "paragraph", "text": pycrdt.Text(content)}))
        created["text"] = blocks[index]["text"]

    if registry.rooms.get(room.doc_id) is not room:
        raise HTTPException(409, detail={"code": "not_open", "message": "Open the document first."})
    await room.apply_server_edit(edit)

    presence = presence_for(room)
    presence.stay(LINGER_SECONDS)
    if "text" in created:
        presence.point_at_end_of(created["text"])
    return block_id
