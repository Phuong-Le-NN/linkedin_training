from unittest.mock import MagicMock

import pytest
from firebase_admin import auth as firebase_auth
from fastapi.testclient import TestClient

from app.server import api
from app.server import auth as server_auth


client = TestClient(api.app)


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("POST", "/feedback", {"text": "post", "useful": True}),
        ("GET", "/feedback/count", None),
        ("POST", "/train", None),
    ],
)
def test_routes_require_a_bearer_token(method, path, body):
    response = client.request(method, path, json=body)

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "path, body",
    [("/classify", {"text": "post"}), ("/classify-batch", {"texts": ["post"]})],
)
def test_signed_out_users_can_classify_with_the_shared_model(monkeypatch, path, body):
    classify = MagicMock(return_value=[{"label": "useful"}])
    monkeypatch.setattr(api, "classify_with_limit", classify)

    response = client.post(f"{path}?user_id=someone-else", json=body)

    assert response.status_code == 200
    classify.assert_called_once_with(["post"], None)


@pytest.mark.parametrize("path", ["/classify", "/classify-batch"])
def test_invalid_token_is_rejected(monkeypatch, path):
    def reject_token(token, app):
        raise firebase_auth.InvalidIdTokenError("invalid token")

    monkeypatch.setattr(server_auth.firebase_auth, "verify_id_token", reject_token)
    response = client.post(
        path,
        headers={"Authorization": "Bearer bad-token"},
        json={"texts": ["post"]} if path == "/classify-batch" else {"text": "post"},
    )

    assert response.status_code == 401


def test_valid_token_reaches_endpoint(monkeypatch):
    def accept_token(token, app):
        assert token == "valid-token"
        assert app is server_auth.firebase_app
        return {"uid": "user-1"}

    monkeypatch.setattr(server_auth.firebase_auth, "verify_id_token", accept_token)
    def classify_for_user(texts, user_id):
        assert user_id == "user-1"
        return [{"label": "useful"}]

    monkeypatch.setattr(api, "classify_with_limit", classify_for_user)
    response = client.post(
        "/classify",
        headers={"Authorization": "Bearer valid-token"},
        json={"text": "post"},
    )

    assert response.status_code == 200
    assert response.json() == {"label": "useful"}
