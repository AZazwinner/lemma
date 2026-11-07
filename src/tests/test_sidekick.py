import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from modules.sidekick import config, gemini, mock, service
from modules.sidekick.limits import SlidingWindowLimiter, TTLCache
from modules.sidekick.usage import DailyUsage, usage

SECRET = "AIza-test-secret-do-not-leak"


@pytest.fixture(autouse=True)
def clean_sidekick(monkeypatch, tmp_path):
    """Each test starts with no key, no limits set, an empty usage file and no cached answers."""
    for name in (
        "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_VISION_MODEL", "GEMINI_THINKING_LEVEL",
        "SIDEKICK_MOCK", "SIDEKICK_USER_PER_MINUTE", "SIDEKICK_DAILY_BUDGET", "SIDEKICK_CACHE_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SIDEKICK_USAGE_FILE", str(tmp_path / "usage.json"))
    monkeypatch.setattr(mock, "MOCK_DELAY", 0)
    monkeypatch.setattr(gemini, "_client", None)
    service.reset_for_tests()
    yield
    service.reset_for_tests()


def signup(client, name="sid"):
    resp = client.post("/create-user", json={"username": name, "email": f"{name}@example.com", "password": "password123"})
    return resp.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def token(client):
    return signup(client)


def go_live(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    monkeypatch.setenv("GEMINI_MODEL", "some-model")
    monkeypatch.setenv("SIDEKICK_MOCK", "0")


def fake_generate(monkeypatch, answers=None, error=None):
    """Replaces the Gemini call. Returns the list of prompts it was asked."""
    calls = []

    async def generate(system, contents, *, max_output_tokens, vision=False, image=None):
        calls.append(contents)
        if error is not None:
            raise error
        return (answers or ["x^2"])[0]

    monkeypatch.setattr(gemini, "generate", generate)
    return calls


# --- the limiter -------------------------------------------------------------

class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_limiter_allows_up_to_the_limit_then_says_how_long_to_wait():
    clock = Clock()
    limiter = SlidingWindowLimiter(window=60, clock=clock)
    for _ in range(3):
        assert limiter.retry_after("u", 3) == 0
        limiter.hit("u")
    clock.now += 20
    assert limiter.retry_after("u", 3) == pytest.approx(40)


def test_limiter_frees_up_as_the_window_slides():
    clock = Clock()
    limiter = SlidingWindowLimiter(window=60, clock=clock)
    limiter.hit("u")
    clock.now += 30
    limiter.hit("u")
    assert limiter.retry_after("u", 2) == pytest.approx(30)
    clock.now += 31
    assert limiter.retry_after("u", 2) == 0


def test_limiter_counts_each_key_separately():
    limiter = SlidingWindowLimiter(window=60, clock=Clock())
    limiter.hit("a")
    assert limiter.retry_after("a", 1) > 0
    assert limiter.retry_after("b", 1) == 0


# --- the cache ---------------------------------------------------------------

def test_cache_returns_a_value_until_it_expires():
    clock = Clock()
    cache = TTLCache(clock=clock)
    cache.put("k", "v", ttl=300)
    assert cache.get("k") == "v"
    clock.now += 299
    assert cache.get("k") == "v"
    clock.now += 2
    assert cache.get("k") is None


def test_cache_drops_the_oldest_entry_when_full():
    cache = TTLCache(max_entries=2, clock=Clock())
    for key in ("a", "b", "c"):
        cache.put(key, key, ttl=60)
    assert cache.get("a") is None
    assert cache.get("b") == "b" and cache.get("c") == "c"


# --- the daily counter -------------------------------------------------------

def test_daily_usage_stops_at_the_budget():
    counter = DailyUsage()
    assert counter.try_reserve(2) == 1
    assert counter.try_reserve(2) == 2
    assert counter.try_reserve(2) is None
    assert counter.used_today() == 2


def test_daily_usage_survives_a_restart():
    DailyUsage().try_reserve(10)
    DailyUsage().try_reserve(10)
    assert DailyUsage().used_today() == 2


def test_daily_usage_starts_over_on_a_new_day(monkeypatch):
    from modules.sidekick import usage as usage_module

    counter = DailyUsage()
    counter.try_reserve(10)
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
    monkeypatch.setattr(usage_module, "_now", lambda: tomorrow)
    assert counter.used_today() == 0


def test_daily_usage_copes_with_a_corrupt_file(tmp_path, monkeypatch):
    path = tmp_path / "broken.json"
    path.write_text("not json")
    monkeypatch.setenv("SIDEKICK_USAGE_FILE", str(path))
    counter = DailyUsage()
    assert counter.used_today() == 0
    assert counter.try_reserve(5) == 1


# --- settings ----------------------------------------------------------------

def test_no_key_means_mock_mode():
    assert config.mode() == "mock"


def test_mock_can_be_forced_even_with_a_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    monkeypatch.setenv("GEMINI_MODEL", "m")
    monkeypatch.setenv("SIDEKICK_MOCK", "1")
    assert config.mode() == "mock"


def test_a_key_without_a_model_is_disabled_not_guessed(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    assert config.mode() == "disabled"
    assert "GEMINI_MODEL" in config.disabled_reason()


def test_key_and_model_means_live(monkeypatch):
    go_live(monkeypatch)
    assert config.mode() == "live"


def test_vision_model_falls_back_to_the_main_model(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "main")
    assert config.vision_model() == "main"
    monkeypatch.setenv("GEMINI_VISION_MODEL", "eyes")
    assert config.vision_model() == "eyes"


@pytest.mark.parametrize("raw", ["abc", "0", "-3", "2.5"])
def test_bad_limits_fall_back_to_the_defaults(monkeypatch, raw):
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", raw)
    monkeypatch.setenv("SIDEKICK_DAILY_BUDGET", raw)
    assert config.user_per_minute() == 5
    assert config.daily_budget() == 200


# --- mock mode through the API -----------------------------------------------

def test_endpoints_need_a_login(client):
    assert client.post("/sidekick/latex", json={"text": "x"}).status_code in (401, 422)
    assert client.get("/sidekick/status").status_code in (401, 422)


def test_mock_latex_returns_a_canned_answer_without_calling_google(client, token, monkeypatch):
    calls = fake_generate(monkeypatch)
    resp = client.post("/sidekick/latex", json={"text": "integral of x squared from 0 to 1"}, headers=auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["latex"] == r"\int_0^1 x^2 \, dx"
    assert body["mock"] is True and body["cached"] is False
    assert calls == []


def test_mock_explain_returns_a_summary_and_steps(client, token):
    resp = client.post("/sidekick/explain", json={"latex": "x^2"}, headers=auth(token))
    body = resp.json()
    assert resp.status_code == 200
    assert body["summary"] and len(body["steps"]) == 3 and body["mock"] is True


def test_mock_mode_does_not_spend_the_daily_budget(client, token):
    client.post("/sidekick/latex", json={"text": "integral"}, headers=auth(token))
    assert usage.used_today() == 0


def test_mock_busy_trigger_shows_the_busy_response(client, token):
    resp = client.post("/sidekick/latex", json={"text": "please __busy__"}, headers=auth(token))
    assert resp.status_code == 429
    assert resp.json()["detail"]["code"] == "busy"
    assert resp.headers["retry-after"] == str(resp.json()["detail"]["retry_after"])


def test_empty_and_oversized_input_is_rejected(client, token):
    assert client.post("/sidekick/latex", json={"text": ""}, headers=auth(token)).status_code == 422
    assert client.post("/sidekick/latex", json={"text": "x" * 2001}, headers=auth(token)).status_code == 422


def test_disabled_gives_503(client, token, monkeypatch):
    monkeypatch.setenv("SIDEKICK_MOCK", "0")
    resp = client.post("/sidekick/latex", json={"text": "x"}, headers=auth(token))
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "disabled"
    status = client.get("/sidekick/status", headers=auth(token)).json()
    assert status["enabled"] is False and status["features"] == []


# --- caching -----------------------------------------------------------------

def test_the_same_request_is_answered_from_the_cache(client, token, monkeypatch):
    go_live(monkeypatch)
    calls = fake_generate(monkeypatch, ["\\frac{1}{3}"])
    first = client.post("/sidekick/latex", json={"text": "one third"}, headers=auth(token)).json()
    again = client.post("/sidekick/latex", json={"text": "  one   third "}, headers=auth(token)).json()
    assert first["cached"] is False and again["cached"] is True
    assert first["latex"] == again["latex"]
    assert len(calls) == 1
    assert usage.used_today() == 1


def test_a_different_feature_with_the_same_text_is_not_a_cache_hit(client, token, monkeypatch):
    go_live(monkeypatch)
    calls = fake_generate(monkeypatch, ["x^2"])
    client.post("/sidekick/latex", json={"text": "x^2"}, headers=auth(token))
    client.post("/sidekick/explain", json={"latex": "x^2"}, headers=auth(token))
    assert len(calls) == 2


def test_the_cache_expires(client, token, monkeypatch):
    go_live(monkeypatch)
    calls = fake_generate(monkeypatch, ["x^2"])
    monkeypatch.setenv("SIDEKICK_CACHE_SECONDS", "1")
    client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    for entry in list(service.cache._items):
        service.cache._items[entry] = (0.0, service.cache._items[entry][1])
    client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    assert len(calls) == 2


def test_identical_requests_in_flight_share_one_call(monkeypatch):
    go_live(monkeypatch)
    started = 0

    async def slow(system, contents, *, max_output_tokens, vision=False):
        nonlocal started
        started += 1
        await asyncio.sleep(0.05)
        return "x^2"

    monkeypatch.setattr(gemini, "generate", slow)

    async def scenario():
        return await asyncio.gather(*(service.to_latex(user, "square") for user in (1, 2, 3)))

    results = asyncio.run(scenario())
    assert started == 1
    assert {r[0] for r in results} == {"x^2"}
    assert sorted(r[1] for r in results) == [False, True, True]
    assert usage.used_today() == 1


# --- limits through the API --------------------------------------------------

def test_a_user_over_the_per_minute_limit_gets_busy_with_a_retry_hint(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "2")
    calls = fake_generate(monkeypatch)
    for n in range(2):
        assert client.post("/sidekick/latex", json={"text": f"q{n}"}, headers=auth(token)).status_code == 200
    resp = client.post("/sidekick/latex", json={"text": "q2"}, headers=auth(token))
    assert resp.status_code == 429
    assert 1 <= resp.json()["detail"]["retry_after"] <= 60
    assert len(calls) == 2
    assert usage.used_today() == 2


def test_the_limit_is_per_user(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "1")
    fake_generate(monkeypatch)
    other = signup(client, "other")
    assert client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token)).status_code == 200
    assert client.post("/sidekick/latex", json={"text": "b"}, headers=auth(token)).status_code == 429
    assert client.post("/sidekick/latex", json={"text": "c"}, headers=auth(other)).status_code == 200


def test_the_daily_budget_stops_requests_and_never_calls_google(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_DAILY_BUDGET", "2")
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "50")
    calls = fake_generate(monkeypatch)
    codes = [client.post("/sidekick/latex", json={"text": f"q{n}"}, headers=auth(token)).status_code for n in range(4)]
    assert codes == [200, 200, 429, 429]
    assert len(calls) == 2
    status = client.get("/sidekick/status", headers=auth(token)).json()
    assert status["used_today"] == 2 and status["daily_budget"] == 2


# --- Google errors -----------------------------------------------------------

def test_a_google_429_becomes_busy_and_pauses_further_calls(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "50")
    calls = fake_generate(monkeypatch, error=gemini.GeminiBusy(23))
    first = client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    assert first.status_code == 429
    assert first.json()["detail"]["retry_after"] == 23
    assert first.headers["retry-after"] == "23"
    second = client.post("/sidekick/latex", json={"text": "b"}, headers=auth(token))
    assert second.status_code == 429
    assert len(calls) == 1  # the second request never reached Google


def test_other_google_failures_give_a_generic_502(client, token, monkeypatch):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiError("HTTP 500"))
    resp = client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    assert resp.status_code == 502
    assert resp.json()["detail"]["code"] == "upstream_error"
    assert "500" not in resp.text


class FakeModels:
    def __init__(self, outcome):
        self.outcome = outcome
        self.kwargs = None

    async def generate_content(self, **kwargs):
        self.kwargs = kwargs
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeClient:
    def __init__(self, outcome):
        self.aio = type("Aio", (), {})()
        self.aio.models = FakeModels(outcome)


def sdk_error(code, retry=None):
    from google.genai import errors

    body = {"error": {"code": code, "message": "details with the key " + SECRET, "status": "X"}}
    if retry:
        body["error"]["details"] = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry}]
    return (errors.ClientError if code < 500 else errors.ServerError)(code, body)


def test_the_sdk_429_is_translated_with_googles_retry_hint(monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setattr(gemini, "_get_client", lambda: FakeClient(sdk_error(429, "23.4s")))
    with pytest.raises(gemini.GeminiBusy) as caught:
        asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10))
    assert caught.value.retry_after == 24


def test_the_sdk_429_without_a_hint_uses_a_default(monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setattr(gemini, "_get_client", lambda: FakeClient(sdk_error(429)))
    with pytest.raises(gemini.GeminiBusy) as caught:
        asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10))
    assert caught.value.retry_after == gemini.DEFAULT_RETRY_AFTER


@pytest.mark.parametrize("code", [400, 403, 500, 503])
def test_other_sdk_errors_never_pass_googles_message_on(monkeypatch, code):
    go_live(monkeypatch)
    monkeypatch.setattr(gemini, "_get_client", lambda: FakeClient(sdk_error(code)))
    with pytest.raises(gemini.GeminiError) as caught:
        asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10))
    assert SECRET not in str(caught.value) and caught.value.reason == f"HTTP {code}"


def test_an_empty_answer_is_an_error(monkeypatch):
    go_live(monkeypatch)
    empty = type("R", (), {"text": None})()
    monkeypatch.setattr(gemini, "_get_client", lambda: FakeClient(empty))
    with pytest.raises(gemini.GeminiError):
        asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10))


def test_the_call_uses_the_configured_model_one_attempt_and_no_thinking_by_default(monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("GEMINI_MODEL", "configured-model")
    fake = FakeClient(type("R", (), {"text": " x^2 "})())
    monkeypatch.setattr(gemini, "_get_client", lambda: fake)
    assert asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10)) == "x^2"
    kwargs = fake.aio.models.kwargs
    assert kwargs["model"] == "configured-model"
    assert kwargs["config"].http_options.retry_options.attempts == 1
    assert kwargs["config"].thinking_config is None

    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "low")
    asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10))
    assert fake.aio.models.kwargs["config"].thinking_config.thinking_level.value.lower() == "low"


# --- the key stays on the server ---------------------------------------------

def test_the_key_never_appears_in_responses_or_logs(client, token, monkeypatch, capsys):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiError("HTTP 403"))
    bodies = [
        client.get("/sidekick/status", headers=auth(token)).text,
        client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token)).text,
        client.post("/sidekick/explain", json={"latex": "a"}, headers=auth(token)).text,
    ]
    out = capsys.readouterr()
    assert SECRET not in "".join(bodies) and SECRET not in out.out and SECRET not in out.err
    assert "some-model" not in bodies[0]


# --- cleaning what the model says --------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("x^2", "x^2"),
    ("$$x^2$$", "x^2"),
    ("$x^2$", "x^2"),
    (r"\[ x^2 \]", "x^2"),
    ("```latex\n\\frac{1}{2}\n```", r"\frac{1}{2}"),
    ("$a$ and $b$", "$a$ and $b$"),  # two expressions, not one wrapped one: left alone
])
def test_clean_latex(raw, expected):
    assert service.clean_latex(raw) == expected


def test_parse_explanation_reads_the_requested_format():
    summary, steps = service.parse_explanation("SUMMARY: It squares x.\n1. Take x.\n2) Multiply it by itself.\n- Done.")
    assert summary == "It squares x."
    assert steps == ["Take x.", "Multiply it by itself.", "Done."]


def test_parse_explanation_survives_a_model_that_ignores_the_format():
    summary, steps = service.parse_explanation("It squares x.\nThen it stops.")
    assert summary == "It squares x." and steps == ["Then it stops."]


def test_parse_explanation_caps_the_steps():
    raw = "SUMMARY: s\n" + "\n".join(f"{n}. step" for n in range(1, 20))
    assert len(service.parse_explanation(raw)[1]) == 8
