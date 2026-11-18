# X Lead Miner

Real-time **buyer-intent lead mining** from X (Twitter). Type a search, get
live posts back instantly, then a locally-trained AI model scores every post
0–1 for buying intent — with per-post inference latency shown to 4 decimals.

> Thousands of people announce their buying intentions on X every day:
> "is there an app that…", "anyone recommend…", "I wish there was…".
> X Lead Miner surfaces them, ranks them, and tiers them into a lead queue.

**Status**: open-source portfolio project. CI builds on GitHub Actions
(45s, free runner); deploys to Cloudflare Workers (free tier, no server).

## What it does

- **Instant search** — X advanced operators pass straight through
  (`"exact phrase"`, `lang:en`, `-filter:replies`, `since:YYYY-MM-DD`).
  Results render the moment the data provider responds.
- **Async AI scoring** — after results render, each post is scored
  independently by a locally-trained intent model; every card shows its own
  score badge **and its own inference latency** (e.g. `0.0891s`).
- **Three-tier queue** — high intent (≥0.8) / mid (0.6–0.79) / watchlist
  (<0.6), counts growing live as posts are scored.
- **Intent Lab** — a page that exposes the ML pipeline itself: collection,
  labeling, training and serving, with live metrics from the latest run.

## The intent model

Distilled from a Gemini 2.5 Flash teacher into a **199 KB artifact**:

```
X post text ──▶ frozen embeddinggemma-2 (768-d) ──▶ MLP 768-64-1 ──▶ sigmoid ──▶ 0–1
```

| metric (held-out test, n=1,179) | score |
| --- | --- |
| precision@5 | 1.00 |
| precision@10 | 1.00 |
| accuracy @0.5 | 0.877 |

Trained on **7,866 labeled X posts** (2,850 intent / 5,016 noise) collected
via 27 query families including hard negatives (same syntax, zero buying
intent — "recommend me some anime" is *not* a lead). The scoring runs on CPU
in single-digit milliseconds per post.

⚠️ Labels are teacher-generated (no human gold set): the metrics measure
agreement with the teacher (~90% human agreement per a 50-sample audit).
Complaint-based intent is under-detected — misses recall, never pollutes the
queue. Full pipeline, audit sample and lessons learned:
[flashclub/x-lead-intent-pipeline](https://github.com/flashclub/x-lead-intent-pipeline)

## Architecture

```
Browser ──▶ Next.js 15 (OpenNext) ──▶ Cloudflare Workers (free tier)
                │                          │
                │                          ├── D1 (SQLite) — users, sessions
                │                          └── scraper.tech API ──▶ live X posts
                │
                └──▶ POST /api/leads/score ──▶ intent sidecar (FastAPI + PyTorch,
                                               local dev) ──▶ per-post latency
```

- Search returns **instantly** — scoring is async, streamed per post.
- The Workers deployment omits the Python sidecar by design (scores are
  omitted gracefully); run the sidecar locally to see scores.
- No login, no paywall: the demo is fully open, search is IP-rate-limited
  (20/h) to protect the data quota.

## Tech stack

| layer | choice |
| --- | --- |
| framework | Next.js 15 (App Router) + OpenNext → Cloudflare Workers |
| styling | Tailwind CSS v4, token-driven themes (light/dark) |
| i18n | next-intl (EN / ZH) |
| ML | sentence-transformers (embeddinggemma-2, frozen) + PyTorch MLP head |
| serving | FastAPI sidecar, CPU fp32 inference |

## Run locally

```bash
pnpm install
pnpm exec prisma generate

# intent sidecar (optional — scores are omitted without it)
cd intent && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
SCRAPER_API_KEY=... MULERUN_API_KEY=... python3 collect_bulk.py   # collect
MULERUN_API_KEY=... python3 label.py --in data/posts_10k.jsonl     # label
python3 train.py --data data/labeled_10k.jsonl --out model         # train
python3 serve.py                                                   # :5019

# app
cp .env.example .env   # SCRAPER_API_KEY + INTENT_SERVICE_URL=http://127.0.0.1:5019
pnpm dev               # http://localhost:3019
```

Environment variables (all optional — features degrade gracefully):

| var | enables |
| --- | --- |
| `SCRAPER_API_KEY` | live X search |
| `INTENT_SERVICE_URL` | per-post intent scoring |
| `MULERUN_API_KEY` | chat assistant + labeling |

## Deploy (GitHub Actions, free)

`Settings → Secrets and variables → Actions`, add `CLOUDFLARE_API_TOKEN`
(Edit Workers template) + `CLOUDFLARE_ACCOUNT_ID`, then
**Actions → CI & Deploy → Run workflow**. GitHub runners build OpenNext and
push to Cloudflare — no local build, no server.

## License

MIT (code). Post content belongs to its authors; collected data is not
redistributed.
