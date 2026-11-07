"""Sidekick settings, all read from the environment on each call (so tests and .env changes take effect without a reload).

Two providers can answer: OpenRouter (default, DeepSeek) and Google Gemini. API keys are read here and in the provider
modules only; they are never returned by any endpoint and never logged.

Model names are settings. The only one written in code is DEFAULT_OPENROUTER_MODEL below, the default for OPENROUTER_MODEL.
"""

import os

_warned: set[str] = set()

PROVIDERS = ("openrouter", "gemini")
DEFAULT_PROVIDER = "openrouter"
DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash-1017"
REASONING_LEVELS = ("off", "low", "medium", "high")
DEFAULT_REASONING = "off"


def _warn_once(name: str, message: str) -> None:
    if name not in _warned:
        _warned.add(name)
        print(f"sidekick: {message}")


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
        _warn_once(name, f"ignoring {name}={raw!r} (need a positive whole number); using {default}")
        return default
    return value


def _choice(name: str, allowed: tuple[str, ...], default: str) -> str:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    if raw not in allowed:
        _warn_once(name, f"ignoring {name}={raw!r} (use one of {', '.join(allowed)}); using {default}")
        return default
    return raw


# --- which provider -----------------------------------------------------------------------------------------------

def provider() -> str:
    """Who answers text requests: "openrouter" (default) or "gemini"."""
    return _choice("SIDEKICK_PROVIDER", PROVIDERS, DEFAULT_PROVIDER)


def vision_provider() -> str:
    """Who reads photos. SIDEKICK_VISION_PROVIDER decides if set; otherwise Gemini whenever it is configured (a Gemini
    Flash Lite model read a test picture correctly), else the text provider."""
    explicit = _choice("SIDEKICK_VISION_PROVIDER", PROVIDERS, "")
    if explicit:
        return explicit
    if api_key() and vision_model():
        return "gemini"
    return provider()


def key_for(name: str) -> str:
    return openrouter_key() if name == "openrouter" else api_key()


def model_for(name: str, vision: bool = False) -> str:
    if name == "openrouter":
        return openrouter_vision_model() if vision else openrouter_model()
    return vision_model() if vision else model()


def ready(name: str, vision: bool = False) -> bool:
    return bool(key_for(name) and model_for(name, vision))


# --- OpenRouter ---------------------------------------------------------------------------------------------------

def openrouter_key() -> str:
    return os.getenv("OPENROUTER_API_KEY", "").strip()


def openrouter_model() -> str:
    return os.getenv("OPENROUTER_MODEL", "").strip() or DEFAULT_OPENROUTER_MODEL


def openrouter_vision_model() -> str:
    return os.getenv("OPENROUTER_VISION_MODEL", "").strip() or openrouter_model()


def reasoning() -> str:
    """How much hidden reasoning to ask an OpenRouter model for. "off" (default) is fastest; reasoning tokens are also
    billed as output."""
    return _choice("SIDEKICK_REASONING", REASONING_LEVELS, DEFAULT_REASONING)


# --- Gemini -------------------------------------------------------------------------------------------------------

def api_key() -> str:
    """The Gemini API key."""
    return os.getenv("GEMINI_API_KEY", "").strip()


def model() -> str:
    """The Gemini model. No default: with a Gemini key but no GEMINI_MODEL, Gemini is not used."""
    return os.getenv("GEMINI_MODEL", "").strip()


def vision_model() -> str:
    """The Gemini model for image input. Falls back to GEMINI_MODEL."""
    return os.getenv("GEMINI_VISION_MODEL", "").strip() or model()


def thinking_level() -> str:
    """Optional, Gemini only. Some models spend output tokens on hidden reasoning; "minimal" or "low" saves them. Left unset, nothing is sent."""
    return os.getenv("GEMINI_THINKING_LEVEL", "").strip()


# --- shared -------------------------------------------------------------------------------------------------------

MAX_TIMEOUT_SECONDS = 120


def timeout_seconds() -> int:
    """How long to wait for the model. A 31B model took 78 seconds to answer one short prompt, so the default is generous. Capped at MAX_TIMEOUT_SECONDS, because the browser stops waiting shortly after that."""
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
    """"mock", "live" or "disabled", for the text provider.

    Mock is the default when that provider has no key, and SIDEKICK_MOCK=1 forces it even with one. A Gemini key without
    GEMINI_MODEL is "disabled": better to say so than to guess a model.
    """
    requested = mock_requested()
    if requested is True:
        return "mock"
    name = provider()
    if not key_for(name):
        return "disabled" if requested is False else "mock"
    if not model_for(name):
        return "disabled"
    return "live"


def disabled_reason() -> str:
    name = provider()
    key_var = "OPENROUTER_API_KEY" if name == "openrouter" else "GEMINI_API_KEY"
    if mock_requested() is False and not key_for(name):
        return f"SIDEKICK_MOCK=0 but {key_var} is not set"
    if key_for(name) and not model_for(name):
        return "GEMINI_MODEL is not set"
    return "not configured"
