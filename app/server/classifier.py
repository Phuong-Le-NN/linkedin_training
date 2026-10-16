import json
import re
from pathlib import Path
from threading import Semaphore

import numpy as np
from fastapi import HTTPException
from ai_edge_litert.interpreter import Interpreter

MAX_CONCURRENT_CLASSIFICATIONS = 1
MAX_LEN = 350

model_folder = Path(__file__).resolve().parents[2] / "cnn" / "model_exports"
config = json.loads((model_folder / "tokenizer.json").read_text())["config"]
word_index = json.loads(config["word_index"])
oov_index = word_index[config["oov_token"]]

interpreter = Interpreter(
    model_path=str(model_folder / "linkedin_posts_classifier.tflite")
)
classification_slots = Semaphore(MAX_CONCURRENT_CLASSIFICATIONS)


def classify(texts):
    if not texts:
        return []

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


def classify_with_limit(texts):
    if not classification_slots.acquire(timeout=0.1):
        raise HTTPException(
            status_code=429,
            detail="Classification service is busy. Please retry shortly.",
            headers={"Retry-After": "1"},
        )

    try:
        return classify(texts)
    finally:
        classification_slots.release()