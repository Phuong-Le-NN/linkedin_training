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
  "layoff/resign updates - Just make up a technical role",
  "celebrate new position accepted - Just make up a technical role",
  "to give out referral - Just make up a technical role and company and say that is giving out referral - if interested DM with experience to be considered",
  "company or organization update - just make up some milestones such as funding round achievement, going IPO, etc",
]
useless_criteria = [
    "brain-rot AI posts",
    "oversharing emotional story with no main message",
    "attempt to create viral, full of hyped terms and lengthy writing but no actual value"
    "rage bait content, not suitable for professional setting",
    "just make up some post that is usually not suitable for professional setting"
]

training_useful_path = "./ml/data/useful_posts.csv"
training_useless_path = "./ml/data/useless_posts.csv"

#sample caller generating useful path
# generate_csv(20, connection_updates, training_useful_path, "llama3.2:1b", "useful, non ads, concise", "100-word")
# generate_csv(20, connection_updates, training_useless_path, "llama3.2:1b", "useless, time-wasting if read", "100-word")


jobs = [
    (training_useful_path, "useful, non ads, concise"),
    (training_useless_path, "useless, time-wasting if read"),
]

with ThreadPoolExecutor(max_workers=2) as pool:
    futures = [
        pool.submit(
            generate_csv,
            20,
            connection_updates,
            path,
            "llama3.2:1b",
            quality,
            "100-word",
        )
        for path, quality in jobs
    ]

    # Re-raises any errors from either generation run.
    for future in futures:
        future.result()
