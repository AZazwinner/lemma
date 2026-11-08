import asyncio
import hashlib
import re
import time

from modules.sidekick import config, llm, mock, prompts
from modules.sidekick.errors import ModelBusy, ModelError
from modules.sidekick.limits import SlidingWindowLimiter, TTLCache
from modules.sidekick.usage import seconds_until_reset, usage

FEATURES = ["latex", "explain", "fix", "check", "next", "write", "image"]


class SidekickDisabled(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class SidekickBusy(Exception):
    """Too many requests (this user, the daily budget, or the provider's own limit). `retry_after` is in whole seconds."""

    def __init__(self, retry_after: float, reason: str):
        super().__init__(reason)
        self.retry_after = max(1, int(retry_after + 0.999))
        self.reason = reason


class SidekickUpstreamError(Exception):
    """The provider (or its answer) failed. `reason` is a short, safe description such as "HTTP 503": never the provider's own message."""

    def __init__(self, reason: str = ""):
        super().__init__(reason)
        self.reason = reason


user_limiter = SlidingWindowLimiter(window=60.0)
cache = TTLCache(max_entries=256)
_inflight: dict[str, "asyncio.Future[str]"] = {}

# After the provider says 429, stop sending anything until its retry hint has passed.
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


async def _run(
    feature: str, user_id: int, text: str, on_working=None, prompt: str | None = None, image: tuple[bytes, str] | None = None
) -> tuple[str, bool]:
    """Returns (raw model answer, served_without_a_new_request). Raises SidekickDisabled, SidekickBusy or SidekickUpstreamError.

    `on_working()` is called once the request has passed every limit and is about to go to the model (never for a cached answer), so a caller can show that the sidekick has started. `text` identifies the request (cache key); `prompt` is what the model is shown, defaulting to `text` in <input> tags."""
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
        if on_working is not None:
            on_working()
        try:
            if current_mode == "mock":
                answer = await mock.mock_generate(feature, text)
            else:
                system, max_tokens = prompts.SYSTEM[feature]
                extra = {"image": image} if image is not None else {}
                answer = await llm.generate(system, prompt or prompts.wrap_input(text), max_output_tokens=max_tokens, **extra)
        except ModelBusy as e:
            _cooldown_until = time.monotonic() + e.retry_after
            raise SidekickBusy(e.retry_after, "provider quota") from None
        except ModelError as e:
            print(f"sidekick: {feature} failed: {e.reason}")
            # The provider answered with an error status, so it didn't do the work: hand the request back. A timeout
            # (504) is different, since it may well have finished (and billed) it, so it stays counted.
            if current_mode == "live" and e.reason.startswith("HTTP ") and e.reason != "HTTP 504":
                usage.refund()
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


def strip_fences(raw: str) -> str:
    """Removes a code fence a model may wrap its whole answer in."""
    text = raw.strip()
    text = re.sub(r"^```[a-zA-Z]*\s*\n?", "", text)
    return re.sub(r"\n?```$", "", text).strip()


def clean_latex(raw: str) -> str:
    """Strips code fences and math delimiters a model may add despite being told not to."""
    text = strip_fences(raw)
    for left, right in (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$")):
        if text.startswith(left) and text.endswith(right) and len(text) >= len(left) + len(right):
            inner = text[len(left) : len(text) - len(right)].strip()
            if left == "$" and "$" in inner:
                continue
            text = inner
            break
    return text


_BRACKET_DISPLAY = re.compile(r"(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]")
_BRACKET_INLINE = re.compile(r"(?<!\\)\\\((.+?)(?<!\\)\\\)")
_DOLLAR_DISPLAY = re.compile(r"\$\$([\s\S]+?)\$\$")
_ONE_LINE_DISPLAY = re.compile(r"^[ \t]*\$\$([^$\n]+?)\$\$[ \t]*$", re.MULTILINE)


def normalize_math(text: str) -> str:
    """The document writes maths as $...$ and $$...$$. A model that was told so can still answer with \\( \\) and \\[ \\],
    which would show up as raw backslashes in the editor, so convert them."""
    text = _BRACKET_DISPLAY.sub(lambda m: f"\n\n$$\n{m.group(1).strip()}\n$$\n\n", text)
    text = _BRACKET_INLINE.sub(lambda m: f"${m.group(1).strip()}$", text)
    # A line that is only $$ ... $$ is a displayed equation, and the page draws it as one only when the $$ are on their own lines.
    text = _ONE_LINE_DISPLAY.sub(lambda m: f"$$\n{m.group(1).strip()}\n$$", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _inline_math(text: str) -> str:
    """Like normalize_math, but everything becomes inline $...$: an explanation is sentences, not displayed equations."""
    text = _BRACKET_DISPLAY.sub(lambda m: f"${m.group(1).strip()}$", text)
    text = _BRACKET_INLINE.sub(lambda m: f"${m.group(1).strip()}$", text)
    return _DOLLAR_DISPLAY.sub(lambda m: "$" + re.sub(r"\s+", " ", m.group(1)).strip() + "$", text)


def split_blocks(text: str) -> list[str]:
    """Splits text into document blocks at blank lines, but never inside a $$ ... $$ equation or a code fence."""
    blocks: list[str] = []
    current: list[str] = []
    in_math = in_code = False
    for line in text.strip().splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
        elif not in_code and stripped == "$$":
            in_math = not in_math
        if not stripped and not in_math and not in_code:
            if current:
                blocks.append("\n".join(current))
                current = []
            continue
        current.append(line)
    if current:
        blocks.append("\n".join(current))
    return blocks


_STEP = re.compile(r"^\s*(?:\d+[.)]|[-*•])\s*(.+)$")
MAX_EXPLANATION_LINES = 5
MAX_EXPLANATION_LINE_CHARS = 500


def parse_explanation(raw: str) -> list[str]:
    """The sentences of an explanation, one per line. Tolerates numbering, bullets and the old "SUMMARY:" format."""
    sentences: list[str] = []
    for line in _inline_math(strip_fences(raw)).splitlines():
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("SUMMARY:"):
            line = line[len("SUMMARY:") :].strip()
        match = _STEP.match(line)
        line = match.group(1).strip() if match else line
        if line:
            sentences.append(line[:MAX_EXPLANATION_LINE_CHARS])
    return sentences[:MAX_EXPLANATION_LINES]


async def to_latex(user_id: int, text: str, on_working=None) -> tuple[str, bool]:
    answer, from_cache = await _run("latex", user_id, _normalize(text), on_working)
    latex = clean_latex(answer)
    if not latex:
        raise SidekickUpstreamError("empty latex")
    return latex, from_cache


async def explain(user_id: int, latex: str, on_working=None) -> tuple[str, bool]:
    """A short explanation of what is in `latex`, as sentences separated by newlines."""
    answer, from_cache = await _run("explain", user_id, latex.strip(), on_working)
    sentences = parse_explanation(answer)
    if not sentences:
        raise SidekickUpstreamError("empty explanation")
    return "\n".join(sentences), from_cache


async def write(user_id: int, description: str, on_working=None) -> tuple[str, bool]:
    """Writes a passage (text with maths, in $ and $$) from a description."""
    answer, from_cache = await _run("write", user_id, _normalize(description), on_working)
    text = normalize_math(strip_fences(answer))
    if not text:
        raise SidekickUpstreamError("empty writing")
    return text, from_cache


IMAGE_MIME_TYPES = ("image/jpeg", "image/png", "image/webp")
# The browser shrinks a photo to well under this before sending (HTTP bodies are capped at 1 MiB in body_limit.py).
MAX_IMAGE_BYTES = 600 * 1024


def image_kind(data: bytes) -> str | None:
    """The image type a file really is, from its first bytes, or None if it is none of the supported ones."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def image_to_latex(user_id: int, data: bytes, mime_type: str, on_working=None) -> tuple[str, bool]:
    """Transcribes a photo or screenshot of maths. The caller has already checked that `data` is a real image of `mime_type` and small enough."""
    # The cache key is the picture itself (a hash), so the same photo sent twice is answered once.
    digest = hashlib.sha256(data).hexdigest()
    answer, from_cache = await _run("image", user_id, f"{mime_type}:{digest}", on_working, prompts.IMAGE_PROMPT, (data, mime_type))
    # Markdown now (prose, $...$ and $$ blocks), not bare LaTeX, so only fences and bracket delimiters are normalized.
    text = normalize_math(strip_fences(answer))
    if not text:
        raise SidekickUpstreamError("empty transcription")
    return text, from_cache


def parse_fields(raw: str, keys: tuple[str, ...]) -> dict[str, str]:
    """Reads "KEY: value" lines (a value may continue on the lines after it) into a dict keyed by the upper-case key."""
    pattern = re.compile(r"^\s*(" + "|".join(keys) + r")\s*:\s*(.*)$", re.IGNORECASE)
    fields: dict[str, str] = {}
    current = None
    for line in raw.splitlines():
        match = pattern.match(line)
        if match:
            current = match.group(1).upper()
            fields[current] = match.group(2)
        elif current is not None:
            fields[current] += "\n" + line
    return {key: value.strip() for key, value in fields.items()}


_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z$\\])")


def one_sentence(text: str) -> str:
    """The first sentence of `text`. A model asked for "one sentence" sometimes writes two; the page has room for one line."""
    text = re.sub(r"\s+", " ", text).strip()
    return _SENTENCE_END.split(text, maxsplit=1)[0] if text else ""


def clean_steps(steps: list[str]) -> list[str]:
    return [re.sub(r"\s+", " ", step).strip() for step in steps if step.strip()]


def _numbered(steps: list[str]) -> str:
    return "\n".join(f"{n}. {step}" for n, step in enumerate(steps, 1))


async def fix(user_id: int, latex: str, error: str = "", on_working=None) -> dict:
    """Repairs a block that contains LaTeX that fails to render, and returns the whole corrected block. `error` is the renderer's message, if the caller has one."""
    latex, error = latex.strip(), _normalize(error)[:500]
    prompt = prompts.wrap_input(latex) + (f"\n<error>\n{error}\n</error>" if error else "")
    answer, from_cache = await _run("fix", user_id, f"{latex}\n--\n{error}", on_working, prompt)
    fields = parse_fields(answer, ("LATEX", "WHY"))
    fixed = strip_fences(fields.get("LATEX") or answer)
    if not latex.lstrip().startswith(("$", "\\[", "\\(")):
        fixed = clean_latex(fixed)  # bare LaTeX in, bare LaTeX out: drop any wrapper the model added
    if not fixed:
        raise SidekickUpstreamError("empty fix")
    return {
        "latex": fixed,
        "why": one_sentence(fields.get("WHY", "")),
        "changed": _normalize(fixed) != _normalize(latex),
        "cached": from_cache,
    }


async def check_work(user_id: int, steps: list[str], on_working=None) -> dict:
    """Finds the first step of a derivation that doesn't follow from the one before."""
    steps = clean_steps(steps)
    if not steps:
        raise SidekickUpstreamError("no steps")
    answer, from_cache = await _run("check", user_id, _numbered(steps), on_working)
    fields = parse_fields(answer, ("VERDICT", "STEP", "WHY", "FIX"))
    verdict = fields.get("VERDICT", "").upper()
    number = re.search(r"\d+", fields.get("STEP", ""))
    step = int(number.group()) if number else None
    if step is not None and not 1 <= step <= len(steps):
        step = None
    if not verdict and step is None:
        raise SidekickUpstreamError("unreadable check")
    is_ok = verdict.startswith("OK") or (not verdict and step is None)
    suggestion = clean_latex(fields["FIX"]) if fields.get("FIX") else None
    return {
        "ok": is_ok,
        "step": None if is_ok else step,
        "why": one_sentence(fields.get("WHY", "")),
        "suggestion": None if is_ok else (suggestion or None),
        "cached": from_cache,
    }


def _single_step(text: str) -> str:
    """Exactly one step: the first non-empty line, without a list marker or a trailing line break."""
    for line in text.splitlines():
        line = _STEP.sub(r"\1", line).strip()
        line = re.sub(r"\s*\\\\\s*$", "", line).strip()  # a trailing \\ of an aligned block
        if line:
            return line
    return ""


async def next_step(user_id: int, steps: list[str], on_working=None) -> dict:
    """Suggests the single next step of a derivation."""
    steps = clean_steps(steps)
    if not steps:
        raise SidekickUpstreamError("no steps")
    answer, from_cache = await _run("next", user_id, _numbered(steps), on_working)
    fields = parse_fields(answer, ("NEXT", "WHY"))
    # A model that ignores the format still gets a chance: its whole answer is taken as the step. An empty one is an error.
    # clean_latex before (a whole $$...$$ block) and after (a "$...$" on one list line) picking the one line
    suggestion = clean_latex(_single_step(clean_latex(fields["NEXT"] if "NEXT" in fields else answer)))
    if not suggestion:
        raise SidekickUpstreamError("unreadable step")
    done = suggestion.strip().upper().rstrip(".") == "DONE"
    return {"next": None if done else suggestion, "done": done, "why": one_sentence(fields.get("WHY", "")), "cached": from_cache}


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
