"""The backend must start with no configuration: SQLite for the database, a generated SECRET_KEY."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

from db.core.auth.utils.token import load_secret_key
from db.url import SRC_DIR, default_database_url, normalize_database_url


def test_default_database_is_an_absolute_sqlite_file_in_src():
    url = default_database_url()
    assert url.startswith("sqlite:///")
    path = Path(url[len("sqlite:///"):])
    assert path.is_absolute()
    assert path == (SRC_DIR / "mathboard.db")


def test_default_database_does_not_depend_on_the_working_directory(tmp_path, monkeypatch):
    before = default_database_url()
    monkeypatch.chdir(tmp_path)
    assert default_database_url() == before


def test_database_module_falls_back_to_the_default_when_nothing_is_configured(tmp_path):
    """Imports the real module in a clean process with no DATABASE_URL and no .env, from another directory."""
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "SECRET_KEY")}
    env["PYTHONPATH"] = str(SRC_DIR)
    out = subprocess.run(
        [sys.executable, "-c", "import db.database as d; print(d.DATABASE_URL)"],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=60,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == normalize_database_url(default_database_url())


def test_secret_key_from_the_environment_wins(tmp_path):
    key_file = tmp_path / "key"
    assert load_secret_key("from-env", key_file) == "from-env"
    assert not key_file.exists()


def test_secret_key_is_generated_once_and_kept(tmp_path, capsys):
    key_file = tmp_path / "key"
    first = load_secret_key("", key_file)
    assert len(first) >= 32
    assert key_file.read_text().strip() == first
    assert load_secret_key("", key_file) == first
    assert "made a random one" in capsys.readouterr().out


def test_secret_key_uses_an_existing_file(tmp_path):
    key_file = tmp_path / "key"
    key_file.write_text("already-here\n")
    assert load_secret_key("   ", key_file) == "already-here"


def test_secret_keys_differ_between_machines(tmp_path):
    assert load_secret_key("", tmp_path / "a") != load_secret_key("", tmp_path / "b")


def test_unwritable_key_file_fails_with_a_clear_message(tmp_path):
    with pytest.raises(RuntimeError, match="set SECRET_KEY"):
        load_secret_key("", tmp_path / "missing-folder" / "key")


def test_the_suite_ignores_the_developers_env_file(tmp_path):
    """conftest neutralises load_dotenv, so a real src/.env (SMTP settings, ALLOW_DEV_RESET_LINK...) cannot change test behaviour."""
    from dotenv import load_dotenv

    env_file = tmp_path / ".env"
    env_file.write_text("MB_TEST_SENTINEL=leaked\n")
    load_dotenv(env_file)
    assert "MB_TEST_SENTINEL" not in os.environ
