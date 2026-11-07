import asyncio
import hashlib
import re
import time

from modules.sidekick import config, gemini, mock, prompts
from modules.sidekick.limits import SlidingWindowLimiter, TTLCache
from modules.sidekick.usage import seconds_until_reset, usage

FEATURES = ["latex", "explain"]


class SidekickDisabled(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class SidekickBusy(Exception):
    """Too many requests (this user, the daily budget, or Google's own limit). `retry_after` is in whole seconds."""

    def __init__(self, retry_after: float, reason: str):
        super().__init__(reason)
        self.retry_after = max(1, int(retry_after + 0.999))
        self.reason = reason


class SidekickUpstreamError(Exception):
    pass


user_limiter = SlidingWindowLimiter(window=60.0)
cache = TTLCache(max_entries=256)
_inflight: dict[str, "asyncio.Future[str]"] = {}

# After Google says 429, stop sending anything until its retry hint has passed.
_cooldown_until = 0.0


def reset_for_tests() -> None:
    global _cooldown_until
    user_limiter.clear()
    cache.clear()
    _inflight.clear()
    _cooldown_until = 0.0
    usage.reset_for_tests()


def _cache_key(feature: str, text: str) -> str:
    return hashlib.sha256(f"{feature}\0{text}".encode()).hexdigest()


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


async def _run(feature: str, user_id: int, text: str) -> tuple[str, bool]:
    """Returns (raw model answer, served_without_a_new_request). Raises SidekickDisabled, SidekickBusy or SidekickUpstreamError."""
    global _cooldown_until
    current_mode = config.mode()
    if current_mode == "disabled":
        raise SidekickDisabled(config.disabled_reason())

    key = _cache_key(feature, text)
    cached = cache.get(key)
    if cached is not None:
        return cached, True

    # The same request is already on its way: wait for that answer instead of sending another.
    pending = _inflight.get(key)
    if pending is not None:
        return await asyncio.shield(pending), True

    if current_mode == "mock":
        if "__busy__" in text:
            raise SidekickBusy(20, "mock busy")
        if "__error__" in text:
            raise SidekickUpstreamError("mock error")
    else:
        remaining = _cooldown_until - time.monotonic()
        if remaining > 0:
            raise SidekickBusy(remaining, "cooling down after a quota response")

    wait = user_limiter.retry_after(user_id, config.user_per_minute())
    if wait > 0:
        raise SidekickBusy(wait, "per-user limit")

    if current_mode == "live":
        count = usage.try_reserve(config.daily_budget())
        if count is None:
            raise SidekickBusy(seconds_until_reset(), "daily budget used up")
        print(f"sidekick: {feature} request {count}/{config.daily_budget()} today")
    user_limiter.hit(user_id)

    future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
    _inflight[key] = future
    try:
        try:
            if current_mode == "mock":
                answer = await mock.mock_generate(feature, text)
            else:
                system, max_tokens = (
                    (prompts.LATEX_SYSTEM, 1024) if feature == "latex" else (prompts.EXPLAIN_SYSTEM, 2048)
                )
                answer = await gemini.generate(system, prompts.wrap_input(text), max_output_tokens=max_tokens)
        except gemini.GeminiBusy as e:
            _cooldown_until = time.monotonic() + e.retry_after
            raise SidekickBusy(e.retry_after, "Google quota") from None
        except gemini.GeminiError as e:
            print(f"sidekick: {feature} failed: {e.reason}")
            raise SidekickUpstreamError(e.reason) from None
    except asyncio.CancelledError:
        future.cancel()
        raise
    except Exception as e:
        future.set_exception(e)
        future.exception()  # mark it retrieved, so asyncio doesn't complain when nobody else was waiting
        raise
    finally:
        _inflight.pop(key, None)

    future.set_result(answer)
    cache.put(key, answer, config.cache_seconds())
    return answer, False


def clean_latex(raw: str) -> str:
    """Strips code fences and math delimiters a model may add despite being told not to."""
    text = raw.strip()
    text = re.sub(r"^```[a-zA-Z]*\s*\n?", "", text)
    text = re.sub(r"\n?```$", "", text).strip()
    for left, right in (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$")):
        if text.startswith(left) and text.endswith(right) and len(text) >= len(left) + len(right):
            inner = text[len(left) : len(text) - len(right)].strip()
            if left == "$" and "$" in inner:
                continue
            text = inner
            break
    return text


_STEP = re.compile(r"^\s*(?:\d+[.)]|[-*•])\s*(.+)$")


def parse_explanation(raw: str) -> tuple[str, list[str]]:
    summary = ""
    steps: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("SUMMARY:"):
            summary = line[len("SUMMARY:") :].strip()
            continue
        match = _STEP.match(line)
        steps.append(match.group(1).strip() if match else line)
    if not summary and steps:
        summary = steps.pop(0)
    return summary, steps[:8]


async def to_latex(user_id: int, text: str) -> tuple[str, bool]:
    answer, from_cache = await _run("latex", user_id, _normalize(text))
    latex = clean_latex(answer)
    if not latex:
        raise SidekickUpstreamError("empty latex")
    return latex, from_cache


async def explain(user_id: int, latex: str) -> tuple[str, list[str], bool]:
    answer, from_cache = await _run("explain", user_id, latex.strip())
    summary, steps = parse_explanation(answer)
    if not summary and not steps:
        raise SidekickUpstreamError("empty explanation")
    return summary, steps, from_cache


def status() -> dict:
    current_mode = config.mode()
    return {
        "enabled": current_mode != "disabled",
        "mock": current_mode == "mock",
        "used_today": usage.used_today(),
        "daily_budget": config.daily_budget(),
        "user_per_minute": config.user_per_minute(),
        "features": FEATURES if current_mode != "disabled" else [],
    }
