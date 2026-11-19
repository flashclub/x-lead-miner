#!/bin/bash
# ============================================================================
# sync-from-monoboard.sh — 把 monoboard 开发目录的改动同步到本仓库并自动部署
#
# 用法（在 monoboard 改完代码后执行）：
#   ./sync-from-monoboard.sh                    # 默认提交信息
#   ./sync-from-monoboard.sh "feat: xxx"        # 自定义提交信息
#
# 机制：
#   1. rsync monoboard/apps/x-lead-miner → 本仓库（排除构建产物/密钥/数据）
#   2. git commit + push
#   3. push 自动触发 GitHub Actions：CI 构建 → 部署 Cloudflare Workers
#      （构建永远在 GitHub 免费 runner 上，本地零构建）
#
# 永不从 monoboard 覆盖的本仓库独有文件（线上打分与部署配置所在地）：
#   wrangler.jsonc / src/lib/intent.ts / src/lib/intent-head-weights.json
# 这三个文件请在【本仓库】直接修改。
# ============================================================================
set -e

SRC="${X_LEAD_SRC:-/Users/deepmac/Documents/code/monoboard/apps/x-lead-miner}"
DST="$(cd "$(dirname "$0")/.." && pwd)"
MSG="${1:-chore: sync from monoboard dev}"

if [ ! -d "$SRC" ]; then
  echo "错误: monoboard 源目录不存在: $SRC"
  exit 1
fi

# rsync 同步；--delete 清理多余文件，但 exclude 的路径受保护不被删除
rsync -a --delete \
  --exclude node_modules/ \
  --exclude .next/ \
  --exclude .open-next/ \
  --exclude .wrangler/ \
  --exclude .git/ \
  --exclude .venv/ \
  --exclude ".env" \
  --exclude ".dev.vars" \
  --exclude tsconfig.tsbuildinfo \
  --exclude "*.log" \
  --exclude "intent/.venv/" \
  --exclude "intent/data/" \
  --exclude "intent/model/" \
  --exclude "intent/model_bge/" \
  --exclude "intent/model_v2/" \
  --exclude "intent/model.v1-undertrained/" \
  --exclude "intent/__pycache__/" \
  --exclude "wrangler.jsonc" \
  --exclude "src/lib/intent.ts" \
  --exclude "src/lib/intent-head-weights.json" \
  "$SRC/" "$DST/"

cd "$DST"
git add -A
if git diff --cached --quiet; then
  echo "无改动，无需同步。"
  exit 0
fi

git commit -m "$MSG"
git push origin main

RUN_URL=$(gh run list --repo flashclub/x-lead-miner --workflow deploy.yml \
  --limit 1 --json url --jq '.[0].url' 2>/dev/null || true)
echo ""
echo "✅ 已同步并推送，CI/部署运行中: ${RUN_URL:-https://github.com/flashclub/x-lead-miner/actions}"
echo "   预计 ~2 分钟后线上更新。"
