from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.server.classifier import classify_with_limit
from app.server.store_feedback import save_feedback

app = FastAPI()


class Post(BaseModel):
    text: str


class Posts(BaseModel):
    texts: list[str]


class Feedback(BaseModel):
    text: str
    useful: bool


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


@app.post("/feedback", status_code=201)
def submit_feedback(feedback: Feedback):
    save_feedback(feedback.text, feedback.useful)
    return {"saved": True}