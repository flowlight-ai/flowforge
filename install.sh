#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# FlowForge 一键安装（TS 栈，P1 主入口）
# 入口已从 Python 栈切换为 TS 栈（阶段10 入口切换，30-stage10-cutover.md T10.1）
# 旧 Python 栈进入日落冻结前置（T10.2），本脚本不再安装 Python 依赖。

echo "============================================================"
echo "  FlowForge install (TS stack)"
echo "============================================================"

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] node not found (18+, recommend 22+)"
    exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "[ERROR] pnpm not found, run: npm i -g pnpm"
    exit 1
fi

echo "[1/3] install TS deps (pnpm install)..."
pnpm install

echo "[2/3] typecheck (tsc -b)..."
pnpm typecheck || echo "[WARN] typecheck failed; you may still start."

echo "[3/3] build (tsdown)..."
pnpm build

echo "Done! Run ./start.sh to start FlowForge (TS stack)."