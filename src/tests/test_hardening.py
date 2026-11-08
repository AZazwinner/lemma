import pytest
from starlette.websockets import WebSocketDisconnect

from db.core.auth.utils import token as token_utils
from db.modules.liveshare import routes as liveshare_routes
from db.modules.liveshare.routes import ByteBudget
from tests.test_docs_permissions import auth, create_doc, signup


def create_user(client, username="alice", email="alice@example.com", password="password123"):
    return client.post("/create-user", json={"username": username, "email": email, "password": password}).json()


def connect(client, doc_id, credential):
    return client.websocket_connect(f"/ws/docs/{doc_id}?token={credential}")


def get_ticket(client, token):
    resp = client.post("/ws-ticket", headers=auth(token))
    assert resp.status_code == 200
    return resp.json()["ticket"]


# --- request size limits -----------------------------------------------------

def test_an_oversized_request_body_is_refused(client):
    resp = client.post("/signin", content=b"x" * (1024 * 1024 + 1), headers={"Content-Type": "application/json"})
    assert resp.status_code == 413


def test_an_oversized_chunked_body_is_refused_too(client):
    def chunks():
        for _ in range(3):
            yield b"x" * (512 * 1024)

    resp = client.post("/signin", content=chunks(), headers={"Content-Type": "application/json"})
    assert resp.status_code == 413


def test_a_normal_sized_request_is_unaffected(client):
    resp = client.post("/signin", json={"username": "nobody", "password": "password123"})
    assert resp.status_code == 200


def test_a_password_over_the_maximum_is_rejected(client):
    assert create_user(client, password="a" * 129)["code"] == 30
    assert create_user(client, password="a" * 128)["code"] == 100


def test_a_username_over_the_maximum_or_blank_is_rejected(client):
    assert create_user(client, username="u" * 65)["code"] == 10
    assert create_user(client, username="   ")["code"] == 10
    assert create_user(client, username="")["code"] == 10


def test_a_very_long_document_title_is_rejected(client):
    _, token = signup(client, "owner", "owner@example.com")

    too_long = client.post("/docs/new", json={"title": "t" * 256}, headers=auth(token))
    assert too_long.status_code == 422

    doc_id = create_doc(client, token)
    rename = client.post("/update-doc", json={"doc_id": doc_id, "title": "t" * 256}, headers=auth(token))
    assert rename.status_code == 422


# --- WebSocket size limits ---------------------------------------------------

def test_an_oversized_websocket_message_closes_the_socket(client, monkeypatch):
    monkeypatch.setattr(liveshare_routes, "MAX_MESSAGE_BYTES", 200)
    _, token = signup(client, "owner", "owner@example.com")
    doc_id = create_doc(client, token)

    with connect(client, doc_id, token) as ws:
        ws.receive_bytes()
        ws.send_bytes(b"\x00\x02" + b"x" * 300)
        with pytest.raises(WebSocketDisconnect) as excinfo:
            ws.receive_bytes()

    assert excinfo.value.code == liveshare_routes.CLOSE_MESSAGE_TOO_BIG


def test_a_socket_that_exceeds_its_byte_budget_is_closed(client, monkeypatch):
    monkeypatch.setattr(liveshare_routes, "BUDGET_BYTES_PER_WINDOW", 100)
    _, token = signup(client, "owner", "owner@example.com")
    doc_id = create_doc(client, token)

    with connect(client, doc_id, token) as ws:
        ws.receive_bytes()
        ws.send_bytes(b"\x00\x02" + b"x" * 60)
        ws.send_bytes(b"\x00\x02" + b"x" * 60)
        with pytest.raises(WebSocketDisconnect) as excinfo:
            ws.receive_bytes()

    assert excinfo.value.code == liveshare_routes.CLOSE_OVER_BUDGET


def test_the_byte_budget_resets_each_window(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(liveshare_routes.time, "monotonic", lambda: now[0])
    budget = ByteBudget(limit=100, window=60)

    assert budget.allow(80) is True
    assert budget.allow(30) is False
    now[0] += 61
    assert budget.allow(80) is True


# --- WebSocket tickets and sign-out -------------------------------------------

def test_a_ticket_opens_a_websocket(client):
    _, token = signup(client, "owner", "owner@example.com")
    doc_id = create_doc(client, token)

    with connect(client, doc_id, get_ticket(client, token)) as ws:
        assert ws.receive_bytes()


def test_a_ticket_cannot_be_used_as_a_login_token(client):
    _, token = signup(client, "owner", "owner@example.com")

    resp = client.get("/me", headers=auth(get_ticket(client, token)))

    assert resp.status_code == 401


def test_an_expired_ticket_is_rejected(client, monkeypatch):
    _, token = signup(client, "owner", "owner@example.com")
    doc_id = create_doc(client, token)
    monkeypatch.setattr(token_utils, "WS_TICKET_EXPIRE_SECONDS", -1)
    ticket = get_ticket(client, token)

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with connect(client, doc_id, ticket):
            pass
    assert excinfo.value.code == 4401


def test_the_login_token_still_opens_a_websocket_until_that_is_switched_off(client, monkeypatch):
    _, token = signup(client, "owner", "owner@example.com")
    doc_id = create_doc(client, token)

    with connect(client, doc_id, token) as ws:
        assert ws.receive_bytes()

    monkeypatch.setenv("WS_ACCEPT_LOGIN_TOKEN", "0")
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with connect(client, doc_id, token):
            pass
    assert excinfo.value.code == 4401

    with connect(client, doc_id, get_ticket(client, token)) as ws:
        assert ws.receive_bytes()


def test_a_ticket_needs_a_login(client):
    assert client.post("/ws-ticket").status_code == 422
    assert client.post("/ws-ticket", headers=auth("not-a-real-token")).status_code == 401


def test_logout_revokes_the_login_token_and_its_tickets(client):
    _, token = signup(client, "owner", "owner@example.com")
    doc_id = create_doc(client, token)
    ticket = get_ticket(client, token)

    resp = client.post("/logout", headers=auth(token))
    assert resp.json() == {"success": True}

    assert client.get("/me", headers=auth(token)).status_code == 401
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with connect(client, doc_id, ticket):
            pass
    assert excinfo.value.code == 4401

    signin = client.post("/signin", json={"username": "owner", "password": "password123"}).json()
    assert client.get("/me", headers=auth(signin["token"])).status_code == 200


def test_login_tokens_last_a_week_not_twelve_days():
    assert token_utils.ACCESS_TOKEN_EXPIRE_MINUTES == 60 * 24 * 7
