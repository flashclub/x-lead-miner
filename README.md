# X Lead Miner

Real-time **buyer-intent lead mining** from X (Twitter). Type a search, get
live posts back instantly, then a locally-trained AI model scores every post
0–1 for buying intent — with per-post inference latency shown to 4 decimals.

> Thousands of people announce their buying intentions on X every day:
> "is there an app that…", "anyone recommend…", "I wish there was…".
> X Lead Miner surfaces them, ranks them, and tiers them into a lead queue.

**Status**: open-source portfolio project — CI builds on GitHub Actions and
deploys to Cloudflare Workers (free tier, no server).

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
- **Browser extension** — scores tweets directly on x.com, no search API
  involved (see below).

## The intent model

Distilled from a Gemini 2.5 Flash teacher into a **199 KB artifact**:

```
X post text ──▶ frozen bge-base-en-v1.5 (768-d) ──▶ MLP 768-64-1 ──▶ sigmoid ──▶ 0–1
```

| metric (held-out test, n=1,179) | score |
| --- | --- |
| precision@5 | 1.00 |
| precision@10 | 1.00 |
| accuracy @0.5 | 0.886 |

Trained on **7,866 labeled X posts** (2,850 intent / 5,016 noise) collected
via 27 query families including hard negatives (same syntax, zero buying
intent — "recommend me some anime" is *not* a lead). The artifact is tiny —
49k parameters — and a full embed-and-score pass takes ~0.1–0.2 s per post in
production.

⚠️ Labels are teacher-generated (no human gold set): the metrics measure
agreement with the teacher (~90% human agreement per a 50-sample audit).
Complaint-based intent is under-detected — misses recall, never pollutes the
queue. Full pipeline, audit sample and lessons learned:
[flashclub/x-lead-intent-pipeline](https://github.com/flashclub/x-lead-intent-pipeline)

## Architecture

```
Browser ──▶ Next.js 15 (OpenNext) ──▶ Cloudflare Workers (free tier)
                │                          │
                │                          ├── Workers AI ──▶ bge-base-en-v1.5 embeddings
                │                          │     └── bundled MLP head ──▶ intent score
                │                          ├── D1 (SQLite) — users, sessions
                │                          └── AI API Key (aiapikey.ai) ──▶ live X posts
                │
                └──▶ POST /api/leads/score ──▶ (local dev only) FastAPI sidecar,
                                               same head in PyTorch ──▶ per-post latency
```

- Search returns **instantly** — scoring is async, streamed per post.
- Production scores **inside the Worker**: Workers AI computes the
  embeddings, the bundled head weights finish the forward pass — no Python in
  prod. The FastAPI sidecar is the local-development path.
- No login, no paywall: the demo is fully open, search is IP-rate-limited
  (20/h) to protect the data quota.

## Browser extension

`extension/` is a zero-dependency Chrome MV3 extension that reads tweets
straight from the x.com DOM and shows the score next to each timestamp. It
only ever calls `POST /api/leads/score`, so it works independently of the
site's search backend.

Load it unpacked via `chrome://extensions` → *Developer mode* → *Load
unpacked*. Details, cost controls and debugging notes: `extension/README.md`.

## Tech stack

| layer | choice |
| --- | --- |
| framework | Next.js 15 (App Router) + OpenNext → Cloudflare Workers |
| styling | Tailwind CSS v4, token-driven themes (light/dark) |
| i18n | next-intl (EN / ZH) |
| ML | bge-base-en-v1.5 (frozen, Workers AI) + 49k-param MLP head |
| serving | Workers AI in production · FastAPI sidecar (CPU fp32) for local dev |

## Development workflow

- All builds run on GitHub Actions free runners — no local build step.
- Push to `main` deploys: CI builds OpenNext, and Workers is updated only if
  the build passes.
- Deploy-critical files: `wrangler.jsonc` · `src/lib/intent.ts` ·
  `src/lib/intent-head-weights.json`

## Run locally

```bash
pnpm install
pnpm exec prisma generate

# intent sidecar (optional — production scores via Workers AI instead)
cd intent && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
AIAPIKEY_KEY=... MULERUN_API_KEY=... python3 collect_bulk.py     # collect
MULERUN_API_KEY=... python3 label.py --in data/posts_10k.jsonl     # label
python3 train.py --data data/labeled_10k.jsonl --out model         # train
python3 serve.py                                                   # :5019

# app
cp .env.example .env   # AIAPIKEY_KEY + INTENT_SERVICE_URL=http://127.0.0.1:5019
pnpm dev               # http://localhost:3019
```

Environment variables (all optional — features degrade gracefully):

| var | enables |
| --- | --- |
| `AIAPIKEY_KEY` | live X search |
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
