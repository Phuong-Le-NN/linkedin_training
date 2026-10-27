import csv
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

import api, classifier, store_feedback


class FakeTokenizer:
    def texts_to_sequences(self, texts):
        return [[1] for _ in texts]


class FakeModel:
    def __call__(self, x, training=False):
        # First post useful, second post useless
        return FakePrediction([0.8, 0.2][:len(x)])


class FakePrediction:
    def __init__(self, values):
        self.values = values

    def numpy(self):
        return np.array(self.values)


@pytest.fixture(autouse=True)
def reset_server_state(monkeypatch):
    """
    Replace the real model and reset the semaphore before every test.
    """
    monkeypatch.setattr(api, "tokenizer", FakeTokenizer())
    monkeypatch.setattr(api, "model", FakeModel())

    api.classification_slots = threading.Semaphore(
        api.MAX_CONCURRENT_CLASSIFICATIONS
    )


def test_classify_single_post():
    result = classifier.classify(["This is a useful post"])

    assert len(result) == 1
    assert result[0]["label"] == "useful"
    assert result[0]["useful_probability"] == 0.8


def test_classify_batch():
    result = classifier.classify([
        "This is useful",
        "This is useless",
    ])

    assert len(result) == 2

    assert result[0]["label"] == "useful"
    assert result[0]["useful_probability"] == 0.8

    assert result[1]["label"] == "useless"
    assert result[1]["useful_probability"] == 0.2


def test_classify_with_limit():
    result = classifier.classify_with_limit(["A post"])

    assert len(result) == 1
    assert result[0]["label"] == "useful"


def test_single_classify_endpoint():
    client = TestClient(api.app)

    response = client.post(
        "/classify",
        json={"text": "This is a useful post"},
    )

    assert response.status_code == 200
    assert response.json()["label"] == "useful"
    assert response.json()["useful_probability"] == 0.8


def test_batch_classify_endpoint():
    client = TestClient(api.app)

    response = client.post(
        "/classify-batch",
        json={
            "texts": [
                "This is useful",
                "This is useless",
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == [
        {
            "label": "useful",
            "useful_probability": 0.8,
        },
        {
            "label": "useless",
            "useful_probability": 0.2,
        },
    ]


def test_batch_endpoint_rejects_more_than_100_posts():
    client = TestClient(api.app)

    response = client.post(
        "/classify-batch",
        json={"texts": ["post"] * 101},
    )

    assert response.status_code == 413


def test_classify_returns_429_when_all_slots_are_busy():
    api.classification_slots = threading.Semaphore(1)

    # Occupy the only available slot
    api.classification_slots.acquire()

    try:
        with pytest.raises(Exception) as error:
            classifier.classify_with_limit(["A post"])

        assert error.value.status_code == 429
    finally:
        api.classification_slots.release()


def test_classify_with_limit_releases_slot_after_success():
    api.classification_slots = threading.Semaphore(1)

    classifier.classify_with_limit(["A post"])

    # If the slot was released, another request can acquire it
    acquired = api.classification_slots.acquire(timeout=0.1)

    assert acquired is True

    api.classification_slots.release()


def test_classify_with_limit_releases_slot_after_failure(monkeypatch):
    api.classification_slots = threading.Semaphore(1)

    def failing_classify(texts):
        raise RuntimeError("model failed")

    monkeypatch.setattr(api, "classify", failing_classify)

    with pytest.raises(RuntimeError):
        classifier.classify_with_limit(["A post"])

    # The slot must still be released after an exception
    acquired = api.classification_slots.acquire(timeout=0.1)

    assert acquired is True

    api.classification_slots.release()


def test_feedback_endpoint_appends_to_separate_training_file(tmp_path, monkeypatch):
    feedback_file = tmp_path / "feedback.csv"
    monkeypatch.setattr(store_feedback, "feedback_file", feedback_file)
    client = TestClient(api.app)

    useful_response = client.post(
        "/feedback", json={"text": "Useful, with a newline\ninside", "useful": True}
    )
    useless_response = client.post(
        "/feedback", json={"text": "Not useful", "useful": False}
    )

    assert useful_response.status_code == 201
    assert useful_response.json() == {"saved": True}
    assert useless_response.status_code == 201
    with feedback_file.open(newline="", encoding="utf-8") as file:
        assert list(csv.reader(file)) == [
            ["post_content", "useful"],
            ["Useful, with a newline\ninside", "True"],
            ["Not useful", "False"],
        ]
