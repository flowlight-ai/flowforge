#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo "============================================================"
echo "  FlowForge install"
echo "============================================================"

if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERROR] python3 not found"
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] node not found"
    exit 1
fi

echo "[1/3] doctor..."
python3 scripts/doctor.py

echo "[2/3] install_all..."
python3 scripts/install_all.py --all --npm-registry https://registry.npmmirror.com

echo "[3/3] verify..."
python3 scripts/doctor.py

echo "Done! Run ./start.sh"
