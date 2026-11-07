import asyncio
import json

import httpx
import pytest

from modules.sidekick import config, gemini, llm, openrouter
from modules.sidekick.usage import usage
from tests.test_sidekick import auth, clean_sidekick, signup  # noqa: F401

KEY = "sk-or-test-secret-do-not-leak"


@pytest.fixture()
def token(client):
    return signup(client)


def live_openrouter(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    monkeypatch.setenv("SIDEKICK_MOCK", "0")


def fake_openrouter(monkeypatch, respond):
    """Routes openrouter.py's HTTP calls to `respond(request) -> httpx.Response`. Returns the list of requests seen."""
    seen = []

    def handler(request):
        seen.append(request)
        return respond(request)

    real_client = httpx.AsyncClient

    def client_with_fake_transport(*args, **kwargs):
        return real_client(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(openrouter.httpx, "AsyncClient", client_with_fake_transport)
    return seen


def answer(text, finish="stop"):
    return lambda request: httpx.Response(200, json={"choices": [{"message": {"content": text}, "finish_reason": finish}]})


def body_of(request):
    return json.loads(request.content)


# --- which provider -----------------------------------------------------------

def test_openrouter_and_deepseek_are_the_defaults():
    assert config.provider() == "openrouter"
    assert config.openrouter_model() == config.DEFAULT_OPENROUTER_MODEL
    assert config.DEFAULT_OPENROUTER_MODEL.startswith("deepseek/")


def test_without_an_openrouter_key_it_is_mock_and_with_one_it_is_live(monkeypatch):
    assert config.mode() == "mock"
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    assert config.mode() == "live"


def test_gemini_can_still_be_chosen(monkeypatch):
    monkeypatch.setenv("SIDEKICK_PROVIDER", "gemini")
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    assert config.mode() == "mock"  # no Gemini key, so Gemini isn't live just because OpenRouter has one
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("GEMINI_MODEL", "some-gemini")
    assert config.mode() == "live" and config.provider() == "gemini"


def test_an_unknown_provider_name_falls_back_to_the_default(monkeypatch):
    monkeypatch.setenv("SIDEKICK_PROVIDER", "carrier-pigeon")
    assert config.provider() == "openrouter"


def test_the_model_can_be_changed(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "someone/other-model")
    assert config.openrouter_model() == "someone/other-model"
    assert config.openrouter_vision_model() == "someone/other-model"
    monkeypatch.setenv("OPENROUTER_VISION_MODEL", "someone/eyes")
    assert config.openrouter_vision_model() == "someone/eyes"


def test_photos_go_to_gemini_when_it_is_set_up_and_to_openrouter_otherwise(monkeypatch):
    assert config.vision_provider() == "openrouter"
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("GEMINI_VISION_MODEL", "gemini-eyes")
    assert config.vision_provider() == "gemini"
    monkeypatch.setenv("SIDEKICK_VISION_PROVIDER", "openrouter")
    assert config.vision_provider() == "openrouter"


def test_the_dispatcher_sends_text_and_photos_to_the_right_provider(monkeypatch):
    calls = []

    async def from_gemini(system, contents, *, max_output_tokens, image=None, vision=False):
        calls.append(("gemini", image is not None))
        return "g"

    async def from_openrouter(system, contents, *, max_output_tokens, image=None, vision=False):
        calls.append(("openrouter", image is not None))
        return "o"

    monkeypatch.setattr(gemini, "generate", from_gemini)
    monkeypatch.setattr(openrouter, "generate", from_openrouter)
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    monkeypatch.setenv("GEMINI_VISION_MODEL", "gemini-eyes")

    asyncio.run(llm.generate("s", "text", max_output_tokens=5))
    asyncio.run(llm.generate("s", "look", max_output_tokens=5, image=(b"x", "image/png")))
    assert calls == [("openrouter", False), ("gemini", True)]


# --- the request ----------------------------------------------------------------

def test_the_request_is_a_chat_completion_with_the_key_only_in_the_header(monkeypatch):
    live_openrouter(monkeypatch)
    seen = fake_openrouter(monkeypatch, answer("x^2"))
    assert asyncio.run(openrouter.generate("system words", "user words", max_output_tokens=123)) == "x^2"

    request = seen[0]
    assert str(request.url) == openrouter.URL
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = body_of(request)
    assert KEY not in request.content.decode()
    assert body["model"] == config.DEFAULT_OPENROUTER_MODEL
    assert body["messages"] == [{"role": "system", "content": "system words"}, {"role": "user", "content": "user words"}]
    assert body["max_tokens"] == 123
    assert body["reasoning"] == {"enabled": False}  # off by default: fastest, and reasoning is billed


def test_reasoning_can_be_turned_up(monkeypatch):
    live_openrouter(monkeypatch)
    monkeypatch.setenv("SIDEKICK_REASONING", "low")
    seen = fake_openrouter(monkeypatch, answer("ok"))
    asyncio.run(openrouter.generate("s", "u", max_output_tokens=10))
    assert body_of(seen[0])["reasoning"] == {"effort": "low", "exclude": True}


def test_a_picture_is_sent_as_a_data_url(monkeypatch):
    live_openrouter(monkeypatch)
    monkeypatch.setenv("OPENROUTER_VISION_MODEL", "someone/eyes")
    seen = fake_openrouter(monkeypatch, answer("x"))
    asyncio.run(openrouter.generate("s", "read this", max_output_tokens=10, image=(b"\x89PNG", "image/png")))
    body = body_of(seen[0])
    assert body["model"] == "someone/eyes"
    text_part, image_part = body["messages"][1]["content"]
    assert text_part == {"type": "text", "text": "read this"}
    assert image_part["image_url"]["url"] == "data:image/png;base64,iVBORw=="


# --- answers and failures --------------------------------------------------------

def test_end_to_end_through_the_api(client, token, monkeypatch):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, answer("```latex\n$$\\int_0^1 x^2 \\, dx$$\n```"))
    resp = client.post("/sidekick/latex", json={"text": "integral of x squared"}, headers=auth(token))
    assert resp.status_code == 200
    assert resp.json() == {"latex": "\\int_0^1 x^2 \\, dx", "cached": False, "mock": False}
    assert usage.used_today() == 1


def test_a_429_is_busy_with_the_retry_hint(client, token, monkeypatch):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, lambda r: httpx.Response(429, headers={"Retry-After": "17"}, json={"error": {"code": 429}}))
    resp = client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    assert resp.status_code == 429 and resp.json()["detail"]["retry_after"] == 17


def test_out_of_credit_is_a_402_reason_and_is_not_charged_to_the_budget(client, token, monkeypatch):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, lambda r: httpx.Response(402, json={"error": {"code": 402, "message": "Insufficient credits"}}))
    resp = client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    assert resp.status_code == 502
    assert resp.json()["detail"]["reason"] == "HTTP 402"
    assert "Insufficient" not in resp.text
    assert usage.used_today() == 0


def test_an_error_reported_inside_a_200_is_still_an_error(monkeypatch):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, lambda r: httpx.Response(200, json={"error": {"code": 503, "message": "upstream down"}}))
    with pytest.raises(openrouter.ModelError) as caught:
        asyncio.run(openrouter.generate("s", "u", max_output_tokens=10))
    assert caught.value.reason == "HTTP 503"


def test_running_out_of_tokens_is_named(monkeypatch):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, answer("", finish="length"))
    with pytest.raises(openrouter.ModelError) as caught:
        asyncio.run(openrouter.generate("s", "u", max_output_tokens=10))
    assert caught.value.reason == "output limit"


def test_an_empty_answer_is_an_error(monkeypatch):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, answer(""))
    with pytest.raises(openrouter.ModelError) as caught:
        asyncio.run(openrouter.generate("s", "u", max_output_tokens=10))
    assert caught.value.reason == "empty answer"


def test_a_timeout_is_a_504_and_stays_counted(client, token, monkeypatch):
    live_openrouter(monkeypatch)

    def slow(request):
        raise httpx.ReadTimeout("too slow", request=request)

    fake_openrouter(monkeypatch, slow)
    resp = client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    assert resp.status_code == 502 and resp.json()["detail"]["reason"] == "HTTP 504"
    assert usage.used_today() == 1


def test_garbage_is_an_error_not_a_crash(monkeypatch):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, lambda r: httpx.Response(200, content=b"<html>oops</html>"))
    with pytest.raises(openrouter.ModelError) as caught:
        asyncio.run(openrouter.generate("s", "u", max_output_tokens=10))
    assert caught.value.reason == "unreadable answer"


def test_the_key_never_appears_in_responses_or_logs(client, token, monkeypatch, capsys):
    live_openrouter(monkeypatch)
    fake_openrouter(monkeypatch, lambda r: httpx.Response(401, json={"error": {"code": 401, "message": f"bad key {KEY}"}}))
    texts = [
        client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token)).text,
        client.get("/sidekick/status", headers=auth(token)).text,
    ]
    out = capsys.readouterr()
    assert KEY not in "".join(texts) and KEY not in out.out and KEY not in out.err
