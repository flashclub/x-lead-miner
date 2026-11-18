"""Step 2 — distillation labeling via an LLM teacher.

Calls MuleRun's OpenAI-compatible chat endpoint to label each collected
post with buying intent. Resume-safe: already-labeled ids are skipped.
The teacher's labels become the training targets for the small PyTorch
model (step 3) — a handful are worth hand-checking before training.

Usage:
    MULERUN_API_KEY=... python3 label.py [--limit 0] [--sleep 1.0]
"""

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

API = "https://api.mulerun.com/v1/chat/completions"
MODEL = os.environ.get("MULERUN_LLM_MODEL", "gemini-2.5-flash")

SYSTEM_PROMPT = (
    "You label public X posts for a sales-lead mining tool whose users want to "
    "find people to sell products to.\n"
    '"intent" rules — true ONLY when the author actively seeks a PRODUCT, TOOL, '
    "APP or SERVICE to acquire or use: asking for product recommendations for a "
    "concrete need, seeking an alternative to a tool they already use, "
    "complaining about a tool's limitation, or wishing an app/software had a "
    "missing capability. false when the ask is for CONTENT to passively consume "
    "(movies, shows, books, music, YouTubers, documentaries, games), when the "
    "author only praises something, or when there is no product seek at all.\n"
    '- "type": recommend_request, alternative_seek, complaint, feature_wish, '
    "praise, noise\n"
    '- "confidence": 0.0-1.0\n'
    "Decide by these anchors:\n"
    "- true: " + "anyone recommend a CRM for my agency | wish an app tracked my subscriptions | looking for a cheaper alternative to Ahrefs" + "\n"
    "- false: " + "recommend me some anime | best coffee in town | just shipped v1 | recommend a good youtuber" + "\n"
    'Reply with ONLY this JSON, no markdown: {"intent": bool, "type": str, "confidence": float}'
)


def call_teacher(text: str, api_key: str) -> dict:
    body = json.dumps(
        {
            "model": MODEL,
            "temperature": 0,
            # gemini-style models spend thinking tokens from this budget;
            # too small and the visible content comes back empty.
            "max_tokens": ARGS_MAX_TOKENS,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text[:1500]},
            ],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        API,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # MuleRun's edge blocks python-urllib's default User-Agent with 403
            # (verified 2026-11-16) — any explicit client UA passes.
            "User-Agent": "x-lead-miner-labeler/0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    content = payload["choices"][0]["message"]["content"]

    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        raise ValueError(f"teacher did not return JSON: {content[:120]}")
    label = json.loads(match.group(0))
    if not isinstance(label.get("intent"), bool):
        raise ValueError(f"bad label shape: {label}")
    label["type"] = str(label.get("type", "noise"))
    label["confidence"] = float(label.get("confidence", 0.5))
    return label


ARGS_MAX_TOKENS = 800

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0, help="label at most N posts (0 = all)")
    parser.add_argument("--sleep", type=float, default=0.0)
    parser.add_argument("--workers", type=int, default=4, help="parallel teacher calls")
    parser.add_argument("--max-tokens", type=int, default=800)
    global ARGS_MAX_TOKENS

    parser.add_argument("--in", dest="inp", default=str(Path(__file__).parent / "data" / "posts.jsonl"))
    parser.add_argument("--out", default=str(Path(__file__).parent / "data" / "labeled.jsonl"))
    args = parser.parse_args()
    ARGS_MAX_TOKENS = args.max_tokens

    api_key = os.environ.get("MULERUN_API_KEY")
    if not api_key:
        sys.exit("MULERUN_API_KEY is not set")

    rows = []
    # iterate the FILE object: str.splitlines() also splits on U+2028/U+2029,
    # which X posts contain — that silently swallowed 12 posts (fixed 2026-11-17)
    with open(args.inp, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # tolerate torn lines from a concurrent writer
    done: set[str] = set()
    out_path = Path(args.out)
    if out_path.exists():
        for line in out_path.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["id"])

    todo = [row for row in rows if row["id"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    labeled = 0

    def work(row):
        if args.sleep:
            time.sleep(args.sleep)
        attempt = 0
        delay = 4.0
        while True:  # never drop a post: 429 retries forever with capped backoff
            try:
                return row, call_teacher(row["text"], api_key)
            except Exception as exc:
                if "429" in str(exc):
                    attempt += 1
                    wait = min(delay * (2 ** min(attempt, 5)), 60) + random.uniform(0, 2)
                    print(f"WARN  429 backoff {wait:.0f}s (attempt {attempt}): {row['id']}")
                    time.sleep(wait)
                    continue
                if attempt < 2:  # transient network blips get 2 quick retries
                    attempt += 1
                    time.sleep(2)
                    continue
                raise

    with out_path.open("a", encoding="utf-8") as handle:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(work, row) for row in todo]
            for fut in as_completed(futures):
                try:
                    row, label = fut.result()
                except Exception as exc:
                    print(f"WARN  skip: {exc}")
                    continue
                row["label"] = label
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                handle.flush()
                marked = "INTENT" if label["intent"] else "noise "
                preview = row["text"][:60].replace("\n", " ")
                print(f'{marked}  {label["type"]:<18} {preview}')
                labeled += 1

    total = sum(1 for _ in out_path.open()) if out_path.exists() else 0
    print(f"\nlabeled {labeled} new (file now has {total}); next: python3 train.py")


if __name__ == "__main__":
    main()
