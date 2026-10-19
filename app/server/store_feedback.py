import hashlib
import unicodedata

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter


def post_id(text: str) -> str:
    normalized = unicodedata.normalize("NFC", " ".join(text.split()))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def save_feedback(text: str, useful: bool, user_id: str) -> None:
    firestore.Client().collection("feedback").document(
        post_id(user_id + "\0" + text)
    ).set({
        "user_id": user_id,
        "text": text,
        "useful": useful,
        "created_at": firestore.SERVER_TIMESTAMP,
    })


def count_feedback(user_id: str) -> int:
    result = (
        firestore.Client().collection("feedback")
        .where(filter=FieldFilter("user_id", "==", user_id))
        .count().get()
    )
    return result[0][0].value
