from google.cloud import firestore

##################for local dev - create the Firestore client lazily once and reuse it - avoid redo credential
from functools import lru_cache

@lru_cache(maxsize=1)
def get_db():
    return firestore.Client()
##################

# db = firestore.Client()

def save_feedback(text: str, useful: bool) -> None:
    # db.collection("feedback").add({
    get_db().collection("feedback").add({
        "text": text,
        "useful": useful,
        "created_at": firestore.SERVER_TIMESTAMP,
    })

