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
        "SIDEKICK_PROVIDER", "SIDEKICK_VISION_PROVIDER", "SIDEKICK_REASONING", "SIDEKICK_TIMEOUT_SECONDS",
        "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_VISION_MODEL",
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
    """Live mode on Gemini, so these tests can replace gemini.generate. OpenRouter has its own tests."""
    monkeypatch.setenv("SIDEKICK_PROVIDER", "gemini")
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


def test_daily_usage_refund_never_goes_below_zero():
    counter = DailyUsage()
    counter.refund()
    assert counter.used_today() == 0
    counter.try_reserve(5)
    counter.refund()
    counter.refund()
    assert counter.used_today() == 0


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
    monkeypatch.setenv("SIDEKICK_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    monkeypatch.setenv("GEMINI_MODEL", "m")
    monkeypatch.setenv("SIDEKICK_MOCK", "1")
    assert config.mode() == "mock"


def test_a_key_without_a_model_is_disabled_not_guessed(monkeypatch):
    monkeypatch.setenv("SIDEKICK_PROVIDER", "gemini")
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


def explain(client, token, latex):
    resp = client.post("/sidekick/explain", json={"latex": latex}, headers=auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["mock"] is True
    return body["text"]


def test_mock_explain_is_three_to_five_sentences_about_the_actual_equation(client, token):
    text = explain(client, token, "$$x^2 + y^2 = z^2$$")
    assert 3 <= len(text.splitlines()) <= 5
    # it names the symbols that are in the block, not generic advice
    assert "Pythagorean" in text and "$x$" in text and "$y$" in text and "$z$" in text
    assert "left-hand side as the quantity" not in text


def test_mock_explain_differs_between_equations(client, token):
    quadratic = explain(client, token, r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}")
    integral = explain(client, token, r"\int_0^1 x^2 \, dx")
    assert "discriminant" in quadratic and "$b^2 - 4ac$" in quadratic
    assert "power rule" in integral and r"\frac{1}{3}" in integral
    assert quadratic != integral


def test_mock_explain_names_the_symbols_of_an_equation_it_does_not_know(client, token):
    text = explain(client, token, r"E = \frac{1}{2} m v^2")
    assert 3 <= len(text.splitlines()) <= 5
    assert all(symbol in text for symbol in ("$E$", "$m$", "$v$"))
    assert "fraction" in text and "power" in text


def test_mock_explain_writes_all_maths_between_single_dollars(client, token):
    for latex in ("2x + 3 = 7", r"\sum_{k=1}^{n} k = \frac{n(n+1)}{2}", r"\frac{d}{dx} x^3 = 3x^2"):
        text = explain(client, token, latex)
        assert "$$" not in text and "\\(" not in text and "\\[" not in text


def test_mock_write_proof_has_dollar_delimited_maths_and_no_bracket_delimiters(client, token):
    resp = client.post(
        "/sidekick/write", json={"text": "a proof that there are infinitely many primes"}, headers=auth(token)
    )
    body = resp.json()
    assert resp.status_code == 200 and body["mock"] is True and body["cached"] is False
    assert "$p_1, p_2, \\ldots, p_n$" in body["text"]
    assert "\\[" not in body["text"] and "\\(" not in body["text"]
    # one block per paragraph or displayed equation, and each displayed equation has its $$ on lines of their own
    blocks = service.split_blocks(body["text"])
    assert len(blocks) >= 5
    equations = [block for block in blocks if block.startswith("$$")]
    assert len(equations) == 2 and all(block.startswith("$$\n") and block.endswith("\n$$") for block in equations)


def test_mock_write_one_expression_is_one_displayed_equation(client, token):
    body = client.post("/sidekick/write", json={"text": "integral of x squared"}, headers=auth(token)).json()
    assert body["text"] == "$$\n\\int_0^1 x^2 \\, dx\n$$"
    assert service.split_blocks(body["text"]) == [body["text"]]


def test_the_write_prompt_asks_for_no_boxes_labels_or_numbering(monkeypatch):
    """A model that boxed its theorem statement and conclusion (and had them numbered) was the reason for this."""
    from modules.sidekick import prompts

    text = prompts.WRITE_SYSTEM
    assert "\\boxed" in text and "\\label" in text and "\\tag" in text
    assert "in a sentence" in text


def test_the_mock_proof_has_no_boxes_or_labels():
    proof = mock._mock_write("a proof that there are infinitely many primes")
    assert "\\boxed" not in proof and "\\label" not in proof and "\\tag" not in proof


def test_write_is_listed_as_a_feature_and_needs_a_login(client, token):
    assert "write" in client.get("/sidekick/status", headers=auth(token)).json()["features"]
    assert client.post("/sidekick/write", json={"text": "x"}).status_code in (401, 422)
    assert client.post("/sidekick/write", json={"text": ""}, headers=auth(token)).status_code == 422
    assert client.post("/sidekick/write", json={"text": "x" * 2001}, headers=auth(token)).status_code == 422


def test_write_and_explain_are_rate_limited_like_everything_else(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "2")
    fake_generate(monkeypatch)
    assert client.post("/sidekick/write", json={"text": "a"}, headers=auth(token)).status_code == 200
    assert client.post("/sidekick/explain", json={"latex": "a"}, headers=auth(token)).status_code == 200
    resp = client.post("/sidekick/write", json={"text": "b"}, headers=auth(token))
    assert resp.status_code == 429 and resp.headers["retry-after"]


def test_write_cleans_delimiters_a_model_used_despite_the_instructions(client, token, monkeypatch):
    go_live(monkeypatch)
    fake_generate(monkeypatch, ["```markdown\nLet \\(p\\) be prime. Then\n\\[\np \\mid N\n\\]\nholds.\n```"])
    body = client.post("/sidekick/write", json={"text": "a note"}, headers=auth(token)).json()
    assert body["text"] == "Let $p$ be prime. Then\n\n$$\np \\mid N\n$$\n\nholds."


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


def test_other_google_failures_give_a_502_with_a_short_safe_reason(client, token, monkeypatch):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiError("HTTP 500"))
    resp = client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token))
    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert detail["code"] == "upstream_error" and detail["reason"] == "HTTP 500"
    assert SECRET not in resp.text


def test_a_request_google_rejected_is_handed_back_to_the_budget(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "50")
    fake_generate(monkeypatch, error=gemini.GeminiError("HTTP 503"))
    for _ in range(3):
        assert client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token)).status_code == 502
    assert usage.used_today() == 0


def test_a_timeout_stays_counted_because_google_may_have_finished_it(client, token, monkeypatch):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiError("HTTP 504"))
    assert client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token)).status_code == 502
    assert usage.used_today() == 1


def test_a_google_429_stays_counted(client, token, monkeypatch):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiBusy(10))
    assert client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token)).status_code == 429
    assert usage.used_today() == 1


def test_the_google_timeout_is_generous_and_capped(monkeypatch):
    assert config.timeout_seconds() == 100
    monkeypatch.setenv("SIDEKICK_TIMEOUT_SECONDS", "30")
    assert config.timeout_seconds() == 30
    monkeypatch.setenv("SIDEKICK_TIMEOUT_SECONDS", "9999")
    assert config.timeout_seconds() == config.MAX_TIMEOUT_SECONDS


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
    with pytest.raises(gemini.GeminiError) as caught:
        asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10))
    assert caught.value.reason == "empty answer"


def test_a_model_that_spent_its_whole_allowance_thinking_is_named_as_such(monkeypatch):
    """Seen with a real reasoning model: 2,045 of 2,048 output tokens went on thoughts, so no text was written."""
    go_live(monkeypatch)
    candidate = type("C", (), {"finish_reason": "FinishReason.MAX_TOKENS"})()
    ran_out = type("R", (), {"text": None, "candidates": [candidate]})()
    monkeypatch.setattr(gemini, "_get_client", lambda: FakeClient(ran_out))
    with pytest.raises(gemini.GeminiError) as caught:
        asyncio.run(gemini.generate("sys", "hi", max_output_tokens=10))
    assert caught.value.reason == "output limit"


def test_every_feature_leaves_room_for_a_model_to_think():
    from modules.sidekick import prompts

    for feature, (_, allowance) in prompts.SYSTEM.items():
        assert allowance >= 4096, feature


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


def test_parse_explanation_reads_one_sentence_per_line():
    raw = "It squares $x$.\nThe result, $x^2$, is never negative.\nSo $x^2 \\ge 0$."
    assert service.parse_explanation(raw) == ["It squares $x$.", "The result, $x^2$, is never negative.", "So $x^2 \\ge 0$."]


def test_parse_explanation_tolerates_numbering_bullets_and_the_old_summary_format():
    sentences = service.parse_explanation("SUMMARY: It squares x.\n1. Take x.\n2) Multiply it by itself.\n- Done.")
    assert sentences == ["It squares x.", "Take x.", "Multiply it by itself.", "Done."]


def test_parse_explanation_turns_every_kind_of_math_delimiter_into_single_dollars():
    raw = "Here \\(x\\) and \\[y\\] and $$z$$ appear."
    assert service.parse_explanation(raw) == ["Here $x$ and $y$ and $z$ appear."]


def test_parse_explanation_caps_the_length():
    raw = "\n".join(f"Sentence number {n}." for n in range(1, 20))
    assert len(service.parse_explanation(raw)) == 5


def test_normalize_math_converts_bracket_delimiters_but_leaves_escaped_ones():
    assert service.normalize_math("a \\(b\\) c") == "a $b$ c"
    assert service.normalize_math("x\n\\[\ny\n\\]\nz") == "x\n\n$$\ny\n$$\n\nz"
    # a line that is only $$y$$ is a displayed equation; one inside a sentence is left alone
    assert service.normalize_math("x\n$$y$$\nz") == "x\n$$\ny\n$$\nz"
    assert service.normalize_math("so $$y$$ holds") == "so $$y$$ holds"
    # \\[2pt] is a line break with a length, not the start of a display equation
    assert service.normalize_math("a \\\\[2pt] b") == "a \\\\[2pt] b"


def test_split_blocks_splits_at_blank_lines_but_not_inside_equations_or_code():
    text = "First.\n\n$$\na\n\nb\n$$\n\nSecond.\n\n```\ncode\n\nmore\n```\n"
    assert service.split_blocks(text) == ["First.", "$$\na\n\nb\n$$", "Second.", "```\ncode\n\nmore\n```"]
    assert service.split_blocks("   \n\n ") == []
