"""Bulk collector — scales collection to ~10k posts with deep pagination.

Differences from collect.py (single-page-per-query):
  * paginates via `nextCursor` until the per-query target is met,
    results are exhausted, or a max-pages guard trips
  * appends incrementally to a resume-safe JSONL (re-running skips
    already-collected tweet ids)
  * paces ~2.5s/page — polite, and billing is per result (12 credits/tweet),
    so plan against the free tier's 60k credits/month (~5k posts)

Usage:
    AIAPIKEY_KEY=... python3 collect_bulk.py [--out data/posts_10k.jsonl] [--max-pages 30]
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
PAGE_SLEEP = 2.5  # s between pages — polite pacing, no documented req/min cap
QUERY_SLEEP = 1.0
MAX_EMPTY_NEW = 3  # stop a query after this many consecutive pages with <5 new ids

# (bucket, query, target_count)
QUERIES_PLAN = [
    # ---- intent-leaning families (~6.1k) ----
    ("intent", '"anyone recommend" lang:en -filter:replies', 800),
    ("intent", '"is there an app" lang:en -filter:replies', 800),
    ("intent", '"I wish there was" app lang:en', 600),
    ("intent", '"alternative to" lang:en -filter:replies', 600),
    ("intent", '"is there a tool" lang:en -filter:replies', 500),
    ("intent", '"looking for an app" lang:en', 400),
    ("intent", '"recommend a tool" lang:en -filter:replies', 300),
    ("intent", '"recommend an app" lang:en -filter:replies', 300),
    ("intent", '"wish someone would build" lang:en', 250),
    ("intent", '"would pay for" app lang:en', 250),
    ("intent", '"switching from" app lang:en -filter:replies', 250),
    ("intent", '"cancelled my subscription" lang:en -filter:replies', 200),
    ("intent", '"hate how" app lang:en -filter:replies', 200),
    ("intent", '"best tool for" lang:en -filter:replies', 250),
    ("intent", '"any recommendations" (app OR tool OR software) lang:en -filter:replies', 300),
    # ---- noise / hard-negative families (~3.6k) ----
    ("noise", '"recommend me some" (movie OR show OR anime) lang:en -filter:replies', 400),
    ("noise", '"recommend me some" (book OR music OR podcast) lang:en -filter:replies', 400),
    ("noise", '"recommend me a" (youtuber OR streamer) lang:en', 250),
    ("noise", '"recommend a game" lang:en -filter:replies', 250),
    ("noise", '"just shipped" lang:en -filter:replies', 300),
    ("noise", '"just launched" (saas OR app) lang:en', 250),
    ("noise", '"love this app" lang:en -filter:replies', 300),
    ("noise", '"best app ever" lang:en -filter:replies', 250),
    ("noise", '"monday motivation" lang:en', 250),
    ("noise", '"watched" (movie OR film) lang:en -filter:replies', 300),
    ("noise", '"can\'t wait for" (season OR episode) lang:en', 250),
]


def fetch_page(query: str, cursor: str, api_key: str) -> tuple[list[dict], str]:
    url = API + "?" + urllib.parse.urlencode(
        {"query": query, "searchType": "Latest", "cursor": cursor}
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
    return payload.get("tweets", []) or [], payload.get("nextCursor") or ""


def load_seen(path: Path) -> set[str]:
    if not path.exists():
        return set()
    seen: set[str] = set()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                try:
                    seen.add(json.loads(line)["id"])
                except (json.JSONDecodeError, KeyError):
                    continue
    return seen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(Path(__file__).parent / "data" / "posts_10k.jsonl"))
    parser.add_argument("--max-pages", type=int, default=40, help="per-query pagination guard")
    args = parser.parse_args()

    api_key = os.environ.get("AIAPIKEY_KEY")
    if not api_key:
        sys.exit("AIAPIKEY_KEY is not set")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    seen = load_seen(out_path)
    print(f"resuming: {len(seen)} ids already in {out_path}")

    handle = out_path.open("a", encoding="utf-8")
    plan_total = sum(t for _, _, t in QUERIES_PLAN)

    for bucket, query, target in QUERIES_PLAN:
        # skip queries whose target is already met by existing data
        have_for_query = 0
        if out_path.exists():
            with out_path.open(encoding="utf-8") as fh:
                for line in fh:
                    if query in line:
                        have_for_query += 1
        if have_for_query >= target:
            print(f"skip  ({have_for_query}/{target}) {query}")
            continue

        cursor = ""
        collected_for_query = 0
        stale_pages = 0
        for page in range(1, args.max_pages + 1):
            try:
                tweets, cursor = fetch_page(query, cursor, api_key)
            except Exception as exc:
                print(f"WARN  {bucket} page {page} failed ({exc}): {query}")
                time.sleep(5.0)
                continue
            added = 0
            for tweet in tweets:
                tweet_id = tweet.get("id")
                text = (tweet.get("text") or "").strip()
                author = tweet.get("author") or {}
                if not tweet_id or len(text) < 20 or tweet_id in seen:
                    continue
                seen.add(tweet_id)
                handle.write(json.dumps({
                    "id": tweet_id,
                    "text": text,
                    "handle": author.get("screenName") or "",
                    "followers": author.get("followers"),
                    "created_at": tweet.get("createdAt"),
                    "bucket": bucket,
                    "source_query": query,
                    "label": None,
                }, ensure_ascii=False) + "\n")
                added += 1
                collected_for_query += 1
            handle.flush()
            new_unique = added
            if new_unique < 5:
                stale_pages += 1
            print(f"ok    {bucket} p{page}: +{new_unique} (query total {collected_for_query}/{target})")
            if collected_for_query >= target or not cursor or stale_pages >= MAX_EMPTY_NEW:
                break
            time.sleep(PAGE_SLEEP)
        print(f"done  {bucket}: query total {collected_for_query}/{target}  ({query})")
        time.sleep(QUERY_SLEEP)

    handle.close()
    grand = len(seen)
    print(f"\ntotal unique posts in {out_path}: {grand} (plan targeted {plan_total})")


if __name__ == "__main__":
    main()
