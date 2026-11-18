# Lead-intent model (PyTorch)

Scores X posts 0–1 for buying intent. This is the "lead scoring" behind the
dashboard — and the interview centerpiece: a complete, honest tiny-ML
pipeline (distill → train → evaluate → serve), not a fine-tuned LLM.

## Architecture

```
post text ──> frozen sentence embedder (default: embeddinggemma-2, 768-dim)
          ──> MLP head dim-64-1  (the only trained part)
          ──> sigmoid ──> intent score
```

Why this shape: the trainable surface is tiny (trains in seconds on CPU),
the frozen embedder generalizes without a huge dataset, and precision@k on
a holdout is a metric you can defend line by line.

## Model choice — the answer to "why this embedder?"

Newest generation first; no legacy models in the stack:

| Candidate | Released | Size | Dim | Role |
| --- | --- | --- | --- | --- |
| `google/embeddinggemma-2` | 2026-10 | 740M (Apache-2.0, ~0.5GB RAM on-device) | 768 | **default** — newest gen, multimodal, on-device |
| `google/embeddinggemma-300m` | 2025-09 | 308M | 768 | prior-gen speed reference |
| `Qwen/Qwen3-Embedding-0.6B` | 2025-06 | 0.6B (Apache-2.0) | 1024 | multilingual stretch — MTEB multilingual 70.58 at release |

Qwen3-Embedding is prompt-sensitive: retrieval queries need its
`Instruct: … \nQuery: …` format; our symmetric classification use (plain
document encode) is the correct no-prompt path. embeddinggemma-2 being
multimodal (text/image/video/audio) is spare capacity here — we only use
its text tower, but it leaves a door open for scoring post media later.

Swap with `INTENT_EMBED_MODEL=<id>` (train.py and serve.py must match —
serve.py refuses to start on drift). `python3 benchmark.py` trains the
same head over the same data/split for every candidate and writes
`model/ab-benchmark.json`: the defensible answer is the measured table on
OUR task, not a leaderboard citation. Small-holdout caveat: treat
precision@k gaps below ~0.05 as ties.

## Pipeline

| Step | Command | Needs | Output |
| --- | --- | --- | --- |
| 1. collect | `python3 collect.py` | `SCRAPER_API_KEY`, stdlib only | `data/posts.jsonl` |
| 2. label | `python3 label.py --limit 50` | `MULERUN_API_KEY` (LLM teacher) | `data/labeled.jsonl` |
| 3. train | `python3 train.py` | `pip install -r requirements.txt` | `model/head.pt` + `model/metrics.json` |
| 4. serve | `python3 serve.py` | same env as train | HTTP on `127.0.0.1:5019` |

Env keys are read from the environment (or copy them out of the app's
`.env` / `.dev.vars`).

## Wire it into the app

Set `INTENT_SERVICE_URL=http://127.0.0.1:5019` in the app's `.env`, restart
`pnpm dev` — lead search now batch-scores every result page and shows the
score badge. Unset / sidecar down ⇒ scores are silently omitted, nothing
breaks.

## Data hygiene (be ready to defend this)

- Training targets are LLM teacher labels (distillation); hand-check 20–30
  before quoting metrics — label.py output prints everything for review.
- `intent/` and `noise/` buckets both feed the trainer; collect.py tags
  each row with its `source_query` so leakage and query bias are auditable.
- `data/` and `model/` are gitignored artifacts; the repo carries the code
  and the metrics JSON, not the weights.
- Holdout is stratified by class; `precision@5/@10` is the headline number
  because the product only shows the top of the queue.

## Machine notes

- 16GB MacBook: CPU torch works (embedding 100–200 posts is the slow part,
  a few minutes). AutoDL single 4090 is overkill but fine; don't rent
  multi-GPU for a 64-unit head.
- First `train.py` run downloads the embedder from HuggingFace:
  ~1.5GB for embeddinggemma-2 (740M), ~600MB for the 300m, ~1.2GB for
  Qwen3-0.6B.
