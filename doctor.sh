#!/usr/bin/env bash
# FlowForge doctor (TS 栈) — 运行 ./mgr status 与 tsc 类型检查作为环境自检。
set -e
cd "$(dirname "$0")"

echo "== TS 栈环境自检 =="
node --version
pnpm --version

echo "== 依赖状态 =="
if [ ! -d "node_modules" ]; then
    echo "[WARN] node_modules not found; run ./install.sh"
fi

echo "== 类型检查 =="
pnpm typecheck || echo "[WARN] typecheck failed"

echo "== git 状态 =="
./mgr status