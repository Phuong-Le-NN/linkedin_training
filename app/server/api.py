# api.py
import re
from pathlib import Path
from threading import Semaphore

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.text import tokenizer_from_json
from tensorflow.keras.utils import pad_sequences

MAX_CONCURRENT_CLASSIFICATIONS = 4
classification_slots = Semaphore(MAX_CONCURRENT_CLASSIFICATIONS)

folder = Path(__file__).resolve().parents[2] / "cnn" / "model_exports"
model = load_model(folder / "linkedin_posts_classifier.keras")
tokenizer = tokenizer_from_json((folder / "tokenizer.json").read_text())
app = FastAPI()


class Post(BaseModel):
    text: str


class Posts(BaseModel):
    texts: list[str]


def classify(texts):
    cleaned = [" ".join(re.findall(r"\b\w+\b", text.lower())) for text in texts]
    sequences = tokenizer.texts_to_sequences(cleaned)
    x = pad_sequences(sequences, maxlen=350, padding="post", truncating="post")
    probabilities = model(x, training=False).numpy().ravel()

    return [
        {
            "label": "useful" if p >= 0.5 else "useless",
            "useful_probability": float(p),
        }
        for p in probabilities
    ]

def classify_with_limit(texts):
    acquired = classification_slots.acquire(timeout=0.1)
    print("tried lock acquired")

    if not acquired:
        print("concurrency exceeded")
        raise HTTPException(
            status_code=429,
            detail="Classification service is busy. Please retry shortly.",
            headers={"Retry-After": "1"},
        )

    try:
        return classify(texts)
    finally:
        classification_slots.release()

@app.post("/classify")
def classify_one(post: Post):
    return classify_with_limit([post.text])[0]


@app.post("/classify-batch")
def classify_many(posts: Posts):
    if len(posts.texts) > 100:
        raise HTTPException(
            status_code=413,
            detail="Batch cannot contain more than 100 posts.",
        )

    return classify_with_limit(posts.texts)
