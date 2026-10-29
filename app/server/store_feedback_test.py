from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from google.api_core.exceptions import Aborted

from app.server import store_feedback


@pytest.fixture
def database(monkeypatch):
    db = MagicMock()
    feedback, usage = MagicMock(), MagicMock()
    db.collection.side_effect = {"feedback": feedback, "feedback_usage": usage}.__getitem__
    document = feedback.document.return_value
    document.get.return_value.exists = False
    usage.document.return_value.get.return_value.exists = False
    count = feedback.where.return_value.count.return_value.get
    count.return_value = [[SimpleNamespace(value=2999)]]
    oldest = feedback.where.return_value.order_by.return_value.limit.return_value.stream
    oldest.return_value = [SimpleNamespace(reference=MagicMock(name="oldest-feedback"))]
    transaction = db.transaction.return_value
    transaction._max_attempts = 3
    transaction._read_only = False
    monkeypatch.setattr(store_feedback.firestore, "Client", lambda: db)
    return SimpleNamespace(
        db=db, feedback=feedback, usage=usage, document=document,
        count=count, oldest=oldest, transaction=transaction,
    )


def test_last_available_slot_counts_existing_feedback_and_commits_atomically(database):
    store_feedback.save_feedback("A useful post", True, "user-a")
    writes = database.transaction.set.call_args_list
    assert writes[0].args == (
        database.usage.document.return_value, {"user_id": "user-a", "count": 3000},
    )
    assert writes[1].args[0] is database.document
    assert writes[1].args[1]["text"] == "A useful post"
    assert writes[1].args[1]["useful"] is True
    assert writes[1].args[1]["user_id"] == "user-a"
    assert database.feedback.where.call_args.kwargs["filter"].value == "user-a"
    database.count.assert_called_once_with(transaction=database.transaction)
    database.transaction._commit.assert_called_once()
    database.transaction.delete.assert_not_called()


@pytest.mark.parametrize("existing_count", [3000, 3001])
def test_new_posts_replace_oldest_feedback_at_or_above_limit(database, existing_count):
    database.count.return_value = [[SimpleNamespace(value=existing_count)]]
    expired = [SimpleNamespace(reference=MagicMock()) for _ in range(existing_count - 2999)]
    database.oldest.return_value = expired

    store_feedback.save_feedback("New post", False, "user-a")

    query = database.feedback.where.return_value
    assert database.feedback.where.call_args.kwargs["filter"].value == "user-a"
    query.order_by.assert_called_once_with("created_at")
    query.order_by.return_value.limit.assert_called_once_with(len(expired))
    database.oldest.assert_called_once_with(transaction=database.transaction)
    assert [call.args[0] for call in database.transaction.delete.call_args_list] == [
        post.reference for post in expired
    ]
    writes = database.transaction.set.call_args_list
    assert writes[0].args[1] == {"user_id": "user-a", "count": 3000}
    assert writes[1].args[0] is database.document
    assert writes[1].args[1]["text"] == "New post"
    assert writes[1].args[1]["created_at"] is store_feedback.firestore.SERVER_TIMESTAMP
    database.transaction._commit.assert_called_once()


def test_relabeling_saved_post_does_not_use_another_slot(database):
    database.document.get.return_value.exists = True
    store_feedback.save_feedback("Saved post", False, "user-a")
    database.count.assert_not_called()
    database.usage.document.return_value.get.assert_not_called()
    database.transaction.set.assert_called_once()
    assert database.transaction.set.call_args.args[1]["useful"] is False
    assert "created_at" not in database.transaction.set.call_args.args[1]
    assert database.transaction.set.call_args.kwargs == {"merge": True}
    database.transaction.delete.assert_not_called()


def test_initialized_usage_counter_avoids_recounting(database):
    snapshot = database.usage.document.return_value.get.return_value
    snapshot.exists = True
    snapshot.get.return_value = 3
    store_feedback.save_feedback("New post", True, "user-a")
    database.count.assert_not_called()
    assert database.transaction.set.call_args_list[0].args[1]["count"] == 4


def test_conflicting_last_slot_is_rechecked_on_transaction_retry(database):
    snapshot = database.usage.document.return_value.get.return_value
    snapshot.exists = True
    snapshot.get.side_effect = [2999, 3000]
    database.transaction._commit.side_effect = [Aborted("Another request used the last slot"), None]
    store_feedback.save_feedback("New post", True, "user-a")
    assert snapshot.get.call_count == 2
    assert database.transaction._commit.call_count == 2
    database.transaction.delete.assert_called_once_with(database.oldest.return_value[0].reference)
    assert database.transaction.set.call_args_list[-2].args[1]["count"] == 3000


def test_accounts_use_different_feedback_and_quota_documents(database):
    store_feedback.save_feedback("Same post", True, "user-a")
    store_feedback.save_feedback("Same post", True, "user-b")
    feedback_ids = [call.args[0] for call in database.feedback.document.call_args_list]
    usage_ids = [call.args[0] for call in database.usage.document.call_args_list]
    assert feedback_ids[0] != feedback_ids[1]
    assert usage_ids[0] != usage_ids[1]
