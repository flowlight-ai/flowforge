#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# FlowForge 一键启动（TS 版，P1 主入口）
# 入口已从 Python 栈切换为 TS 栈（阶段10 入口切换，30-stage10-cutover.md T10.1）
# 旧 Python 栈进入日落冻结前置（T10.2），回退步骤见 README "Python 旧版回退" 章节。

if [ ! -d "node_modules" ]; then
    echo "[ERROR] dependencies not installed, run ./install.sh first (pnpm install)"
    exit 1
fi

if [ ! -f "apps/cli/src/bin.ts" ]; then
    echo "[ERROR] TS CLI entry apps/cli/src/bin.ts not found"
    exit 1
fi

echo "============================================================"
echo "  FlowForge start (TS stack)"
echo "  assembled by flowforge CLI (web profile serves frontend & API)"
echo "============================================================"
echo "[DEPRECATED] legacy Python stack is frozen; see README 'Python legacy rollback'."
echo

exec pnpm start