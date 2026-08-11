#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
    echo "[ERROR] .venv not found, run ./install.sh first"
    exit 1
fi

echo "============================================================"
echo "  FlowForge start"
echo "  frontend: http://localhost:5174"
echo "  backend:  http://localhost:8000"
echo "============================================================"

python3 scripts/start_all.py
