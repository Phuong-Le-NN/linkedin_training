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
from app.server.auth import optional_firebase_user, verify_firebase_token


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
        "load_effective_model",
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
    api.app.dependency_overrides[optional_firebase_user] = (
        lambda: {"uid": "test-user"}
    )
    with TestClient(api.app) as test_client:
        yield test_client
    api.app.dependency_overrides.clear()


def test_personal_model_cache_refreshes_only_changed_user(model_objects):
    first_blob = publish_bundle(model_objects, "models/user-a/model.bundle.zip", "first")
    other_blob = publish_bundle(model_objects, "models/user-b/model.bundle.zip", "other")
    first = classifier.load_effective_model("user-a")
    other = classifier.load_effective_model("user-b")
    assert classifier.load_effective_model("user-a") is first

    first_blob.generation = 2
    assert classifier.load_effective_model("user-a") is not first
    assert classifier.load_effective_model("user-b") is other
    assert first_blob.download_as_bytes.call_count == 2
    other_blob.download_as_bytes.assert_called_once()


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

    first = classifier.load_effective_model("bundled-user")
    assert first[0][0] == b"bundled-model"
    assert first[1]["bundled"] == 2
    assert classifier.load_effective_model("bundled-user") is first

    bundle_blob.generation = 2
    second = classifier.load_effective_model("bundled-user")
    assert second is not first
    assert second[0][0] == b"bundled-model"
    assert bundle_blob.download_as_bytes.call_count == 2
    classifier._load_bundle_model.cache_clear()


@pytest.fixture
def model_objects(monkeypatch):
    blobs = {}

    def blob(path):
        if path not in blobs:
            blobs[path] = MagicMock(generation=1)
            blobs[path].reload.side_effect = classifier.NotFound(path)
        return blobs[path]

    storage_client = MagicMock()
    storage_client.bucket.return_value.blob.side_effect = blob
    monkeypatch.setattr(classifier.storage, "Client", lambda: storage_client)
    monkeypatch.setattr(classifier, "Interpreter", lambda model_content: FakeInterpreter())
    classifier._load_bundle_model.cache_clear()
    yield blob
    classifier._load_bundle_model.cache_clear()


def publish_bundle(model_objects, path, word):
    bundle = BytesIO()
    with ZipFile(bundle, "w") as archive:
        archive.writestr("model.tflite", b"model")
        archive.writestr("tokenizer.json", json.dumps({"config": {
            "word_index": json.dumps({"<OOV>": 1, word: 2}),
            "oov_token": "<OOV>",
        }}))
    blob = model_objects(path)
    blob.reload.side_effect = None
    blob.download_as_bytes.return_value = bundle.getvalue()
    return blob


def test_shared_fallback_is_cached_and_personal_model_takes_priority(model_objects):
    shared_blob = publish_bundle(model_objects, "models/global/v1/model.bundle.zip", "shared")

    first = classifier.load_effective_model("user-a")
    assert "shared" in first[1]
    assert classifier.load_effective_model("user-b") is first
    shared_blob.download_as_bytes.assert_called_once()

    shared_blob.generation = 2
    updated_shared = classifier.load_effective_model("user-b")
    assert updated_shared is not first
    assert shared_blob.download_as_bytes.call_count == 2

    publish_bundle(model_objects, "models/user-a/model.bundle.zip", "personal")
    personal = classifier.load_effective_model("user-a")
    assert "personal" in personal[1]
    assert "shared" not in personal[1]
    assert classifier.load_effective_model("user-b") is updated_shared


def test_no_personal_or_shared_model_returns_404(model_objects):
    with pytest.raises(HTTPException) as error:
        classifier.load_effective_model("new-user")

    assert error.value.status_code == 404
    assert error.value.detail == "No trained model is available"


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


@pytest.mark.parametrize("text", ["A useful LinkedIn post", "a", "你好"])
def test_feedback_endpoint_saves_to_firestore(client, monkeypatch, text):
    save = MagicMock()
    monkeypatch.setattr(api, "save_feedback", save)
    response = client.post("/feedback", json={"text": text, "useful": True})
    assert response.status_code == 201
    assert response.json() == {"saved": True}
    save.assert_called_once_with(text, True, "test-user")


@pytest.mark.parametrize("text", ["", " \n\t", "🔥🔥🔥", "...!?"])
def test_feedback_without_words_is_not_saved(client, monkeypatch, text):
    save = MagicMock()
    monkeypatch.setattr(api, "save_feedback", save)

    response = client.post("/feedback", json={"text": text, "useful": True})

    assert response.status_code == 400
    assert "at least one word" in response.json()["detail"]
    save.assert_not_called()


@pytest.mark.parametrize("path, key", [
    ("/classify", "text"), ("/classify-batch", "texts"), ("/feedback", "text"),
])
@pytest.mark.parametrize("extra_character, expected_status", [(False, 200), (True, 422)])
def test_text_length_boundary(client, monkeypatch, path, key, extra_character, expected_status):
    save = MagicMock()
    monkeypatch.setattr(api, "save_feedback", save)
    text = "x" * (api.MAX_POST_CHARACTERS + extra_character)
    payload = {key: [text] if key == "texts" else text}
    if path == "/feedback":
        payload["useful"] = True
        if expected_status == 200:
            expected_status = 201
    response = client.post(path, json=payload)
    assert response.status_code == expected_status
    if extra_character:
        save.assert_not_called()


def test_signed_out_model_selection_uses_only_the_shared_model(model_objects):
    shared = publish_bundle(model_objects, "models/global/v1/model.bundle.zip", "shared")
    assert "shared" in classifier.load_effective_model(None)[1]
    shared.download_as_bytes.assert_called_once()
    bucket = classifier.storage.Client().bucket.return_value
    assert [call.args[0] for call in bucket.blob.call_args_list] == [
        "models/global/v1/model.bundle.zip",
        "models/global/v1/model.bundle.zip",
    ]


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

    assert response.json() == {"count": 3, "limit": 3000}
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
