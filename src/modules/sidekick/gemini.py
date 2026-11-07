"""The only place that talks to Google. Uses the official google-genai SDK (client.aio, so a slow call never blocks the
event loop that also serves the live-editing sockets).

Errors are translated into two exceptions so nothing above this file needs to know the SDK. Error text from Google is
deliberately not logged or passed on: only the HTTP status is.
"""

import re

from modules.sidekick import config
from modules.sidekick.errors import DEFAULT_RETRY_AFTER, ModelBusy, ModelError

# The same exceptions every provider raises, under the names this module has always used.
GeminiBusy = ModelBusy
GeminiError = ModelError


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


async def generate(
    system: str, contents, *, max_output_tokens: int, vision: bool = False, image: tuple[bytes, str] | None = None
) -> str:
    """One generate_content call. `image` is (bytes, mime type) to send a picture along with the text in `contents`; it uses GEMINI_VISION_MODEL (which falls back to GEMINI_MODEL) when `vision` is set."""
    try:
        from google.genai import errors, types
    except ImportError as e:
        raise GeminiError("google-genai is not installed") from e

    model = config.vision_model() if (vision or image) else config.model()
    cfg = {
        "system_instruction": system,
        "max_output_tokens": max_output_tokens,
        "http_options": types.HttpOptions(
            timeout=config.timeout_seconds() * 1000,
            # One attempt: a retry is a second request against a small quota.
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    }
    if image is not None:
        contents = [types.Part.from_bytes(data=image[0], mime_type=image[1]), contents]
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
        # A model that reasons before answering spends its output allowance on the reasoning (max_output_tokens counts
        # it), and can run out before writing a word. Say so, since "no answer" would hide the real cause.
        try:
            finished_because = str(response.candidates[0].finish_reason)
        except Exception:
            finished_because = ""
        raise GeminiError("output limit" if "MAX_TOKENS" in finished_because else "empty answer")
    return text
