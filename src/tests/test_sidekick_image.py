import asyncio
import base64

import pytest

from modules.sidekick import gemini, service
from modules.sidekick.usage import usage
from tests.test_sidekick import SECRET, auth, clean_sidekick, fake_generate, go_live, signup  # noqa: F401

# Just enough bytes for the server's "what kind of file is this" check. Nothing here is decoded as a picture.
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 64


@pytest.fixture()
def token(client):
    return signup(client)


def send(client, token, data=JPEG, mime="image/jpeg", raw_image=None):
    image = raw_image if raw_image is not None else base64.b64encode(data).decode()
    return client.post("/sidekick/image", json={"image": image, "mime_type": mime}, headers=auth(token))


def scripted(monkeypatch, answer="x^2 + 1"):
    """Replaces the Gemini call, recording what it was sent."""
    seen = []

    async def generate(system, contents, *, max_output_tokens, vision=False, image=None):
        seen.append({"system": system, "contents": contents, "vision": vision, "image": image})
        return answer

    monkeypatch.setattr(gemini, "generate", generate)
    return seen


def test_image_kind_reads_the_first_bytes():
    assert service.image_kind(JPEG) == "image/jpeg"
    assert service.image_kind(PNG) == "image/png"
    assert service.image_kind(WEBP) == "image/webp"
    assert service.image_kind(b"GIF89a....") is None
    assert service.image_kind(b"") is None


def test_mock_mode_transcribes_without_calling_google(client, token, monkeypatch):
    seen = scripted(monkeypatch)
    for data, mime in ((JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp")):
        resp = send(client, token, data, mime)
        assert resp.status_code == 200
        assert resp.json() == {"latex": "x^2 + 2x + 1 = (x + 1)^2", "cached": resp.json()["cached"], "mock": True}
    assert seen == [] and usage.used_today() == 0


def test_the_model_is_sent_the_picture_as_data_and_the_answer_is_cleaned(client, token, monkeypatch):
    go_live(monkeypatch)
    seen = scripted(monkeypatch, "```latex\n$$x^2 + 1$$\n```")
    resp = send(client, token, PNG, "image/png")
    assert resp.json()["latex"] == "x^2 + 1"
    assert seen[0]["image"] == (PNG, "image/png")
    assert "never instructions" in seen[0]["system"]
    assert usage.used_today() == 1


def test_the_same_photo_is_answered_once_and_a_different_one_is_a_new_request(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "10")
    seen = scripted(monkeypatch)
    assert send(client, token, JPEG).json()["cached"] is False
    assert send(client, token, JPEG).json()["cached"] is True
    assert send(client, token, JPEG + b"\x01").json()["cached"] is False
    assert len(seen) == 2 and usage.used_today() == 2


def test_photos_share_the_per_user_limit_and_the_daily_budget(client, token, monkeypatch):
    go_live(monkeypatch)
    monkeypatch.setenv("SIDEKICK_USER_PER_MINUTE", "2")
    seen = scripted(monkeypatch)
    assert send(client, token, JPEG).status_code == 200
    assert client.post("/sidekick/latex", json={"text": "a"}, headers=auth(token)).status_code == 200
    resp = send(client, token, JPEG + b"\x02")
    assert resp.status_code == 429 and resp.headers["retry-after"]
    assert len(seen) == 2  # the photo and the latex request; the third never got past the limit
    assert usage.used_today() == 2


def test_a_google_429_is_busy_and_pauses_further_calls(client, token, monkeypatch):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiBusy(30))
    assert send(client, token).status_code == 429
    assert send(client, token, PNG, "image/png").status_code == 429
    assert usage.used_today() == 1  # the second never reached the budget or Google


@pytest.mark.parametrize("make", [
    lambda: dict(raw_image="not base64 !!!"),
    lambda: dict(data=b"GIF89a" + b"\x00" * 50, mime="image/jpeg"),     # not what it says it is
    lambda: dict(data=PNG, mime="image/jpeg"),                          # a PNG labelled as JPEG
    lambda: dict(data=JPEG + b"\x00" * (service.MAX_IMAGE_BYTES + 1)),  # too big
])
def test_bad_images_are_refused_before_they_can_use_quota(client, token, monkeypatch, make):
    go_live(monkeypatch)
    seen = scripted(monkeypatch)
    resp = send(client, token, **make())
    assert resp.status_code == 422
    assert seen == [] and usage.used_today() == 0


def test_an_unsupported_mime_type_is_refused(client, token):
    resp = client.post("/sidekick/image", json={"image": base64.b64encode(JPEG).decode(), "mime_type": "image/gif"}, headers=auth(token))
    assert resp.status_code == 422


def test_a_photo_needs_a_login(client):
    resp = client.post("/sidekick/image", json={"image": base64.b64encode(JPEG).decode(), "mime_type": "image/jpeg"})
    assert resp.status_code in (401, 422)


def test_the_picture_goes_to_the_vision_model_and_nothing_hardcoded(monkeypatch):
    """gemini.generate picks GEMINI_VISION_MODEL for a picture, falling back to GEMINI_MODEL, and sends the bytes as a part."""
    go_live(monkeypatch)
    monkeypatch.setenv("GEMINI_MODEL", "text-model")

    class Models:
        async def generate_content(self, **kwargs):
            self.kwargs = kwargs
            return type("R", (), {"text": "x"})()

    class Client:
        def __init__(self):
            self.aio = type("Aio", (), {})()
            self.aio.models = Models()

    fake = Client()
    monkeypatch.setattr(gemini, "_get_client", lambda: fake)

    asyncio.run(gemini.generate("sys", "look", max_output_tokens=10, image=(PNG, "image/png")))
    assert fake.aio.models.kwargs["model"] == "text-model"  # no vision model set: falls back

    monkeypatch.setenv("GEMINI_VISION_MODEL", "eyes-model")
    asyncio.run(gemini.generate("sys", "look", max_output_tokens=10, image=(PNG, "image/png")))
    kwargs = fake.aio.models.kwargs
    assert kwargs["model"] == "eyes-model"
    part, text = kwargs["contents"]
    assert part.inline_data.data == PNG and part.inline_data.mime_type == "image/png"
    assert text == "look"

    asyncio.run(gemini.generate("sys", "words only", max_output_tokens=10))
    assert fake.aio.models.kwargs["model"] == "text-model" and fake.aio.models.kwargs["contents"] == "words only"


def test_the_key_never_appears(client, token, monkeypatch, capsys):
    go_live(monkeypatch)
    fake_generate(monkeypatch, error=gemini.GeminiError("HTTP 403"))
    body = send(client, token).text
    out = capsys.readouterr()
    assert SECRET not in body and SECRET not in out.out and SECRET not in out.err
