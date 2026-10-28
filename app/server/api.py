from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from app.server.classifier import classify_with_limit
from app.server.store_feedback import count_feedback, save_feedback
from app.server.auth import verify_firebase_token
from app.server.training import submit_training

app = FastAPI(dependencies=[Depends(verify_firebase_token)])


class Post(BaseModel):
    text: str


class Posts(BaseModel):
    texts: list[str]


class Feedback(BaseModel):
    text: str
    useful: bool


@app.post("/classify")
def classify_one(post: Post, user: dict = Depends(verify_firebase_token)):
    return classify_with_limit([post.text], user["uid"])[0]


@app.post("/classify-batch")
def classify_many(posts: Posts, user: dict = Depends(verify_firebase_token)):
    if len(posts.texts) > 100:
        raise HTTPException(
            status_code=413,
            detail="Batch cannot contain more than 100 posts.",
        )

    return classify_with_limit(posts.texts, user["uid"])


@app.post("/feedback", status_code=201)
def submit_feedback(
    feedback: Feedback,
    user: dict = Depends(verify_firebase_token),
):
    save_feedback(feedback.text, feedback.useful, user["uid"])
    return {"saved": True}


@app.get("/feedback/count")
def feedback_count(user: dict = Depends(verify_firebase_token)):
    return {"count": count_feedback(user["uid"])}


@app.post("/train", status_code=202)
def train_model(user: dict = Depends(verify_firebase_token)):
    return submit_training(user["uid"])
