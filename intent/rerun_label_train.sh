#!/bin/bash
cd "$(dirname "$0")"
export AIAPIKEY_KEY=$(grep '^AIAPIKEY_KEY=' ../.env | cut -d= -f2)
export MULERUN_API_KEY=$(grep '^MULERUN_API_KEY=' ../.env | cut -d= -f2)
POSTS=$(wc -l < data/posts_10k.jsonl | tr -d ' ')
echo "[rerun] target: label all $POSTS posts (2 workers, no-drop retry)"
PASS=0
MAX_PASS=5
ACCEPT=$((POSTS - 20))   # 容忍≤20条永久无法标注的钉子户
while true; do
  PASS=$((PASS+1))
  LABELED=$(wc -l < data/labeled_10k.jsonl 2>/dev/null | tr -d ' ')
  echo "[rerun] pass $PASS: labeled=$LABELED / $POSTS at $(date)"
  if [ "$LABELED" -ge "$ACCEPT" ] || [ "$PASS" -ge "$MAX_PASS" ]; then break; fi
  sleep 2
  .venv/bin/python label.py --in data/posts_10k.jsonl --out data/labeled_10k.jsonl --workers 2 --max-tokens 2000
done
echo "[rerun] labeling complete: $LABELED / $POSTS at $(date)"
echo "[rerun] training -> model_v2 (encoding 10k posts is the slow part)..."
.venv/bin/python train.py --data data/labeled_10k.jsonl --out model_v2
echo "[rerun] training done at $(date)"
