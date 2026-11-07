"""Sidekick settings, all read from the environment on each call (so tests and .env changes take effect without a reload).

The Gemini API key is read here and in gemini.py only. It is never returned by any endpoint and never logged.
No model name is hardcoded anywhere: GEMINI_MODEL (and optionally GEMINI_VISION_MODEL) name it.
"""

import os

_warned: set[str] = set()


def _positive_int(name: str, default: int) -> int:
    """A positive whole number from the environment; anything else is ignored with one warning and the default applies."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = 0
    if value < 1:
        if name not in _warned:
            _warned.add(name)
            print(f"sidekick: ignoring {name}={raw!r} (need a positive whole number); using {default}")
        return default
    return value


def api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def model() -> str:
    return os.getenv("GEMINI_MODEL", "").strip()


def vision_model() -> str:
    """The model for image input (Phase 4). Falls back to GEMINI_MODEL."""
    return os.getenv("GEMINI_VISION_MODEL", "").strip() or model()


def thinking_level() -> str:
    """Optional. Some models spend output tokens on hidden reasoning; "minimal" or "low" saves them. Left unset, nothing is sent."""
    return os.getenv("GEMINI_THINKING_LEVEL", "").strip()


MAX_TIMEOUT_SECONDS = 120


def timeout_seconds() -> int:
    """How long to wait for Google. A 31B model took 78 seconds to answer one short prompt, so the default is generous. Capped at MAX_TIMEOUT_SECONDS, because the browser stops waiting shortly after that."""
    return min(_positive_int("SIDEKICK_TIMEOUT_SECONDS", 100), MAX_TIMEOUT_SECONDS)


def mock_requested() -> bool | None:
    """True/False if SIDEKICK_MOCK says so explicitly, None if it is unset."""
    raw = os.getenv("SIDEKICK_MOCK", "").strip().lower()
    if not raw:
        return None
    return raw in ("1", "true", "yes", "on")


def user_per_minute() -> int:
    return _positive_int("SIDEKICK_USER_PER_MINUTE", 5)


def daily_budget() -> int:
    return _positive_int("SIDEKICK_DAILY_BUDGET", 200)


def cache_seconds() -> int:
    return _positive_int("SIDEKICK_CACHE_SECONDS", 300)


def mode() -> str:
    """"mock", "live" or "disabled".

    Mock is the default when there is no key, and SIDEKICK_MOCK=1 forces it even with one. A key without GEMINI_MODEL
    is "disabled": better to say so than to guess a model.
    """
    requested = mock_requested()
    if requested is True:
        return "mock"
    if not api_key():
        return "disabled" if requested is False else "mock"
    if not model():
        return "disabled"
    return "live"


def disabled_reason() -> str:
    if mock_requested() is False and not api_key():
        return "SIDEKICK_MOCK=0 but GEMINI_API_KEY is not set"
    if api_key() and not model():
        return "GEMINI_MODEL is not set"
    return "not configured"
