def test_health_is_always_ok(client):
    assert client.get("/health").json() == {"status": "ok"}
