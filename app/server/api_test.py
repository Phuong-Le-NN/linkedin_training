import json
import threading
from io import BytesIO
from zipfile import ZipFile
from unittest.mock import MagicMock

import numpy as np
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.server import api, classifier, store_feedback
from app.server.auth import verify_firebase_token


class FakeInterpreter:
    def __init__(self):
        self.shape = None
        self.input = None

    def get_input_details(self):
        return [{"index": 0, "dtype": np.float32}]

    def resize_tensor_input(self, index, shape, strict=False):
        self.shape = tuple(shape)

    def allocate_tensors(self):
        pass

    def set_tensor(self, index, value):
        self.input = value

    def invoke(self):
        pass

    def get_output_details(self):
        return [{"index": 1}]

    def get_tensor(self, index):
        return np.array([[0.8], [0.2]], dtype=np.float32)[: self.shape[0]]


@pytest.fixture
def fake_interpreter(monkeypatch):
    fake = FakeInterpreter()
    monkeypatch.setattr(
        classifier,
        "load_user_model",
        lambda _user_id: (fake, {"this": 2, "is": 3, "useful": 4}, 1),
    )
    monkeypatch.setattr(
        classifier, "classification_slots", threading.Semaphore(1)
    )
    return fake


@pytest.fixture
def client(fake_interpreter):
    api.app.dependency_overrides[verify_firebase_token] = (
        lambda: {"uid": "test-user"}
    )
    with TestClient(api.app) as test_client:
        yield test_client
    api.app.dependency_overrides.clear()


def test_user_model_cache_refreshes_only_changed_user(monkeypatch):
    fake_bucket = MagicMock()
    blobs = {}
    tokenizer = {
        "config": {
            "word_index": json.dumps({"<OOV>": 1}),
            "oov_token": "<OOV>",
        }
    }

    def blob(name):
        if name not in blobs:
            result = MagicMock()
            result.generation = 1
            if name.endswith("model.bundle.zip"):
                result.reload.side_effect = classifier.NotFound("No bundle")
            result.download_as_bytes.return_value = (
                b"model" if name.endswith("model.tflite") else json.dumps(tokenizer).encode()
            )
            blobs[name] = result
        return blobs[name]

    fake_bucket.blob.side_effect = blob
    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket
    monkeypatch.setattr(classifier.storage, "Client", lambda: fake_client)
    monkeypatch.setattr(classifier, "Interpreter", lambda model_content: FakeInterpreter())
    classifier._load_user_model.cache_clear()

    first = classifier.load_user_model("user-a")
    other = classifier.load_user_model("user-b")
    assert classifier.load_user_model("user-a")[0] is first[0]

    blobs["models/user-a/model.tflite"].generation = 2
    assert classifier.load_user_model("user-a")[0] is not first[0]
    assert classifier.load_user_model("user-b")[0] is other[0]
    assert blobs["models/user-a/model.tflite"].download_as_bytes.call_count == 2
    assert blobs["models/user-b/model.tflite"].download_as_bytes.call_count == 1
    classifier._load_user_model.cache_clear()


def test_bundle_model_loads_as_one_version(monkeypatch):
    bundle = BytesIO()
    with ZipFile(bundle, "w") as archive:
        archive.writestr("model.tflite", b"bundled-model")
        archive.writestr("tokenizer.json", json.dumps({
            "config": {
                "word_index": json.dumps({"<OOV>": 1, "bundled": 2}),
                "oov_token": "<OOV>",
            },
        }))

    bundle_blob = MagicMock(generation=1)
    bundle_blob.download_as_bytes.return_value = bundle.getvalue()
    bucket = MagicMock()
    bucket.blob.return_value = bundle_blob
    storage_client = MagicMock()
    storage_client.bucket.return_value = bucket
    monkeypatch.setattr(classifier.storage, "Client", lambda: storage_client)
    interpreter = MagicMock()
    monkeypatch.setattr(
        classifier, "Interpreter",
        lambda model_content: (model_content, interpreter),
    )
    classifier._load_bundle_model.cache_clear()

    first = classifier.load_user_model("bundled-user")
    assert first[0][0] == b"bundled-model"
    assert first[1]["bundled"] == 2
    assert classifier.load_user_model("bundled-user") is first

    bundle_blob.generation = 2
    second = classifier.load_user_model("bundled-user")
    assert second is not first
    assert second[0][0] == b"bundled-model"
    assert bundle_blob.download_as_bytes.call_count == 2
    classifier._load_bundle_model.cache_clear()


def test_classify_returns_429_when_busy(fake_interpreter):
    slot = classifier.classification_slots
    slot.acquire()

    try:
        with pytest.raises(HTTPException) as exc:
            classifier.classify_with_limit(["A post"], "test-user")
        assert exc.value.status_code == 429
    finally:
        slot.release()


def test_classify_releases_slot_after_failure(fake_interpreter, monkeypatch):
    def fail(_texts, _user_id):
        raise RuntimeError("model failed")

    monkeypatch.setattr(classifier, "classify", fail)

    with pytest.raises(RuntimeError, match="model failed"):
        classifier.classify_with_limit(["A post"], "test-user")

    assert classifier.classification_slots.acquire(blocking=False)
    classifier.classification_slots.release()


def test_single_classify_endpoint(client):
    response = client.post("/classify", json={"text": "This is useful"})

    assert response.status_code == 200
    assert response.json()["label"] == "useful"
    assert response.json()["useful_probability"] == pytest.approx(0.8)


def test_batch_classify_endpoint(client):
    response = client.post(
        "/classify-batch", json={"texts": ["Useful", "Useless"]}
    )

    assert response.status_code == 200
    assert [item["label"] for item in response.json()] == [
        "useful", "useless"
    ]


def test_batch_endpoint_rejects_more_than_100_posts(client):
    response = client.post(
        "/classify-batch", json={"texts": ["post"] * 101}
    )

    assert response.status_code == 413


def test_feedback_endpoint_saves_to_firestore(client, monkeypatch):
    fake_db = MagicMock()
    monkeypatch.setattr(store_feedback.firestore, "Client", lambda: fake_db)
    text = "A useful LinkedIn post"

    response = client.post(
        "/feedback", json={"text": text, "useful": True}
    )

    assert response.status_code == 201
    assert response.json() == {"saved": True}
    fake_db.collection.assert_called_once_with("feedback")
    fake_db.collection.return_value.document.assert_called_once_with(
        store_feedback.post_id("test-user\0" + text)
    )

    saved_data = (
        fake_db.collection.return_value.document.return_value.set.call_args
    )
    assert saved_data.args[0]["text"] == text
    assert saved_data.args[0]["useful"] is True
    assert saved_data.args[0]["user_id"] == "test-user"


def test_post_id_normalizes_whitespace():
    assert store_feedback.post_id(
        "Same  post\ncontent"
    ) == store_feedback.post_id("Same post content")


def test_feedback_count_uses_authenticated_user(client, monkeypatch):
    fake_db = MagicMock()
    fake_db.collection.return_value.where.return_value.count.return_value.get.return_value = [
        [MagicMock(value=3)]
    ]
    monkeypatch.setattr(store_feedback.firestore, "Client", lambda: fake_db)

    response = client.get("/feedback/count?user_id=another-user")

    assert response.json() == {"count": 3}
    field_filter = fake_db.collection.return_value.where.call_args.kwargs["filter"]
    assert field_filter.value == "test-user"


def test_train_submits_only_authenticated_user(client, monkeypatch):
    submit = MagicMock(return_value={
        "status": "submitted",
        "build_id": "build-123",
        "log_url": "https://console.cloud.google.com/cloud-build/builds/build-123",
        "operation_name": "operations/op-123",
    })
    monkeypatch.setattr(api, "submit_training", submit)

    response = client.post(
        "/train?user_id=another-user", json={"user_id": "another-user"}
    )

    assert response.status_code == 202
    assert response.json()["build_id"] == "build-123"
    submit.assert_called_once_with("test-user")


def test_train_preserves_submission_error(client, monkeypatch):
    submit = MagicMock(side_effect=HTTPException(
        status_code=503, detail="Training is not configured."
    ))
    monkeypatch.setattr(api, "submit_training", submit)

    response = client.post("/train")

    assert response.status_code == 503
    assert response.json() == {"detail": "Training is not configured."}
