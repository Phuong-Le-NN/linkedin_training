"""Train one user's classifier from Firestore feedback in Cloud Build."""

import os
import re

import numpy as np
import tensorflow as tf
from gensim.models import Word2Vec
from google.cloud import firestore, storage
from google.cloud.firestore_v1.base_query import FieldFilter
from sklearn.model_selection import train_test_split
from tensorflow.keras import Sequential
from tensorflow.keras.callbacks import EarlyStopping
from tensorflow.keras.layers import (
    Conv1D,
    Dense,
    Embedding,
    GlobalMaxPooling1D,
    Input,
    MaxPooling1D,
)
from tensorflow.keras.preprocessing.text import Tokenizer
from tensorflow.keras.utils import pad_sequences


def main():
    user_id = os.environ["USER_ID"]
    bucket_name = os.environ["MODEL_BUCKET"]

    query = (
        firestore.Client()
        .collection("feedback")
        .where(filter=FieldFilter("user_id", "==", user_id))
        .limit(1000)
    )
    rows = [doc.to_dict() for doc in query.stream()]
    if len(rows) < 3:
        raise ValueError(f"Need at least 3 feedback posts; found {len(rows)}")

    texts = [
        " ".join(re.findall(r"\b\w+\b", row["text"].lower()))
        for row in rows
    ]
    labels = np.array([int(row["useful"]) for row in rows])
    label_counts = np.bincount(labels, minlength=2)
    if label_counts.min() < 1:
        raise ValueError("Need at least one post with each label")

    train_texts, y_train = texts, labels
    use_validation = len(rows) >= 10 and label_counts.min() >= 2
    if use_validation:
        train_texts, val_texts, y_train, y_val = train_test_split(
            texts, labels, test_size=0.2, stratify=labels, random_state=42
        )
    tokenizer = Tokenizer(oov_token="<OOV>", filters="")
    tokenizer.fit_on_texts(train_texts)

    def encode(items):
        return pad_sequences(
            tokenizer.texts_to_sequences(items),
            maxlen=350,
            padding="post",
            truncating="post",
        )

    word2vec = Word2Vec(
        [text.split() for text in train_texts],
        vector_size=300,
        min_count=1,
        epochs=10,
    )
    embeddings = np.zeros((len(tokenizer.word_index) + 1, 300), dtype=np.float32)
    for word, index in tokenizer.word_index.items():
        if word in word2vec.wv:
            embeddings[index] = word2vec.wv[word]

    model = Sequential([
        Input(shape=(350,)),
        Embedding(len(embeddings), 300, weights=[embeddings], trainable=True),
        Conv1D(64, 20, activation="relu"),
        MaxPooling1D(2),
        GlobalMaxPooling1D(),
        Dense(32, activation="relu"),
        Dense(1, activation="sigmoid"),
    ])
    model.compile(optimizer="adam", loss="binary_crossentropy")
    fit_options = {"epochs": 20, "batch_size": 32, "verbose": 2}
    if use_validation:
        fit_options["validation_data"] = (encode(val_texts), y_val)
        fit_options["callbacks"] = [
            EarlyStopping(monitor="val_loss", patience=2, restore_best_weights=True)
        ]
    model.fit(encode(train_texts), y_train, **fit_options)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
    model_bytes = converter.convert()

    bucket = storage.Client().bucket(bucket_name)
    prefix = f"models/{user_id}"
    bucket.blob(f"{prefix}/tokenizer.json").upload_from_string(
        tokenizer.to_json(), content_type="application/json"
    )
    bucket.blob(f"{prefix}/model.tflite").upload_from_string(
        model_bytes, content_type="application/octet-stream"
    )
    print(f"Uploaded {prefix}/model.tflite and tokenizer.json")


if __name__ == "__main__":
    main()
