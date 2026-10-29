import json
import re
from io import BytesIO
from zipfile import ZipFile
from functools import lru_cache
from threading import Semaphore

import numpy as np
from fastapi import HTTPException
from ai_edge_litert.interpreter import Interpreter
from google.api_core.exceptions import NotFound
from google.cloud import storage

MAX_CONCURRENT_CLASSIFICATIONS = 1
MAX_LEN = 350
MODEL_BUCKET = "linkedin-training-512914-models"

classification_slots = Semaphore(MAX_CONCURRENT_CLASSIFICATIONS)


def load_effective_model(user_id):
    bucket = storage.Client().bucket(MODEL_BUCKET)

    prefixes = [f"models/{user_id}"] if user_id else []
    prefixes.append("models/global/v1")

    for prefix in prefixes:
        bundle_path = f"{prefix}/model.bundle.zip"
        bundle_blob = bucket.blob(bundle_path)

        try:
            bundle_blob.reload()
        except NotFound:
            continue

        return _load_bundle_model(bundle_path, bundle_blob.generation)

    raise HTTPException(
        status_code=404,
        detail="No trained model is available",
    )

@lru_cache(maxsize=32)
def _load_bundle_model(bundle_path, _generation):
    bundle_bytes = storage.Client().bucket(MODEL_BUCKET).blob(
        bundle_path
    ).download_as_bytes()
    with ZipFile(BytesIO(bundle_bytes)) as archive:
        return _make_interpreter(
            archive.read("model.tflite"), archive.read("tokenizer.json")
        )


def _make_interpreter(model_bytes, tokenizer_bytes):
    config = json.loads(tokenizer_bytes)["config"]
    word_index = json.loads(config["word_index"])
    oov_index = word_index[config["oov_token"]]
    return Interpreter(model_content=model_bytes), word_index, oov_index


def classify(texts, user_id):
    if not texts:
        return []

    interpreter, word_index, oov_index = load_effective_model(user_id)
    input_details = interpreter.get_input_details()[0]
    padded = np.zeros((len(texts), MAX_LEN), dtype=input_details["dtype"])

    for row, text in enumerate(texts):
        words = re.findall(r"\b\w+\b", text.lower())[:MAX_LEN]
        padded[row, :len(words)] = [
            word_index.get(word, oov_index) for word in words
        ]

    interpreter.resize_tensor_input(
        input_details["index"], padded.shape, strict=True
    )
    interpreter.allocate_tensors()
    interpreter.set_tensor(input_details["index"], padded)
    interpreter.invoke()

    output_index = interpreter.get_output_details()[0]["index"]
    probabilities = interpreter.get_tensor(output_index).ravel()

    return [
        {
            "label": "useful" if probability >= 0.5 else "useless",
            "useful_probability": float(probability),
        }
        for probability in probabilities
    ]


def classify_with_limit(texts, user_id):
    if not classification_slots.acquire(timeout=0.1):
        raise HTTPException(
            status_code=429,
            detail="Classification service is busy. Please retry shortly.",
            headers={"Retry-After": "1"},
        )

    try:
        return classify(texts, user_id)
    finally:
        classification_slots.release()
