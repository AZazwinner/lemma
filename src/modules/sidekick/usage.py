"""Today's request count against the daily budget.

Google resets free-tier daily quotas at midnight Pacific time, so the "day" here is the Pacific day. The count is kept
in a small gitignored file (src/.sidekick_usage), so restarting the backend does not hand the budget back and let it
overshoot the real quota. If the file can't be read or written the count simply lives in memory.
"""

import json
import os
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from db.url import SRC_DIR

USAGE_FILE = SRC_DIR / ".sidekick_usage"

try:
    from zoneinfo import ZoneInfo

    _PACIFIC = ZoneInfo("America/Los_Angeles")
except Exception:  # no tz database on this machine (e.g. Windows without the tzdata package)
    _PACIFIC = timezone(timedelta(hours=-8))  # off by an hour during daylight saving time; good enough for a counter


def _now() -> datetime:
    return datetime.now(_PACIFIC)


def seconds_until_reset() -> int:
    now = _now()
    tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=now.tzinfo)
    return max(1, int((tomorrow - now).total_seconds()))


class DailyUsage:
    def __init__(self, path: Path | None = None):
        self._path = path
        self._lock = threading.Lock()
        self._day: date | None = None
        self._count = 0
        self._warned = False

    def _file(self) -> Path:
        override = os.getenv("SIDEKICK_USAGE_FILE", "").strip()
        if override:
            return Path(override)
        return self._path or USAGE_FILE

    def _load(self, today: date) -> None:
        """Brings the in-memory count in line with today. Called with the lock held."""
        if self._day == today:
            return
        self._day, self._count = today, 0
        try:
            data = json.loads(self._file().read_text(encoding="utf-8"))
            if data.get("day") == today.isoformat():
                self._count = max(0, int(data.get("count", 0)))
        except FileNotFoundError:
            pass
        except Exception as e:
            self._warn(f"could not read usage file ({type(e).__name__})")

    def _save(self) -> None:
        path = self._file()
        tmp = path.with_name(path.name + ".tmp")
        try:
            tmp.write_text(json.dumps({"day": self._day.isoformat(), "count": self._count}), encoding="utf-8")
            os.replace(tmp, path)
        except Exception as e:
            self._warn(f"could not write usage file ({type(e).__name__}); counting in memory only")

    def _warn(self, message: str) -> None:
        if not self._warned:
            self._warned = True
            print(f"sidekick: {message}")

    def used_today(self) -> int:
        with self._lock:
            self._load(_now().date())
            return self._count

    def try_reserve(self, budget: int) -> int | None:
        """Counts one request if the budget allows, returning the new count, or None if today's budget is spent."""
        with self._lock:
            self._load(_now().date())
            if self._count >= budget:
                return None
            self._count += 1
            self._save()
            return self._count

    def reset_for_tests(self) -> None:
        with self._lock:
            self._day, self._count, self._warned = None, 0, False


usage = DailyUsage()
