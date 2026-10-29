import re
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.server.classifier import classify_with_limit
from app.server.store_feedback import (
    MAX_FEEDBACK_POSTS,
    count_feedback,
    save_feedback,
)
from app.server.auth import optional_firebase_user, verify_firebase_token
from app.server.training import submit_training

app = FastAPI()
MAX_POST_CHARACTERS = 10_000
PostText = Annotated[str, Field(max_length=MAX_POST_CHARACTERS)]


class Post(BaseModel):
    text: PostText


class Posts(BaseModel):
    texts: list[PostText]


class Feedback(BaseModel):
    text: PostText
    useful: bool


@app.post("/classify")
def classify_one(post: Post, user: dict | None = Depends(optional_firebase_user)):
    return classify_with_limit([post.text], user["uid"] if user else None)[0]


@app.post("/classify-batch")
def classify_many(posts: Posts, user: dict | None = Depends(optional_firebase_user)):
    if len(posts.texts) > 100:
        raise HTTPException(
            status_code=413,
            detail="Batch cannot contain more than 100 posts.",
        )

    return classify_with_limit(posts.texts, user["uid"] if user else None)


@app.post("/feedback", status_code=201)
def submit_feedback(
    feedback: Feedback,
    user: dict = Depends(verify_firebase_token),
):
    if not re.search(r"\b\w+\b", feedback.text):
        raise HTTPException(
            status_code=400, detail="Feedback must contain at least one word."
        )
    save_feedback(feedback.text, feedback.useful, user["uid"])
    return {"saved": True}


@app.get("/feedback/count")
def feedback_count(user: dict = Depends(verify_firebase_token)):
    return {"count": count_feedback(user["uid"]), "limit": MAX_FEEDBACK_POSTS}


@app.post("/train", status_code=202)
def train_model(user: dict = Depends(verify_firebase_token)):
    return submit_training(user["uid"])
