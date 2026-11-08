import pytest

from tests.test_docs_permissions import auth, signup


@pytest.fixture()
def token(client):
    _, token = signup(client, "writer", "writer@example.com")
    return token


def fetch(client, token, doc_id):
    return client.get(f"/docs/{doc_id}", headers=auth(token)).json()


def test_a_new_document_is_blank_and_untitled(client, token):
    doc_id = client.post("/docs/new", json={}, headers=auth(token)).json()["doc_id"]

    doc = fetch(client, token, doc_id)
    assert doc["title"] == "Untitled"
    assert [block["content"] for block in doc["blocks"]] == [""]


@pytest.mark.parametrize("old_client_body", [
    {"template": "Homework Template", "title": "Homework Template"},
    {"template": "Math Notes"},
    {"template": "Blank Document", "title": "Untitled Document"},
])
def test_a_client_that_still_asks_for_a_template_gets_a_blank_document(client, token, old_client_body):
    # The starter documents are gone. An older page that still sends a template name must not fail, and must not get content.
    resp = client.post("/docs/new", json=old_client_body, headers=auth(token))
    assert resp.status_code == 200

    doc = fetch(client, token, resp.json()["doc_id"])
    assert doc["title"] == "Untitled"
    assert [block["content"] for block in doc["blocks"]] == [""]
