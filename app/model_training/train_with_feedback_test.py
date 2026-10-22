from types import SimpleNamespace
from unittest.mock import MagicMock

from app.model_training import train_with_feedback


def test_train_with_three_posts(monkeypatch):
    posts = [
        {"text": "A useful post about Python", "useful": True},
        {"text": "Another useful engineering post", "useful": True},
        {"text": "A useless promotional post", "useful": False},
    ]
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

    names = [call.args[0] for call in bucket.blob.call_args_list]
    assert names == [
        "models/test-user/tokenizer.json",
        "models/test-user/model.tflite",
    ]
    assert bucket.blob.return_value.upload_from_string.call_count == 2
