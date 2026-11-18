#!/bin/bash
# 10k pipeline: wait for collection -> parallel labeling -> training
cd /Users/deepmac/Documents/code/monoboard/apps/x-lead-miner/intent
echo "[pipeline] waiting for collector (pid 25156)..."
while kill -0 25156 2>/dev/null; do sleep 30; done
echo "[pipeline] collection done at $(date)"

export SCRAPER_API_KEY=$(grep '^SCRAPER_API_KEY=' ../.env | cut -d= -f2)
export MULERUN_API_KEY=$(grep '^MULERUN_API_KEY=' ../.env | cut -d= -f2)

echo "[pipeline] labeling with 4 workers..."
.venv/bin/python label.py --in data/posts_10k.jsonl --out data/labeled_10k.jsonl --workers 4
echo "[pipeline] labeling done at $(date)"

echo "[pipeline] training on labeled_10k -> model_v2 (encoding is the slow part)..."
.venv/bin/python train.py --data data/labeled_10k.jsonl --out model_v2
echo "[pipeline] training done at $(date)"
echo "[pipeline] ALL DONE — review model_v2/metrics.json then swap into serve.py"
