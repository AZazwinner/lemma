"""The only place that talks to Google. Uses the official google-genai SDK (client.aio, so a slow call never blocks the
event loop that also serves the live-editing sockets).

Errors are translated into two exceptions so nothing above this file needs to know the SDK. Error text from Google is
deliberately not logged or passed on: only the HTTP status is.
"""

import re

from modules.sidekick import config

REQUEST_TIMEOUT_MS = 25_000
DEFAULT_RETRY_AFTER = 30


class GeminiBusy(Exception):
    """Google said the quota or rate limit is used up (HTTP 429)."""

    def __init__(self, retry_after: int = DEFAULT_RETRY_AFTER):
        super().__init__("busy")
        self.retry_after = retry_after


class GeminiError(Exception):
    """Any other failure talking to Google: network, bad key, server error, empty answer."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


_client = None
_client_key = None


def _get_client():
    global _client, _client_key
    key = config.api_key()
    if _client is None or _client_key != key:
        from google import genai

        _client = genai.Client(api_key=key)
        _client_key = key
    return _client


def _retry_after_from(error) -> int:
    """Google's 429 usually carries a RetryInfo like {"retryDelay": "23s"}."""
    try:
        for detail in (error.details or {}).get("error", {}).get("details", []):
            match = re.fullmatch(r"(\d+(?:\.\d+)?)s", str(detail.get("retryDelay", "")))
            if match:
                return max(1, int(float(match.group(1)) + 0.999))
    except Exception:
        pass
    return DEFAULT_RETRY_AFTER


async def generate(system: str, contents, *, max_output_tokens: int, vision: bool = False) -> str:
    """One generate_content call. `contents` is a string, or a list for image input."""
    try:
        from google.genai import errors, types
    except ImportError as e:
        raise GeminiError("google-genai is not installed") from e

    model = config.vision_model() if vision else config.model()
    cfg = {
        "system_instruction": system,
        "max_output_tokens": max_output_tokens,
        "http_options": types.HttpOptions(
            timeout=REQUEST_TIMEOUT_MS,
            # One attempt: a retry is a second request against a small quota.
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    }
    level = config.thinking_level()
    try:
        if level:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_level=level)
        request_config = types.GenerateContentConfig(**cfg)
    except Exception:
        raise GeminiError("invalid GEMINI_THINKING_LEVEL") from None

    try:
        response = await _get_client().aio.models.generate_content(
            model=model, contents=contents, config=request_config
        )
    except errors.APIError as e:
        if e.code == 429:
            raise GeminiBusy(_retry_after_from(e)) from None
        raise GeminiError(f"HTTP {e.code}") from None
    except Exception as e:
        raise GeminiError(type(e).__name__) from None

    try:
        text = (response.text or "").strip()
    except Exception:
        text = ""
    if not text:
        raise GeminiError("empty answer")
    return text
