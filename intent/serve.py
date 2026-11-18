"""Step 4 — serve intent scores over HTTP for the Next.js app.

FastAPI sidecar: loads the frozen embedder + trained head, exposes
POST /score {"texts": [...]} -> {"scores": [0..1], ...}. The Next.js
route reads INTENT_SERVICE_URL and calls it per search page; when the
sidecar is down or unset, scores are simply omitted.

IMPORTANT: must load the SAME embedder train.py trained with (env
INTENT_EMBED_MODEL, default google/embeddinggemma-2) — a mismatched
embedding space silently produces garbage scores. The startup check
below compares against model/metrics.json and refuses to serve on drift.

Usage:
    python3 serve.py          # http://127.0.0.1:5019
"""

import json
import os
import sys
import time
from pathlib import Path

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from torch import nn

BASE = Path(__file__).parent
MODEL_DIR = BASE / "model"
EMBED_MODEL = os.environ.get("INTENT_EMBED_MODEL", "google/embeddinggemma-2")
HIDDEN = 64

metrics_path = MODEL_DIR / "metrics.json"
if not (MODEL_DIR / "head.pt").exists() or not metrics_path.exists():
    sys.exit("no trained model in model/ — run train.py first")
trained_model = json.loads(metrics_path.read_text()).get("model", "")
if EMBED_MODEL not in trained_model:
    sys.exit(
        f"model mismatch: head was trained with '{trained_model}' but this service "
        f"would embed with '{EMBED_MODEL}'. Set INTENT_EMBED_MODEL to match."
    )

# CPU on purpose — matches training and avoids torch 2.15 MPS crashes on
# Gemma4 architectures; fp32 because M1 has no fast bf16 path (both
# verified 2026-11-16).
embedder = SentenceTransformer(
    EMBED_MODEL, device="cpu", model_kwargs={"dtype": torch.float32}
)
head = nn.Sequential(
    nn.Linear(embedder.get_sentence_embedding_dimension(), HIDDEN),
    nn.ReLU(),
    nn.Dropout(0.2),
    nn.Linear(HIDDEN, 1),
)
head.load_state_dict(torch.load(MODEL_DIR / "head.pt", map_location="cpu"))
head.eval()

app = FastAPI(title="x-lead-miner intent service")


class ScoreRequest(BaseModel):
    texts: list[str]
    per_item: bool = False  # score each text separately & report per-text latency


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "embedder": EMBED_MODEL,
        "head_trained": (MODEL_DIR / "head.pt").exists(),
    }


@app.post("/score")
def score(request: ScoreRequest) -> dict:
    t0 = time.perf_counter()
    times_sec: list[float] = []
    if request.per_item:
        # true per-post latency: encode each text individually
        scores = []
        for t in request.texts:
            t1 = time.perf_counter()
            with torch.no_grad():
                emb = torch.tensor(
                    embedder.encode([t[:1500]], normalize_embeddings=True)
                )
                scores.append(float(torch.sigmoid(head(emb)).item()))
            times_sec.append(round(time.perf_counter() - t1, 6))
    else:
        with torch.no_grad():
            features = torch.tensor(
                embedder.encode([t[:1500] for t in request.texts], normalize_embeddings=True)
            )
            logits = head(features).squeeze(-1)
            scores = torch.sigmoid(logits).tolist()
    return {
        "scores": [round(float(s), 4) for s in scores],
        "times_sec": times_sec,
        "model": EMBED_MODEL,
        "elapsed_sec": round(time.perf_counter() - t0, 6),
    }


if __name__ == "__main__":
    import uvicorn

    # Long keep-alive: uvicorn's default 5s idle close races with Next's
    # undici connection pool (verified 2026-11 — "other side closed" on
    # reused sockets dropped every score batch). 75s keeps conns warm.
    uvicorn.run(app, host="127.0.0.1", port=5019, timeout_keep_alive=75)
