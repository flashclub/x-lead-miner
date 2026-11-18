"""A/B embedders on OUR task — the answer to "why this model?".

Trains the identical head over identical data and splits for each
candidate embedder, then reports precision@k and encode time side by
side. MTEB tells you what is generally good; this tells you what is
good HERE. Saves model/ab-benchmark.json for the Intent Lab page.

Usage:
    python3 benchmark.py                 # all candidates
    python3 benchmark.py --quick         # skip the 0.6B heavy model
"""

import argparse
import json
import time
from pathlib import Path

from sentence_transformers import SentenceTransformer

from train import HIDDEN, EPOCHS, SEED, load_rows_from, run_training

BASE = Path(__file__).parent
OUT = BASE / "model"

# Candidates: (model_id, note, heavy). Google's on-device line across two
# generations plus Alibaba's multilingual stretch. --quick skips heavy
# models (slow on CPU). Every candidate must be a sentence-transformers
# model id.
#
# Qwen3-Embedding prompt-sensitivity (verified community feedback + model
# card): retrieval QUERIES need the "Instruct: ... \nQuery: ..." format or
# quality drops hard. Our use is symmetric document embedding for
# classification — plain encode of the post text is the correct usage here,
# which is what run_training does.
CANDIDATES = [
    ("google/embeddinggemma-2", "2026-10 · 740M · Apache-2.0 · multimodal", False),
    ("google/embeddinggemma-300m", "2025-09 prior gen · 308M · fastest", False),
    ("Qwen/Qwen3-Embedding-0.6B", "2025-06 multilingual SOTA · Apache-2.0", True),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quick", action="store_true", help="skip heavy (0.5B+) candidates")
    args = parser.parse_args()

    texts, labels = load_rows_from(Path(__file__).parent / 'data' / 'labeled.jsonl')
    positives = sum(labels)
    if len(texts) < 40 or positives < 8 or len(texts) - positives < 8:
        raise SystemExit(
            f"dataset too small for a meaningful A/B ({len(texts)} rows, {positives} intent)"
        )
    print(f"A/B over {len(texts)} posts ({positives} intent) · head MLP-?-{HIDDEN}-1 · "
          f"epochs {EPOCHS} · seed {SEED}\n")

    results = []
    for model_id, note, heavy in CANDIDATES:
        if args.quick and heavy:
            print(f"skip  {model_id} (--quick)")
            continue
        print(f"== {model_id}  ({note})")
        try:
            started = time.perf_counter()
            embedder = SentenceTransformer(model_id)
            load_seconds = time.perf_counter() - started

            encode_started = time.perf_counter()
            # encode once dry to time it, run_training encodes again internally
            embedder.encode(texts[:32], normalize_embeddings=True)
            encode_seconds = time.perf_counter() - encode_started

            head, metrics = run_training(embedder, texts, labels, quiet=True)
            row = {
                "model": model_id,
                "note": note,
                "dim": metrics["dim"],
                "load_seconds": round(load_seconds, 1),
                "encode_32_posts_seconds": round(encode_seconds, 2),
                "val_precision_at_5": metrics["val_precision_at_5"],
                "val_precision_at_10": metrics["val_precision_at_10"],
                "val_accuracy_at_0.5": metrics["val_accuracy_at_0.5"],
            }
            results.append(row)
            print(
                f"   precision@5 {row['val_precision_at_5']:.2f}  "
                f"@10 {row['val_precision_at_10']:.2f}  "
                f"acc {row['val_accuracy_at_0.5']:.2f}  "
                f"dim {row['dim']}  encode32 {row['encode_32_posts_seconds']}s\n"
            )
        except Exception as exc:
            print(f"   FAILED: {exc}\n")

    if not results:
        raise SystemExit("all candidates failed — check requirements/pip install")

    results.sort(key=lambda row: row["val_precision_at_5"], reverse=True)
    print("== ranking by val precision@5 (small holdout — treat gaps <0.05 as ties)")
    for index, row in enumerate(results, 1):
        print(f"  {index}. {row['model']}  p@5 {row['val_precision_at_5']:.2f}")

    OUT.mkdir(exist_ok=True)
    payload = {
        "dataset_posts": len(texts),
        "n_intent": positives,
        "epochs": EPOCHS,
        "seed": SEED,
        "candidates": results,
    }
    (OUT / "ab-benchmark.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(f"\nsaved {OUT / 'ab-benchmark.json'}")


if __name__ == "__main__":
    main()
