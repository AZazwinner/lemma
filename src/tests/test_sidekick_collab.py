import json
import time

import pycrdt
import pytest

from db.modules.docs.models import DocumentBlock
from db.modules.liveshare.backfill import BLOCKS_KEY
from modules.sidekick import collab, config, gemini, mock, service
from tests.test_docs_permissions import auth, create_doc, signup
from tests.test_liveshare_ws import connect, share


@pytest.fixture(autouse=True)
def clean_sidekick(monkeypatch, tmp_path):
    """Mock mode (no key), an empty usage file, and no leftover presence from another test."""
    for name in (
        "GEMINI_API_KEY", "GEMINI_MODEL", "SIDEKICK_MOCK", "SIDEKICK_USER_PER_MINUTE", "SIDEKICK_DAILY_BUDGET",
        "SIDEKICK_PROVIDER", "SIDEKICK_VISION_PROVIDER", "OPENROUTER_API_KEY", "OPENROUTER_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SIDEKICK_USAGE_FILE", str(tmp_path / "usage.json"))
    monkeypatch.setattr(mock, "MOCK_DELAY", 0)
    service.reset_for_tests()
    collab._presences.clear()
    yield
    collab._presences.clear()
    service.reset_for_tests()


class Watcher:
    """A browser stand-in: a websocket plus the Y.Doc and Awareness it builds from what the server sends."""

    def __init__(self, ws):
        self.ws = ws
        self.doc = pycrdt.Doc()
        self.awareness = pycrdt.Awareness(self.doc)
        self.awareness_log: list[bytes] = []
        self.blocks = self.doc.get(BLOCKS_KEY, type=pycrdt.Array)

    def settle(self):
        """Reads everything the server has queued so far. Asks for the document and stops at the answer, which can only
        come after anything sent earlier, so it never waits on a message that isn't coming."""
        self.ws.send_bytes(pycrdt.create_sync_message(self.doc))
        while True:
            message = self.ws.receive_bytes()
            if message[0] == pycrdt.YMessageType.AWARENESS:
                update = pycrdt.read_message(message[1:])
                self.awareness_log.append(update)
                self.awareness.apply_awareness_update(update, origin="server")
            elif message[1] == pycrdt.YSyncMessageType.SYNC_STEP1:
                # The server's own greeting. Not answering it keeps this stand-in from sending anything another
                # watcher would see, so the only step 2 that ever arrives is the answer to our own request below.
                continue
            else:
                pycrdt.handle_sync_message(message[1:], self.doc)
                if message[1] == pycrdt.YSyncMessageType.SYNC_STEP2:
                    return

    def sidekick_state(self):
        for state in self.awareness.states.values():
            if state.get("user", {}).get("name") == collab.NAME:
                return state
        return None

    def texts(self):
        return [str(block["text"]) for block in self.blocks]

    def ids(self):
        return [block["id"] for block in self.blocks]


@pytest.fixture()
def owner(client):
    return signup(client, "owner", "owner@example.com")


@pytest.fixture()
def other(client):
    return signup(client, "other", "other@example.com")


def ask_latex(client, token, doc_id, text="integral of x squared", after=None):
    body = {"text": text}
    if after:
        body["after_block_id"] = after
    return client.post(f"/sidekick/docs/{doc_id}/latex", json=body, headers=auth(token))


def test_sidekick_shows_in_presence_and_writes_a_block_everyone_receives(client, owner, other):
    _, owner_token = owner
    other_id, other_token = other
    doc_id = create_doc(client, owner_token)
    share(client, owner_token, doc_id, other_id, "write")

    with connect(client, doc_id, owner_token) as ws_a, connect(client, doc_id, other_token) as ws_b:
        a, b = Watcher(ws_a), Watcher(ws_b)
        a.settle()
        b.settle()
        first_block = a.ids()[0]
        assert a.sidekick_state() is None

        resp = ask_latex(client, owner_token, doc_id, after=first_block)
        assert resp.status_code == 200
        new_id = resp.json()["block_id"]
        assert resp.json()["mock"] is True

        for watcher in (a, b):
            watcher.settle()
            # it is in the presence list, as itself, with its own colour
            state = watcher.sidekick_state()
            assert state is not None
            assert state["user"]["color"] == collab.COLOR and state["user"]["kind"] == "ai"
            # and its block arrived through the normal document path, right after the writer's block
            assert watcher.ids() == [first_block, new_id]
            assert watcher.texts()[1] == "$$\n\\int_0^1 x^2 \\, dx\n$$"
            # with a caret at the end of what it wrote
            assert state["cursor"]["head"] is not None


def test_a_late_joiner_sees_the_sidekick_who_is_still_here(client, owner, other):
    _, owner_token = owner
    other_id, other_token = other
    doc_id = create_doc(client, owner_token)
    share(client, owner_token, doc_id, other_id, "write")

    with connect(client, doc_id, owner_token) as ws_a:
        a = Watcher(ws_a)
        a.settle()
        ask_latex(client, owner_token, doc_id)

        with connect(client, doc_id, other_token) as ws_b:
            late = Watcher(ws_b)
            late.settle()
            assert late.sidekick_state() is not None
            assert len(late.texts()) == 2


def test_the_sidekick_leaves_after_its_linger_and_does_not_stay_forever(client, owner, monkeypatch):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)
    monkeypatch.setattr(collab, "LINGER_SECONDS", 0.3)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()
        ask_latex(client, owner_token, doc_id)
        watcher.settle()
        assert watcher.sidekick_state() is not None

        time.sleep(0.8)
        watcher.settle()
        assert watcher.sidekick_state() is None
        assert collab._presences == {}


def test_presence_is_kept_fresh_while_it_stays(client, owner, monkeypatch):
    """Browsers drop a collaborator that stays silent for 30s, so a long stay must keep announcing itself."""
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)
    monkeypatch.setattr(collab, "LINGER_SECONDS", 1.0)
    monkeypatch.setattr(collab, "HEARTBEAT_SECONDS", 0.2)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()
        ask_latex(client, owner_token, doc_id)
        watcher.settle()
        seen_before = len(watcher.awareness_log)
        time.sleep(0.7)
        watcher.settle()
        assert len(watcher.awareness_log) > seen_before
        assert watcher.sidekick_state() is not None


def test_a_busy_answer_writes_nothing_and_the_sidekick_does_not_linger(client, owner):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()
        resp = ask_latex(client, owner_token, doc_id, text="__busy__")
        assert resp.status_code == 429 and resp.json()["detail"]["code"] == "busy"
        watcher.settle()
        assert watcher.sidekick_state() is None
        assert len(watcher.texts()) == 1


def test_a_failure_after_the_sidekick_started_removes_it_again(client, owner, monkeypatch):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL", "m")
    monkeypatch.setenv("SIDEKICK_MOCK", "0")
    monkeypatch.setenv("SIDEKICK_PROVIDER", "gemini")

    async def failing(system, contents, *, max_output_tokens, vision=False):
        raise gemini.GeminiError("HTTP 500")

    monkeypatch.setattr(gemini, "generate", failing)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()
        assert ask_latex(client, owner_token, doc_id).status_code == 502
        watcher.settle()
        assert watcher.sidekick_state() is None
        assert len(watcher.texts()) == 1


def test_explain_writes_the_explanation_as_a_block(client, owner):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()
        resp = client.post(
            f"/sidekick/docs/{doc_id}/explain", json={"latex": "x^2", "after_block_id": watcher.ids()[0]}, headers=auth(owner_token)
        )
        assert resp.status_code == 200
        watcher.settle()
        text = watcher.texts()[1]
        assert text.startswith("This is a sample explanation") and "\n1. " in text and "\n3. " in text


def test_a_block_id_that_is_not_there_goes_at_the_end(client, owner):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()
        ask_latex(client, owner_token, doc_id, after="no-such-block")
        watcher.settle()
        assert len(watcher.texts()) == 2 and watcher.texts()[1].startswith("$$")


def test_what_the_sidekick_wrote_is_saved(client, owner, db_session):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()
        new_id = ask_latex(client, owner_token, doc_id).json()["block_id"]
        watcher.settle()

    db_session.expire_all()
    row = db_session.query(DocumentBlock).filter(DocumentBlock.id == new_id).first()
    assert row is not None and row.content == "$$\n\\int_0^1 x^2 \\, dx\n$$"


def test_it_will_not_write_for_someone_who_cannot_edit(client, owner, other):
    _, owner_token = owner
    other_id, other_token = other
    doc_id = create_doc(client, owner_token)

    with connect(client, doc_id, owner_token) as ws:
        watcher = Watcher(ws)
        watcher.settle()

        assert ask_latex(client, other_token, doc_id).status_code == 403  # no access at all

        share(client, owner_token, doc_id, other_id, "read")
        assert ask_latex(client, other_token, doc_id).status_code == 403  # view-only

        watcher.settle()
        assert watcher.sidekick_state() is None and len(watcher.texts()) == 1


def test_it_needs_the_document_to_be_open(client, owner):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)
    resp = ask_latex(client, owner_token, doc_id)
    assert resp.status_code == 409 and resp.json()["detail"]["code"] == "not_open"


def test_it_needs_a_login(client, owner):
    _, owner_token = owner
    doc_id = create_doc(client, owner_token)
    assert client.post(f"/sidekick/docs/{doc_id}/latex", json={"text": "x"}).status_code in (401, 422)


def test_the_normal_sync_path_still_works_beside_it(client, owner, other):
    """A person's own edit and the Sidekick's reach each other, and the person's presence is unaffected."""
    _, owner_token = owner
    other_id, other_token = other
    doc_id = create_doc(client, owner_token)
    share(client, owner_token, doc_id, other_id, "write")

    with connect(client, doc_id, owner_token) as ws_a, connect(client, doc_id, other_token) as ws_b:
        a, b = Watcher(ws_a), Watcher(ws_b)
        a.settle()
        b.settle()
        a.awareness.set_local_state({"user": {"name": "owner", "color": "red"}})
        ws_a.send_bytes(pycrdt.create_awareness_message(a.awareness.encode_awareness_update([a.awareness.client_id])))

        ask_latex(client, owner_token, doc_id)
        a.settle()
        b.settle()

        names = {state.get("user", {}).get("name") for state in b.awareness.states.values()}
        assert {"owner", collab.NAME} <= names
        assert b.texts() == a.texts() and len(b.texts()) == 2
