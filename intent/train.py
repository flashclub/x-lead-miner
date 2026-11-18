"""Step 3 — train the intent head in PyTorch.

Architecture: frozen sentence embeddings -> small MLP classification head
trained with BCEWithLogitsLoss. The transformer stays frozen on purpose:
the trainable part is tiny, trains in seconds on CPU, and the interview
story is the pipeline and the metrics, not a fine-tuned transformer.

Model choice: default is google/embeddinggemma-2 (2026-10, Apache-2.0,
740M, 768-dim, multimodal, on-device). Prior-gen reference:
google/embeddinggemma-300m (2025-09); multilingual stretch:
Qwen/Qwen3-Embedding-0.6B (2025-06, Apache-2.0). intent/benchmark.py
compares the candidates on OUR task — run it instead of arguing from the
leaderboard.

Usage:
    python3 train.py                                  # default model
    INTENT_EMBED_MODEL=Qwen/Qwen3-Embedding-0.6B python3 train.py
"""

import json
import os
import random
from pathlib import Path

import torch
from torch import nn
from sentence_transformers import SentenceTransformer

BASE = Path(__file__).parent
DATA = BASE / "data" / "labeled.jsonl"
OUT = BASE / "model"
import argparse

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(DATA))
    ap.add_argument("--out", default=str(OUT))
    return ap.parse_args()
# Swap via env; must match serve.py (same embedding space + head input dim).
EMBED_MODEL = os.environ.get("INTENT_EMBED_MODEL", "google/embeddinggemma-2")
HIDDEN = 64
# Full-batch × 30 epochs = 30 gradient steps, which left the head near its
# random init (all sigmoid outputs 0.25–0.40, accuracy = majority baseline).
# Mini-batches + early stopping give the tiny head enough steps to fit.
EPOCHS = 200  # cap — early stopping usually ends sooner
BATCH = 16
PATIENCE = 20  # stop after this many epochs without val-loss improvement
SEED = 7


def load_rows_from(data_path: Path) -> tuple[list[str], list[int]]:
    rows = []
    with open(data_path, encoding="utf-8") as fh:  # \n-only: see label.py U+2028 note
        for line in fh:
            line = line.rstrip("\n")
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    # label.py appends across resume runs — dedupe by id so one post can
    # never land in both the train and val splits.
    seen: set[str] = set()
    pairs = []
    for row in rows:
        row_id = str(row.get("id"))
        if row_id in seen:
            continue
        seen.add(row_id)
        if (
            row.get("label")
            and isinstance(row["label"].get("intent"), bool)
            and len(row["text"]) >= 20
        ):
            pairs.append((row["text"], 1 if row["label"]["intent"] else 0))
    texts = [p[0] for p in pairs]
    labels = [p[1] for p in pairs]
    return texts, labels


def stratified_split(labels: list[int], frac: float = 0.15) -> tuple[list[int], list[int], list[int]]:
    """Stratified three-way split: train / val (early stopping) / test (final report).

    The test split is never seen by early stopping or model selection.
    """
    random.seed(SEED)
    by_class: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        by_class.setdefault(label, []).append(index)
    val: set[int] = set()
    test: set[int] = set()
    for indices in by_class.values():
        random.shuffle(indices)
        n_val = max(1, int(len(indices) * frac))
        val.update(indices[:n_val])
        test.update(indices[n_val : n_val * 2])
    train = [i for i in range(len(labels)) if i not in val and i not in test]
    return train, sorted(val), sorted(test)


def build_head(dim: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Linear(dim, HIDDEN),
        nn.ReLU(),
        nn.Dropout(0.2),
        nn.Linear(HIDDEN, 1),
    )


def run_training(
    embedder: SentenceTransformer, texts: list[str], labels: list[int], quiet: bool = False
) -> tuple[nn.Sequential, dict]:
    """Embed + train + evaluate with a fixed seed. Shared by train.py and
    benchmark.py so every candidate sees identical data and splits.
    Returns (trained head, metrics without the model name)."""
    train_idx, val_idx, test_idx = stratified_split(labels)
    y = torch.tensor(labels, dtype=torch.float32)

    features = torch.tensor(embedder.encode(texts, normalize_embeddings=True))
    x_train, y_train = features[train_idx], y[train_idx]
    x_val, y_val = features[val_idx], y[val_idx]
    x_test, y_test = features[test_idx], y[test_idx]

    torch.manual_seed(SEED)
    head = build_head(embedder.get_sentence_embedding_dimension())
    optimizer = torch.optim.Adam(head.parameters(), lr=1e-3)
    loss_fn = nn.BCEWithLogitsLoss()

    generator = torch.Generator().manual_seed(SEED)
    best_val_loss = float("inf")
    best_state: dict[str, torch.Tensor] | None = None
    stale = 0
    epoch = 0
    for epoch in range(EPOCHS):
        head.train()
        perm = torch.randperm(len(x_train), generator=generator)
        for start in range(0, len(perm), BATCH):
            batch = perm[start : start + BATCH]
            optimizer.zero_grad()
            loss = loss_fn(head(x_train[batch]).squeeze(-1), y_train[batch])
            loss.backward()
            optimizer.step()

        head.eval()
        with torch.no_grad():
            val_loss = float(loss_fn(head(x_val).squeeze(-1), y_val))
        if val_loss < best_val_loss - 1e-4:
            best_val_loss = val_loss
            best_state = {k: v.detach().clone() for k, v in head.state_dict().items()}
            stale = 0
        else:
            stale += 1
            if stale >= PATIENCE:
                break
        if not quiet and ((epoch + 1) % 20 == 0 or epoch == 0):
            print(f"  epoch {epoch + 1:>3}  train_loss {loss.item():.4f}  val_loss {val_loss:.4f}")

    if best_state is not None:
        head.load_state_dict(best_state)
    head.eval()
    with torch.no_grad():
        val_scores = torch.sigmoid(head(x_val).squeeze(-1))
        test_scores = torch.sigmoid(head(x_test).squeeze(-1))

    def precision_at_k(scores: torch.Tensor, ys: torch.Tensor, k: int) -> float:
        k = min(k, scores.numel())
        top = torch.argsort(scores, descending=True)[:k]
        return float(ys[top].float().mean())

    metrics = {
        "dim": embedder.get_sentence_embedding_dimension(),
        "n_train": len(train_idx),
        "n_val": len(val_idx),
        "n_test": len(test_idx),
        "val_precision_at_5": precision_at_k(val_scores, y_val, 5),
        "val_precision_at_10": precision_at_k(val_scores, y_val, 10),
        "val_accuracy_at_0.5": float(((val_scores > 0.5) == y_val.bool()).float().mean()),
        "test_precision_at_5": precision_at_k(test_scores, y_test, 5),
        "test_precision_at_10": precision_at_k(test_scores, y_test, 10),
        "test_accuracy_at_0.5": float(((test_scores > 0.5) == y_test.bool()).float().mean()),
        "epochs_run": epoch + 1,
    }
    return head, metrics


def main() -> None:
    args = parse_args()
    data_path = Path(args.data)
    if not data_path.exists():
        raise SystemExit(f"no labeled data at {data_path} — run collect.py then label.py first")
    texts, labels = load_rows_from(data_path)
    positives = sum(labels)
    if len(texts) < 40 or positives < 8 or len(texts) - positives < 8:
        raise SystemExit(
            f"dataset too small to train honestly ({len(texts)} rows, {positives} intent). "
            "Collect/label more posts first — a real eval needs both classes."
        )

    print(f"dataset: {len(texts)} posts ({positives} intent / {len(texts) - positives} noise)")
    print(f"embedder: {EMBED_MODEL} (frozen)")
    # CPU on purpose: torch 2.15's MPS backend crashes in dyld on the Gemma4
    # architecture (verified 2026-11-16); the product story is a CPU sidecar.
    # fp32 on purpose: M1 CPU has no fast bf16 path — bf16 emulation was ~20x
    # slower in practice (verified 2026-11-16, 169 posts took >20min vs
    # ~2min in fp32).
    embedder = SentenceTransformer(
        EMBED_MODEL, device="cpu", model_kwargs={"dtype": torch.float32}
    )
    head, metrics = run_training(embedder, texts, labels)
    metrics.update(
        {
            "model": f"{EMBED_MODEL} (frozen) + MLP {metrics['dim']}-{HIDDEN}-1",
            "n_intent": positives,
            "epochs": metrics.pop("epochs_run"),
            "trained_with_seed": SEED,
        }
    )

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    torch.save(head.state_dict(), out_dir / "head.pt")
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(
        f"\nval  precision@5 {metrics['val_precision_at_5']:.2f}  "
        f"precision@10 {metrics['val_precision_at_10']:.2f}  "
        f"accuracy {metrics['val_accuracy_at_0.5']:.2f}"
    )
    print(
        f"test precision@5 {metrics['test_precision_at_5']:.2f}  "
        f"precision@10 {metrics['test_precision_at_10']:.2f}  "
        f"accuracy {metrics['test_accuracy_at_0.5']:.2f}"
    )
    print(f"saved {out_dir / 'head.pt'} and metrics.json — next: python3 serve.py")


if __name__ == "__main__":
    main()
