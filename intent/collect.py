"""Step 1 — collect candidate posts from the Scraper.tech X API.

Pulls one page per query from two buckets:
  intent  — phrasings buyers actually type ("anyone recommend", ...)
  noise   — same-ish topics WITHOUT buying intent, as negative examples

Dedupes by tweet id and writes data/posts.jsonl. Runs on the stdlib alone.

Usage:
    SCRAPER_API_KEY=... python3 collect.py [--per-query 20]
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.scraper.tech/search.php"

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
        {"query": query, "search_type": "Latest", "cursor": ""}
    )
    request = urllib.request.Request(url, headers={"Scraper-Key": api_key})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if "error" in payload:
        # Upstream returns HTTP 200 for business errors (verified 2026-11-16).
        raise RuntimeError(f"upstream error: {payload['error']}")
    return payload.get("timeline", []) or []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-query", type=int, default=20)
    parser.add_argument("--out", default=str(Path(__file__).parent / "data" / "posts.jsonl"))
    args = parser.parse_args()

    api_key = os.environ.get("SCRAPER_API_KEY")
    if not api_key:
        sys.exit("SCRAPER_API_KEY is not set — put it in the environment or .dev.vars")

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
                tweet_id = tweet.get("tweet_id")
                text = (tweet.get("text") or "").strip()
                user = tweet.get("user_info") or {}
                if not tweet_id or len(text) < 20 or tweet_id in rows:
                    continue
                rows[tweet_id] = {
                    "id": tweet_id,
                    "text": text,
                    "handle": user.get("screen_name") or tweet.get("screen_name") or "",
                    "followers": user.get("followers_count"),
                    "created_at": tweet.get("created_at"),
                    "bucket": bucket,
                    "source_query": query,
                    "label": None,
                }
                added += 1
            print(f"ok    {bucket}: +{added}  ({query})")
            time.sleep(2.0)  # polite: search is rate-limited to 120 req/min

    with out_path.open("w", encoding="utf-8") as handle:
        for row in rows.values():
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    intent_n = sum(1 for r in rows.values() if r["bucket"] == "intent")
    print(f"\nwrote {len(rows)} posts ({intent_n} intent / {len(rows) - intent_n} noise) to {out_path}")


if __name__ == "__main__":
    main()
