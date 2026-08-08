#!/usr/bin/env bash
# Start protocol-conversion proxies (gemini/anthropic/responses -> OpenRoute).
# Each proxy listens on 127.0.0.1:<port> and forwards to local OpenRoute gateway (13001).
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs
PY=.venv/bin/python

# OpenRoute gateway must be running (hiclaw openroute, port 13001).
if ! curl -s -m 3 http://127.0.0.1:13001/v1/models >/dev/null 2>&1; then
    echo "ERROR: OpenRoute gateway not reachable on 127.0.0.1:13001" >&2
    exit 1
fi

start_one() {
    local name="$1" file="$2" port="$3"
    if curl -s -m 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
        echo "OK: ${name} already running on ${port}"
        return 0
    fi
    setsid "$PY" "${file}" --port "${port}" > "logs/${name}_proxy.log" 2>&1 < /dev/null &
    disown || true
    echo "started: ${name} on ${port} (log: logs/${name}_proxy.log)"
}

start_one gemini   forgemind/gemini_to_openroute_proxy.py      8082
start_one anthropic forgemind/anthropic_to_openroute_proxy.py  8083
start_one responses forgemind/responses_to_openroute_proxy.py  8084

sleep 3
echo "--- status ---"
for port in 8082 8083 8084; do
    if curl -s -m 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
        echo "OK: ${port} healthy"
    else
        echo "WARN: ${port} NOT healthy"
    fi
done
