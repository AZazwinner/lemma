"""In-memory limits and a small TTL cache.

Like the rest of the backend's rate limiting (see db/core/auth/rate_limit.py) this lives in the one backend process
(main.py runs exactly one). The auth limiter counts failures and then locks a key out for 15 minutes, which is not a
"N per minute" window, so this module has its own sliding window.
"""

import time
from collections import OrderedDict, defaultdict, deque
from typing import Any


class SlidingWindowLimiter:
    """At most `limit` hits per `window` seconds for each key."""

    def __init__(self, window: float = 60.0, clock=time.monotonic):
        self.window = window
        self._clock = clock
        self._hits: dict[Any, deque[float]] = defaultdict(deque)

    def _prune(self, key, now: float) -> deque[float]:
        hits = self._hits[key]
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if not hits:
            self._hits.pop(key, None)
            return deque()
        return hits

    def retry_after(self, key, limit: int) -> float:
        """0 if `key` may go now, otherwise the seconds until it may."""
        now = self._clock()
        hits = self._prune(key, now)
        if len(hits) < limit:
            return 0.0
        return max(0.0, self.window - (now - hits[0]))

    def hit(self, key) -> None:
        self._hits[key].append(self._clock())

    def clear(self) -> None:
        self._hits.clear()


class TTLCache:
    """A small cache whose entries expire after `ttl` seconds. The oldest entry goes when `max_entries` is reached."""

    def __init__(self, max_entries: int = 256, clock=time.monotonic):
        self.max_entries = max_entries
        self._clock = clock
        self._items: OrderedDict[str, tuple[float, Any]] = OrderedDict()

    def get(self, key: str) -> Any | None:
        entry = self._items.get(key)
        if entry is None:
            return None
        expires, value = entry
        if self._clock() >= expires:
            del self._items[key]
            return None
        return value

    def put(self, key: str, value: Any, ttl: float) -> None:
        self._items[key] = (self._clock() + ttl, value)
        self._items.move_to_end(key)
        while len(self._items) > self.max_entries:
            self._items.popitem(last=False)

    def clear(self) -> None:
        self._items.clear()
