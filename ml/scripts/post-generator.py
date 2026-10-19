from concurrent.futures import ThreadPoolExecutor
import csv
import json
import os
from urllib.request import Request, urlopen
import random

def generate_post(criterion, model, quality, word_limit):
    data = json.dumps({
    "model": model,
    "prompt": f"Make up a {word_limit}, text-only LinkedIn post with no icons that is likely to be {quality} for Linkedin users for this criteria: {criterion}",
    "stream": False,
    "options": {
    "temperature": 1.0,
    "top_p": 0.95,
    "seed": random.randrange(1, 2**31),
    },
    }).encode()
    request = Request(
        "http://localhost:11434/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request) as response:
        return " ".join(json.load(response)["response"].split())


def generate_csv(iterations: int, criteria: list[str], output_path: str, model: str = "llama3.2", quality = "useless", word_limit="200-word"):
    has_content = os.path.exists(output_path) and os.path.getsize(output_path) > 0

    post_idx = 1
    if has_content:
        with open(output_path, newline="", encoding="utf-8") as existing:
            post_idx = sum(1 for _ in csv.reader(existing))

    with open(output_path, "a", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        if not has_content:
            writer.writerow(["post_idx", "post_content"])

        with ThreadPoolExecutor(max_workers=4) as pool:
            for output in pool.map(
                lambda criterion: generate_post(criterion, model, quality, word_limit),
                criteria * iterations,
            ):
                writer.writerow([post_idx, output])
                post_idx += 1

connection_updates = [
  "Advertising a position hiring - Just make up a technical role",
  "layoff updates - Just make up a technical role", 
  "celebrate new position accepted - Just make up a technical role", 
  "to give out referral - Just make up a technical role and how to use the referral",
]
training_usefull_path = "./ml/data/training/usefull_posts.cvs"
test_usefull_path = "./ml/data/test/usefull_posts.cvs"

#sample caller generating useful path
generate_csv(20, connection_updates, test_usefull_path, "llama3.2:1b", "usefull, non ads, concise", "100-word")
generate_csv(20, connection_updates, training_usefull_path, "llama3.2:1b", "usefull, non ads, concise", "100-word")
