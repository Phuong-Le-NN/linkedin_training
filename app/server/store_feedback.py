import hashlib
import unicodedata

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

MAX_FEEDBACK_POSTS = 3_000


def post_id(text: str) -> str:
    normalized = unicodedata.normalize("NFC", " ".join(text.split()))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def save_feedback(text: str, useful: bool, user_id: str) -> None:
    db = firestore.Client()
    feedback = db.collection("feedback")
    document = feedback.document(post_id(user_id + "\0" + text))
    usage = db.collection("feedback_usage").document(
        hashlib.sha256(user_id.encode("utf-8")).hexdigest()
    )
    data = {
        "user_id": user_id,
        "text": text,
        "useful": useful,
        "updated_at": firestore.SERVER_TIMESTAMP,
    }

    @firestore.transactional
    def save(transaction):
        existing = document.get(transaction=transaction)
        saved_data = dict(data)
        if not existing.exists:
            user_feedback = feedback.where(filter=FieldFilter("user_id", "==", user_id))
            snapshot = usage.get(transaction=transaction)
            # Initialize from existing records so earlier feedback counts too.
            count = snapshot.get("count") if snapshot.exists else (
                user_feedback.count().get(transaction=transaction)[0][0].value
            )
            expired = []
            if count >= MAX_FEEDBACK_POSTS:
                expired = list(
                    user_feedback.order_by("created_at")
                    .limit(count - MAX_FEEDBACK_POSTS + 1)
                    .stream(transaction=transaction)
                )
            # Complete every read before queuing writes in the transaction.
            for oldest in expired:
                transaction.delete(oldest.reference)
            transaction.set(usage, {
                "user_id": user_id,
                "count": count + 1 - len(expired),
            })
            saved_data["created_at"] = firestore.SERVER_TIMESTAMP
        # Relabeling preserves created_at and does not change eviction order.
        transaction.set(document, saved_data, merge=True)

    save(db.transaction())


def count_feedback(user_id: str) -> int:
    result = (
        firestore.Client().collection("feedback")
        .where(filter=FieldFilter("user_id", "==", user_id))
        .count().get()
    )
    return result[0][0].value
