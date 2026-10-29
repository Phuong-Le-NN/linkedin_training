from io import BytesIO
from types import SimpleNamespace
from zipfile import ZipFile
from unittest.mock import MagicMock

from app.model_training import train_with_feedback


def test_loads_all_feedback_including_records_beyond_old_cutoff(monkeypatch):
    db = MagicMock()
    posts = [{"text": f"Post {index}", "useful": bool(index % 2)} for index in range(2001)]
    db.collection.return_value.where.return_value.stream.return_value = [
        SimpleNamespace(to_dict=lambda post=post: post) for post in posts
    ]
    monkeypatch.setattr(train_with_feedback.firestore, "Client", lambda: db)
    assert train_with_feedback.load_feedback("test-user") == posts
    field_filter = db.collection.return_value.where.call_args.kwargs["filter"]
    assert field_filter.value == "test-user"


def test_train_with_one_post(monkeypatch):
    posts = [{"text": "A useful post about Python", "useful": True}]
    db = MagicMock()
    db.collection.return_value.where.return_value.stream.return_value = [
        SimpleNamespace(to_dict=lambda post=post: post) for post in posts
    ]
    bucket = MagicMock()
    monkeypatch.setattr(train_with_feedback.firestore, "Client", lambda: db)
    monkeypatch.setattr(
        train_with_feedback.storage, "Client", lambda: SimpleNamespace(bucket=lambda _: bucket)
    )
    monkeypatch.setenv("USER_ID", "test-user")
    monkeypatch.setenv("MODEL_BUCKET", "test-bucket")

    train_with_feedback.main()

    bucket.blob.assert_called_once_with("models/test-user/model.bundle.zip")
    upload = bucket.blob.return_value.upload_from_string
    upload.assert_called_once()
    assert upload.call_args.kwargs["content_type"] == "application/zip"
    with ZipFile(BytesIO(upload.call_args.args[0])) as archive:
        assert set(archive.namelist()) == {"model.tflite", "tokenizer.json"}
        assert archive.read("model.tflite")
        assert archive.read("tokenizer.json")
