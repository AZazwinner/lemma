import os
import sys
import time

import pytest

from db.core.auth import rate_limit as rl


@pytest.fixture(params=["memory", "valkey"])
def limiter(request, monkeypatch):
    if request.param == "memory":
        monkeypatch.setattr(rl, "get_sync_client", lambda: None)
    elif not os.getenv("TEST_VALKEY_URL"):
        pytest.skip("TEST_VALKEY_URL not set")
    return request.param


def test_not_locked_out_before_the_first_attempt(limiter):
    locked, _ = rl.is_locked_out("key")
    assert locked is False


def test_locks_out_after_max_attempts(limiter):
    for _ in range(rl.MAX_ATTEMPTS - 1):
        rl.record_failure("key")
    locked, _ = rl.is_locked_out("key")
    assert locked is False

    rl.record_failure("key")
    locked, remaining = rl.is_locked_out("key")
    assert locked is True
    assert remaining > 0


def test_success_clears_the_failure_count(limiter):
    for _ in range(rl.MAX_ATTEMPTS - 1):
        rl.record_failure("key")
    rl.record_success("key")


    for _ in range(rl.MAX_ATTEMPTS - 1):
        rl.record_failure("key")
    locked, _ = rl.is_locked_out("key")
    assert locked is False


def test_lockout_expires_after_the_window(limiter, monkeypatch):
    monkeypatch.setattr(rl, "LOCKOUT_SECONDS", 1)

    for _ in range(rl.MAX_ATTEMPTS):
        rl.record_failure("key")
    assert rl.is_locked_out("key")[0] is True

    time.sleep(1.2)
    assert rl.is_locked_out("key")[0] is False


def test_keys_are_independent(limiter):
    for _ in range(rl.MAX_ATTEMPTS):
        rl.record_failure("attacker")
    assert rl.is_locked_out("attacker")[0] is True
    assert rl.is_locked_out("someone-else")[0] is False


def test_lockout_is_shared_across_processes():
    if not os.getenv("TEST_VALKEY_URL"):
        pytest.skip("TEST_VALKEY_URL not set")

    for _ in range(rl.MAX_ATTEMPTS):
        rl.record_failure("shared")

    rl._attempts.clear()
    rl._locked_until.clear()

    assert rl.is_locked_out("shared")[0] is True


class DeadClient:
    """Stands in for a Valkey server that cannot be reached: every call fails, as the real client's would."""

    def __getattr__(self, name):
        raise ConnectionError("valkey unreachable")


def test_falls_back_to_memory_when_valkey_is_unreachable(monkeypatch):
    monkeypatch.setattr(rl, "get_sync_client", lambda: DeadClient())

    for _ in range(rl.MAX_ATTEMPTS):
        rl.record_failure("key")

    assert rl.is_locked_out("key")[0] is True
    assert rl.is_locked_out("other")[0] is False


def test_falls_back_to_memory_when_the_valkey_package_is_not_installed(monkeypatch):
    import db.coordination as coordination

    monkeypatch.setenv("VALKEY_URL", "redis://127.0.0.1:1/0")
    monkeypatch.setitem(sys.modules, "valkey", None)
    monkeypatch.setattr(coordination, "_sync_client", None)
    monkeypatch.setattr(coordination, "_warned_missing_package", False)

    assert coordination.get_sync_client() is None
    for _ in range(rl.MAX_ATTEMPTS):
        rl.record_failure("key")

    assert rl.is_locked_out("key")[0] is True
    assert rl.is_locked_out("other")[0] is False
