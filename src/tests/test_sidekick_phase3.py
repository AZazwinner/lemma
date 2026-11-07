import pytest

from modules.sidekick import gemini, mock, service
from modules.sidekick.usage import usage
from tests.test_sidekick import SECRET, auth, clean_sidekick, fake_generate, go_live, signup  # noqa: F401


@pytest.fixture()
def token(client):
    return signup(client)


def post(client, token, path, body):
    return client.post(f"/sidekick/{path}", json=body, headers=auth(token))


def scripted(monkeypatch, answer):
    """Replaces the Gemini call with one that returns `answer`, and records the prompts it was shown."""
    prompts = []

    async def generate(system, contents, *, max_output_tokens, vision=False):
        prompts.append(contents)
        return answer

    monkeypatch.setattr(gemini, "generate", generate)
    return prompts


# --- parsing -----------------------------------------------------------------

def test_parse_fields_reads_keys_and_multiline_values():
    fields = service.parse_fields("LATEX: a\n  b\nWHY: because", ("LATEX", "WHY"))
    assert fields == {"LATEX": "a\n  b", "WHY": "because"}


def test_parse_fields_ignores_case_and_text_before_the_first_key():
    assert service.parse_fields("Sure!\nverdict: ok", ("VERDICT",)) == {"VERDICT": "ok"}


# --- fix ---------------------------------------------------------------------

def test_mock_fix_returns_a_repair_and_a_reason(client, token):
    resp = post(client, token, "fix", {"latex": "\\frac{1{2}", "error": "Expected '}'"})
    body = resp.json()
    assert resp.status_code == 200
    assert body["latex"] == "\\frac{1}{2}" and body["changed"] is True and "brace" in body["why"]
    assert body["mock"] is True


def test_fix_passes_the_renderer_error_to_the_model_as_data(client, token, monkeypatch):
    go_live(monkeypatch)
    prompts = scripted(monkeypatch, "LATEX: x^2\nWHY: Added the missing brace.")
    resp = post(client, token, "fix", {"latex": "x^{2", "error": "Expected '}', got 'EOF'"})
    assert resp.json()["latex"] == "x^2"
    assert prompts[0] == "<input>\nx^{2\n</input>\n<error>\nExpected '}', got 'EOF'\n</error>"


def test_fix_cleans_delimiters_and_copes_with_a_model_that_ignores_the_format(client, token, monkeypatch):
    go_live(monkeypatch)
    scripted(monkeypatch, "$$\\frac{1}{2}$$")
    body = post(client, token, "fix", {"latex": "\\frac{1}{2"}).json()
    assert body["latex"] == "\\frac{1}{2}" and body["why"] == ""


def test_fix_says_when_nothing_changed(client, token, monkeypatch):
    go_live(monkeypatch)
    scripted(monkeypatch, "LATEX: x^2\nWHY: It was already valid.")
    assert post(client, token, "fix", {"latex": "x^2"}).json()["changed"] is False


# --- check my work -----------------------------------------------------------

def test_mock_check_flags_the_second_step(client, token):
    body = post(client, token, "check", {"steps": ["2x + 3 = 7", "2x = 5", "x = 2.5"]}).json()
    assert body["ok"] is False and body["step"] == 2
    assert body["why"] and body["suggestion"] == "x = 2"


def test_mock_check_with_nothing_wrong(client, token):
    body = post(client, token, "check", {"steps": ["x = 1", "__ok__"]}).json()
    assert body["ok"] is True and body["step"] is None and body["suggestion"] is None


def test_check_numbers_the_steps_for_the_model_and_reads_its_verdict(client, token, monkeypatch):
    go_live(monkeypatch)
    prompts = scripted(monkeypatch, "VERDICT: ERROR\nSTEP: 3\nWHY: 4 / 2 is 2, not 3.\nFIX: $x = 2$")
    body = post(client, token, "check", {"steps": ["2x + 3 = 7", " 2x  = 4 ", "", "x = 3"]}).json()
    assert prompts[0] == "<input>\n1. 2x + 3 = 7\n2. 2x = 4\n3. x = 3\n</input>"
    assert body["ok"] is False and body["step"] == 3 and body["suggestion"] == "x = 2"


def test_check_ignores_a_step_number_that_doesnt_exist(client, token, monkeypatch):
    go_live(monkeypatch)
    scripted(monkeypatch, "VERDICT: ERROR\nSTEP: 9\nWHY: Something is off.")
    body = post(client, token, "check", {"steps": ["a", "b"]}).json()
    assert body["ok"] is False and body["step"] is None and body["why"] == "Something is off."


def test_check_ok_verdict(client, token, monkeypatch):
    go_live(monkeypatch)
    scripted(monkeypatch, "VERDICT: OK\nWHY: Every step follows.")
    body = post(client, token, "check", {"steps": ["a", "b"]}).json()
    assert body["ok"] is True and body["step"] is None


def test_check_with_an_unreadable_answer_is_an_error_not_a_guess(client, token, monkeypatch):
    go_live(monkeypatch)
    scripted(monkeypatch, "I think it is probably fine, but who knows.")
    assert post(client, token, "check", {"steps": ["a", "b"]}).status_code == 502


@pytest.mark.parametrize("steps", [[], ["x"] * 21, ["x" * 501], ["  ", ""]])
def test_check_and_next_reject_bad_step_lists(client, token, steps):
    assert post(client, token, "check", {"steps": steps}).status_code == 422
    assert post(client, token, "next", {"steps": steps}).status_code == 422


# --- suggest the next step ---------------------------------------------------

def test_mock_next_suggests_a_step(client, token):
    body = post(client, token, "next", {"steps": ["2x = 6"]}).json()
    assert body == {"next": "x = 3", "done": False, "why": "Divide both sides by 2.", "cached": False, "mock": True}


def test_next_reports_a_finished_derivation(client, token):
    body = post(client, token, "next", {"steps": ["x = 3", "__done__"]}).json()
    assert body["done"] is True and body["next"] is None


def test_next_reads_the_model_answer(client, token, monkeypatch):
    go_live(monkeypatch)
    scripted(monkeypatch, "NEXT: $x = 3$\nWHY: Divide by 2.")
    body = post(client, token, "next", {"steps": ["2x = 6"]}).json()
    assert body["next"] == "x = 3" and body["done"] is False


def test_next_with_an_unreadable_answer_is_an_error(client, token, monkeypatch):
    go_live(monkeypatch)
    scripted(monkeypatch, "")
    assert post(client, token, "next", {"steps": ["2x = 6"]}).status_code == 502


# --- they all share the same quota protection ---------------------------------

def test_every_feature_counts_against_the_same_limits(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "3")
    scripted(monkeypatch, "VERDICT: OK\nWHY: fine\nLATEX: x\nNEXT: y")
    assert post(client, token, "latex", {"text": "a"}).status_code == 200
    assert post(client, token, "fix", {"latex": "b"}).status_code == 200
    assert post(client, token, "check", {"steps": ["c"]}).status_code == 200
    assert post(client, token, "next", {"steps": ["d"]}).status_code == 429
    assert usage.used_today() == 3


def test_identical_requests_are_cached_for_each_feature(client, token, monkeypatch):
    go_live(monkeypatch)
    prompts = scripted(monkeypatch, "VERDICT: OK\nWHY: fine\nLATEX: x\nNEXT: y")
    for path, body in (("fix", {"latex": "a"}), ("check", {"steps": ["a"]}), ("next", {"steps": ["a"]})):
        first = post(client, token, path, body).json()
        again = post(client, token, path, body).json()
        assert first["cached"] is False and again["cached"] is True
    assert len(prompts) == 3 and usage.used_today() == 3


def test_a_google_429_is_busy_for_the_new_features_too(client, token, monkeypatch):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiBusy(12))
    for path, body in (("fix", {"latex": "a"}), ("check", {"steps": ["a"]}), ("next", {"steps": ["a"]})):
        resp = post(client, token, path, body)
        assert resp.status_code == 429 and resp.headers["retry-after"]


def test_busy_trigger_works_in_mock_mode_for_the_new_features(client, token):
    assert post(client, token, "fix", {"latex": "__busy__"}).status_code == 429
    assert post(client, token, "check", {"steps": ["__busy__"]}).status_code == 429
    assert post(client, token, "next", {"steps": ["__busy__"]}).status_code == 429


def test_status_lists_the_new_features(client, token):
    assert post(client, token, "fix", {"latex": "x"}).status_code == 200
    resp = client.get("/sidekick/status", headers=auth(token))
    assert {"latex", "explain", "fix", "check", "next"} <= set(resp.json()["features"])


def test_the_key_never_appears_in_the_new_responses(client, token, monkeypatch, capsys):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiError("HTTP 403"))
    texts = [
        post(client, token, "fix", {"latex": "a"}).text,
        post(client, token, "check", {"steps": ["a"]}).text,
        post(client, token, "next", {"steps": ["a"]}).text,
    ]
    out = capsys.readouterr()
    assert SECRET not in "".join(texts) and SECRET not in out.out and SECRET not in out.err
