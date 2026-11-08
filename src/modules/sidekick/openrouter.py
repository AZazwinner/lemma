"""The only place that talks to OpenRouter (DeepSeek by default). One async HTTP call to its OpenAI-style chat endpoint, so
a slow answer never blocks the event loop that also serves the live-editing sockets.

Errors become the shared ModelBusy / ModelError. OpenRouter's own error text is not logged or passed on: only the status.
"""

import base64

import httpx

from modules.sidekick import config
from modules.sidekick.errors import DEFAULT_RETRY_AFTER, ModelBusy, ModelError

URL = "https://openrouter.ai/api/v1/chat/completions"


def _reasoning() -> dict:
    level = config.reasoning()
    return {"enabled": False} if level == "off" else {"effort": level, "exclude": True}


def _retry_after(response: httpx.Response) -> int:
    try:
        return max(1, int(float(response.headers.get("retry-after", ""))))
    except ValueError:
        return DEFAULT_RETRY_AFTER


def _user_content(text: str, image: tuple[bytes, str] | None):
    if image is None:
        return text
    data, mime = image
    url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    return [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": url}}]


def _status_from_body(body: dict) -> int | None:
    """OpenRouter can answer 200 and still report a failure (the upstream model errored) in an "error" object."""
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return None
    code = error.get("code")
    return code if isinstance(code, int) else 502


async def generate(
    system: str, contents: str, *, max_output_tokens: int, vision: bool = False, image: tuple[bytes, str] | None = None
) -> str:
    """One chat completion. `image` is (bytes, mime type) to send a picture along with `contents`."""
    payload = {
        "model": config.model_for("openrouter", vision=bool(vision or image)),
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": _user_content(contents, image)},
        ],
        "max_tokens": max_output_tokens,
        "reasoning": _reasoning(),
    }
    headers = {
        "Authorization": f"Bearer {config.openrouter_key()}",
        # Optional attribution headers OpenRouter documents; harmless, and they make the app recognisable in its dashboard.
        "X-Title": "Lemma Sidekick",
    }
    try:
        async with httpx.AsyncClient(timeout=config.timeout_seconds()) as client:
            response = await client.post(URL, json=payload, headers=headers)
    except httpx.TimeoutException:
        raise ModelError("HTTP 504") from None
    except httpx.HTTPError as e:
        raise ModelError(type(e).__name__) from None

    if response.status_code == 429:
        raise ModelBusy(_retry_after(response))
    if response.status_code >= 400:
        raise ModelError(f"HTTP {response.status_code}")

    try:
        body = response.json()
    except ValueError:
        raise ModelError("unreadable answer") from None
    status = _status_from_body(body)
    if status == 429:
        raise ModelBusy(DEFAULT_RETRY_AFTER)
    if status is not None:
        raise ModelError(f"HTTP {status}")

    try:
        choice = body["choices"][0]
        text = (choice.get("message", {}).get("content") or "").strip()
        finish = str(choice.get("finish_reason") or "")
    except (KeyError, IndexError, TypeError, AttributeError):
        raise ModelError("unreadable answer") from None
    if not text:
        raise ModelError("output limit" if finish == "length" else "empty answer")
    return text
