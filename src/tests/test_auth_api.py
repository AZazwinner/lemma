import pytest


def signup(client, username="alice", email="alice@example.com", password="password123"):
    return client.post(
        "/create-user",
        json={"username": username, "email": email, "password": password},
    )


def test_signup_rejects_a_weak_password(client):
    resp = signup(client, password="short")
    assert resp.status_code == 200
    assert resp.json()["code"] == 30
    assert resp.json().get("user") is None


def test_signup_succeeds_and_returns_a_token(client):
    resp = signup(client)
    body = resp.json()
    assert body["code"] == 100
    assert body["user"]["username"] == "alice"
    assert body["token"]


def test_signup_rejects_a_duplicate_username(client):
    signup(client, username="alice", email="a1@example.com")
    resp = signup(client, username="alice", email="a2@example.com")
    assert resp.json()["code"] == 10


def test_signup_rejects_a_duplicate_email(client):
    signup(client, username="alice", email="shared@example.com")
    resp = signup(client, username="bob", email="shared@example.com")
    assert resp.json()["code"] == 20


def test_signup_is_rate_limited_per_ip(client):
    for i in range(5):
        resp = signup(client, username=f"user{i}", email=f"user{i}@example.com")
        assert resp.status_code == 200
    resp = signup(client, username="user5", email="user5@example.com")
    assert resp.status_code == 429


def _signups_until_throttled(client, ceiling=60):
    """How many sign-ups from one IP succeed before the backend answers 429."""
    for i in range(ceiling):
        if signup(client, username=f"user{i}", email=f"user{i}@example.com").status_code == 429:
            return i
    return ceiling


def test_signup_limit_can_be_raised_with_an_env_var(client, monkeypatch):
    monkeypatch.setenv("SIGNUP_MAX_ATTEMPTS", "8")
    assert _signups_until_throttled(client) == 8


def test_signup_limit_can_be_lowered_with_an_env_var(client, monkeypatch):
    monkeypatch.setenv("SIGNUP_MAX_ATTEMPTS", "2")
    assert _signups_until_throttled(client) == 2


@pytest.mark.parametrize("bad_value", ["abc", "0", "-3", "2.5", "  "])
def test_a_bad_signup_limit_falls_back_to_the_default(client, monkeypatch, bad_value):
    monkeypatch.setenv("SIGNUP_MAX_ATTEMPTS", bad_value)
    assert _signups_until_throttled(client) == 5


def test_raising_the_signup_limit_does_not_loosen_the_signin_lockout(client, monkeypatch):
    monkeypatch.setenv("SIGNUP_MAX_ATTEMPTS", "50")
    signup(client)
    for _ in range(5):
        client.post("/signin", json={"username": "alice", "password": "wrong-password"})
    resp = client.post("/signin", json={"username": "alice", "password": "password123"})
    assert resp.status_code == 429


def test_signin_with_correct_credentials_returns_a_token(client):
    signup(client)
    resp = client.post("/signin", json={"username": "alice", "password": "password123"})
    body = resp.json()
    assert body["user"] is not None
    assert body["token"]


def test_signin_with_wrong_password_returns_no_token(client):
    signup(client)
    resp = client.post("/signin", json={"username": "alice", "password": "wrong-password"})
    body = resp.json()
    assert body["user"] is None
    assert body.get("token") is None


def test_signin_locks_out_after_repeated_failures(client):
    signup(client)
    for _ in range(5):
        client.post("/signin", json={"username": "alice", "password": "wrong-password"})
    resp = client.post("/signin", json={"username": "alice", "password": "password123"})
    assert resp.status_code == 429


def test_me_requires_a_valid_token(client):
    signup(client)
    resp = client.get("/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_me_returns_the_authenticated_user(client):
    token = signup(client).json()["token"]
    resp = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice"


def test_changing_password_invalidates_the_old_token(client):
    old_token = signup(client).json()["token"]

    resp = client.post(
        "/user-update-password",
        json={"password": "brand-new-password"},
        headers={"Authorization": f"Bearer {old_token}"},
    )
    assert resp.json()["success"] is True


    stale = client.get("/me", headers={"Authorization": f"Bearer {old_token}"})
    assert stale.status_code == 401


    signin_resp = client.post("/signin", json={"username": "alice", "password": "brand-new-password"})
    new_token = signin_resp.json()["token"]
    fresh = client.get("/me", headers={"Authorization": f"Bearer {new_token}"})
    assert fresh.status_code == 200


def test_forgot_password_does_not_leak_the_reset_link_by_default(client):
    signup(client)

    known = client.post("/forgot-password", json={"email": "alice@example.com"}).json()
    unknown = client.post("/forgot-password", json={"email": "nobody@example.com"}).json()

    assert known == unknown == {"success": True, "dev_reset_link": None}


def test_password_reset_also_invalidates_old_tokens(client, monkeypatch):
    monkeypatch.setenv("ALLOW_DEV_RESET_LINK", "1")
    old_token = signup(client).json()["token"]

    forgot_resp = client.post("/forgot-password", json={"email": "alice@example.com"})
    reset_link_token = forgot_resp.json()["dev_reset_link"].split("token=")[1]

    reset_resp = client.post(
        "/reset-password",
        json={"token": reset_link_token, "password": "another-new-password"},
    )
    assert reset_resp.json()["success"] is True

    stale = client.get("/me", headers={"Authorization": f"Bearer {old_token}"})
    assert stale.status_code == 401


def _configure_smtp(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_USER", "mathboard@example.test")
    monkeypatch.setenv("SMTP_PASSWORD", "app-password")


def test_forgot_password_response_is_the_same_when_email_delivery_fails(client, monkeypatch):
    import smtplib

    def refuse(*_args, **_kwargs):
        raise smtplib.SMTPConnectError(421, "mail server unreachable")

    _configure_smtp(monkeypatch)
    monkeypatch.setattr(smtplib, "SMTP", refuse)
    signup(client)

    known = client.post("/forgot-password", json={"email": "alice@example.com"})
    unknown = client.post("/forgot-password", json={"email": "nobody@example.com"})

    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json() == {"success": True, "dev_reset_link": None}


def test_forgot_password_sends_the_link_over_starttls_smtp(client, monkeypatch):
    import smtplib

    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            sent.append(("connect", host, port))

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def starttls(self):
            sent.append(("starttls",))

        def login(self, user, password):
            sent.append(("login", user))

        def send_message(self, message, from_addr=None):
            sent.append(("message", message["To"], message["From"], message.get_body(("plain",)).get_content(), from_addr))

    _configure_smtp(monkeypatch)
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    signup(client)

    resp = client.post("/forgot-password", json={"email": "alice@example.com"})

    assert resp.json() == {"success": True, "dev_reset_link": None}
    steps = [s[0] for s in sent]
    assert steps == ["connect", "starttls", "login", "message"], "the password must only be sent after STARTTLS"
    _, to, sender, body, envelope_sender = sent[-1]
    assert to == "alice@example.com"
    assert "mathboard@example.test" in sender
    assert envelope_sender == "mathboard@example.test"
    assert "/reset-password?token=" in body


def test_a_malformed_smtp_from_falls_back_to_the_login_address(client, monkeypatch):
    import smtplib

    sent = []

    class FakeSMTP:
        def __init__(self, *_args, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def starttls(self):
            pass

        def login(self, *_args):
            pass

        def send_message(self, message, from_addr=None):
            sent.append((str(message["From"]), from_addr))

    _configure_smtp(monkeypatch)
    monkeypatch.setenv("SMTP_FROM", "Mathboard mathboard@example.test")
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    signup(client)

    client.post("/forgot-password", json={"email": "alice@example.com"})

    assert sent == [("Mathboard <mathboard@example.test>", "mathboard@example.test")]
