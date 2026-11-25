"""Step 1 — collect candidate posts from the AI API Key X API.

Pulls one page per query from two buckets:
  intent  — phrasings buyers actually type ("anyone recommend", ...)
  noise   — same-ish topics WITHOUT buying intent, as negative examples

Dedupes by tweet id and writes data/posts.jsonl. Runs on the stdlib alone.

Billing note: X results cost 12 credits each ($1 = 100k credits), so one
run of this script (~7 queries x 20 posts) is roughly 1.7k credits of the
free tier's 60k/month.

Usage:
    AIAPIKEY_KEY=... python3 collect.py [--per-query 20]
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://aiapikey.ai/v1/x/search"

INTENT_QUERIES = [
    '"anyone recommend" lang:en -filter:replies',
    '"I wish there was" app lang:en',
    '"alternative to" lang:en -filter:replies',
    '"looking for a tool" lang:en',
    '"worth paying for" app lang:en',
]

NOISE_QUERIES = [
    "just shipped a new feature lang:en",
    "love this app lang:en -filter:replies",
]


def fetch_page(query: str, api_key: str) -> list[dict]:
    url = API + "?" + urllib.parse.urlencode(
        {"query": query, "searchType": "Latest", "cursor": ""}
    )
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {api_key}"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if "error" in payload:
        # Defensive: the API uses real HTTP status codes, but never trust a
        # 200 that carries an in-body error object.
        error = payload["error"]
        raise RuntimeError(f"upstream error: {error}")
    return payload.get("tweets", []) or []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-query", type=int, default=20)
    parser.add_argument("--out", default=str(Path(__file__).parent / "data" / "posts.jsonl"))
    args = parser.parse_args()

    api_key = os.environ.get("AIAPIKEY_KEY")
    if not api_key:
        sys.exit("AIAPIKEY_KEY is not set — put it in the environment or .dev.vars")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    rows: dict[str, dict] = {}
    for bucket, queries in (("intent", INTENT_QUERIES), ("noise", NOISE_QUERIES)):
        for query in queries:
            try:
                tweets = fetch_page(query, api_key)[: args.per_query]
            except Exception as exc:  # keep collecting on single-query failure
                print(f"WARN  {bucket} query failed ({exc}): {query}")
                continue
            added = 0
            for tweet in tweets:
                tweet_id = tweet.get("id")
                text = (tweet.get("text") or "").strip()
                author = tweet.get("author") or {}
                if not tweet_id or len(text) < 20 or tweet_id in rows:
                    continue
                rows[tweet_id] = {
                    "id": tweet_id,
                    "text": text,
                    "handle": author.get("screenName") or "",
                    "followers": author.get("followers"),
                    "created_at": tweet.get("createdAt"),
                    "bucket": bucket,
                    "source_query": query,
                    "label": None,
                }
                added += 1
            print(f"ok    {bucket}: +{added}  ({query})")
            time.sleep(2.0)  # polite pacing; billing is per result, not per request

    with out_path.open("w", encoding="utf-8") as handle:
        for row in rows.values():
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    intent_n = sum(1 for r in rows.values() if r["bucket"] == "intent")
    print(f"\nwrote {len(rows)} posts ({intent_n} intent / {len(rows) - intent_n} noise) to {out_path}")


if __name__ == "__main__":
    main()
