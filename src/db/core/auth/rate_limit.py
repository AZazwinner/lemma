import hashlib
import os
import time
from collections import defaultdict

from db.coordination import get_sync_client


MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60
LOCKOUT_SECONDS = 15 * 60

_attempts: dict[str, list[float]] = defaultdict(list)
_locked_until: dict[str, float] = {}

_warned_bad_signup_limit = False


def signup_max_attempts() -> int:
    """Sign-ups allowed per client IP per window. SIGNUP_MAX_ATTEMPTS raises or lowers it (e.g. for a demo where many people share one IP); anything that isn't a positive whole number is ignored, with one warning, and the default applies."""
    global _warned_bad_signup_limit
    raw = os.getenv("SIGNUP_MAX_ATTEMPTS", "").strip()
    if not raw:
        return MAX_ATTEMPTS
    try:
        value = int(raw)
    except ValueError:
        value = 0
    if value < 1:
        if not _warned_bad_signup_limit:
            _warned_bad_signup_limit = True
            print(f"rate_limit: ignoring SIGNUP_MAX_ATTEMPTS={raw!r} (need a positive whole number); using {MAX_ATTEMPTS}")
        return MAX_ATTEMPTS
    return value


def _prune(key: str, now: float) -> None:
    _attempts[key] = [t for t in _attempts[key] if now - t < WINDOW_SECONDS]


def _memory_is_locked_out(key: str) -> tuple[bool, float]:
    now = time.time()
    until = _locked_until.get(key)
    if until is None:
        return False, 0.0
    if now >= until:
        del _locked_until[key]
        return False, 0.0
    return True, until - now


def _memory_record_failure(key: str, max_attempts: int) -> None:
    now = time.time()
    _prune(key, now)
    _attempts[key].append(now)
    if len(_attempts[key]) >= max_attempts:
        _locked_until[key] = now + LOCKOUT_SECONDS
        _attempts[key] = []


def _memory_record_success(key: str) -> None:
    _attempts.pop(key, None)
    _locked_until.pop(key, None)


def _failures_key(key: str) -> str:
    return f"mb:rl:f:{hashlib.sha256(key.encode()).hexdigest()[:32]}"


def _lock_key(key: str) -> str:
    return f"mb:rl:l:{hashlib.sha256(key.encode()).hexdigest()[:32]}"


def _valkey_is_locked_out(client, key: str) -> tuple[bool, float]:
    remaining_ms = client.pttl(_lock_key(key))
    if remaining_ms is None or remaining_ms <= 0:
        return False, 0.0
    return True, remaining_ms / 1000


def _valkey_record_failure(client, key: str, max_attempts: int) -> None:
    now = time.time()
    failures = _failures_key(key)
    pipe = client.pipeline()
    pipe.zremrangebyscore(failures, 0, now - WINDOW_SECONDS)
    pipe.zadd(failures, {f"{now}:{time.monotonic_ns()}": now})
    pipe.expire(failures, WINDOW_SECONDS)
    pipe.zcard(failures)
    count = pipe.execute()[-1]
    if count >= max_attempts:
        pipe = client.pipeline()
        pipe.set(_lock_key(key), 1, ex=LOCKOUT_SECONDS)
        pipe.delete(failures)
        pipe.execute()


def _valkey_record_success(client, key: str) -> None:
    client.delete(_failures_key(key), _lock_key(key))


def _shared(valkey_fn, memory_fn, key: str, *args):
    """Counts live in Valkey so every backend replica sees the same attempts. If Valkey isn't configured or can't be reached, fall back to this process's own counters: weaker (per replica) but never blocks logins."""
    client = get_sync_client()
    if client is not None:
        try:
            return valkey_fn(client, key, *args)
        except Exception as e:
            print(f"rate_limit: Valkey unavailable, using in-memory counters: {e}")
    return memory_fn(key, *args)


def is_locked_out(key: str) -> tuple[bool, float]:
    """Returns (locked, seconds_remaining)."""
    return _shared(_valkey_is_locked_out, _memory_is_locked_out, key)


def record_failure(key: str, max_attempts: int | None = None) -> None:
    """Counts one attempt against `key`; the key is locked out once `max_attempts` (default MAX_ATTEMPTS) are inside the window."""
    _shared(_valkey_record_failure, _memory_record_failure, key, max_attempts or MAX_ATTEMPTS)


def record_success(key: str) -> None:
    _shared(_valkey_record_success, _memory_record_success, key)
