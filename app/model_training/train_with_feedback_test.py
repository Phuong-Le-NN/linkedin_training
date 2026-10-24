from io import BytesIO
from types import SimpleNamespace
from zipfile import ZipFile
from unittest.mock import MagicMock

from app.model_training import train_with_feedback


def test_train_with_one_post(monkeypatch):
    posts = [{"text": "A useful post about Python", "useful": True}]
    db = MagicMock()
    db.collection.return_value.where.return_value.limit.return_value.stream.return_value = [
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
