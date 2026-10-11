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
                
iterations = 10
useless_criteria = [
    "Selling a course, and using some emotional unrelated story",
    "Overly emotional or clickbait stories with no tech-related content",
    "Using 'life lessons' or motivational quotes that aren't tied to personal growth in tech or learning.",
    "Non-tech political or social commentary that doesn’t add value to professional discussions",
    "Posts that are purely personal (vacations, family pictures) without a professional context",
    "Asking to 'Comment interested if you want to get the job!'",
    "'Tag 3 people' or 'like if you agree' with no substance or tech-related discussions",
    "Generalized or redundant content",
    "Any brand promotional content / Ad",
    "Overly generic advice like 'Keep learning every day' without mentioning any specific tools, frameworks, or learning paths.",
    "Anything that’s just a viral meme or random content not related to a professional or technical goal.",
    "Written by an LLM",
    "Overly personal or TMI content",
    "Excessive self-promotion or bragging",
    "Inappropriate workplace behavior",
    "Forced or artificial inspiration",
    "Obvious humble bragging",
    "Inappropriate emotional display for professional setting",
    "Contains misleading or out-of-context information"
]
usefull_criteria = [
  "Includes working code examples, useful snippets, architecture diagrams, benchmarks, or reproducible demonstrations when relevant.",
  "Compares tools, frameworks, technologies, or approaches using clear criteria, evidence, and trade-offs.",
  "Demonstrates critical thinking by explaining why a particular approach works, fails, or may be preferable.",
  "Presents original analysis, informed opinions, or thoughtful perspectives supported by evidence or experience.",
  "Discusses engineering challenges, including debugging, scalability, security, performance, reliability, or maintainability.",
  "Shares project progress with meaningful technical details, challenges encountered, decisions made, and lessons learned.",
  "Asks focused, substantive questions that encourage informed discussion and knowledge sharing.",
  "Corrects misconceptions or clarifies confusing technical concepts with accurate explanations.",
  "Shares useful resources, documentation, research papers, tutorials, or tools and explains why they are valuable.",
  "Acknowledges limitations, uncertainty, alternative approaches, and relevant trade-offs in technical topics.",
]
connection_updates = [
  "Advertising a position hiring - Just make up a technical role",
  "layoff updates - Just make up a technical role", 
  "celebrate new position accepted - Just make up a technical role", 
  "to give out referral - Just make up a technical role and how to use the referral",
]
training_useless_path = "./cnn/data/training/useless_posts.cvs"
training_usefull_path = "./cnn/data/training/usefull_posts.cvs"
test_useless_path = "./cnn/data/test/useless_posts.cvs"
test_usefull_path = "./cnn/data/test/usefull_posts.cvs"

# generate_csv(iterations, useless_criteria, test_useless_path, "llama3.2:1b", "useless")
# generate_csv(iterations, usefull_criteria, test_usefull_path, "llama3.2:1b", "usefull, non ads, concise")
# generate_csv(iterations, useless_criteria, training_usefull_path, "llama3.2:1b", "usefull, non ads, concise")
# generate_csv(iterations, usefull_criteria, training_useless_path, "llama3.2:1b", "useless")

generate_csv(20, connection_updates, test_usefull_path, "llama3.2:1b", "usefull, non ads, concise", "100-word")
generate_csv(20, connection_updates, training_usefull_path, "llama3.2:1b", "usefull, non ads, concise", "100-word")
