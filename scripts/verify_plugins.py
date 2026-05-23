"""Verify plugin loading and real tool calls via PluginRegistry."""
import requests
import json

BASE = "http://127.0.0.1:8000/api/v1"

# 1. Check plugins loaded
print("=== Plugin Loading Check ===")
r = requests.get(f"{BASE}/plugins")
data = r.json()
# API wraps in {status, data: {plugins, total}}
plugins = data.get("data", {}).get("plugins", [])
print(f"Plugins loaded: {len(plugins)}")
for p in plugins:
    name = p.get("name", "?")
    transport = p.get("transport", "?")
    status = p.get("status", "?")
    print(f"  {name} [{transport}] state={status}")

# 2. Check openroute health
print("\n=== OpenRoute Health ===")
try:
    r2 = requests.get(f"{BASE}/plugins/openroute/health", timeout=5)
    print(f"Status: {r2.status_code}")
    print(f"Response: {json.dumps(r2.json(), indent=2, ensure_ascii=False)[:300]}")
except Exception as e:
    print(f"Error: {e}")

# 3. Check opensieve health
print("\n=== OpenSieve Health ===")
try:
    r3 = requests.get(f"{BASE}/plugins/opensieve_search/health", timeout=5)
    print(f"Status: {r3.status_code}")
    print(f"Response: {json.dumps(r3.json(), indent=2, ensure_ascii=False)[:300]}")
except Exception as e:
    print(f"Error: {e}")

# 4. Start openroute and test
print("\n=== OpenRoute Start & Chat Test ===")
try:
    r4 = requests.post(f"{BASE}/openroute/start", timeout=60)
    print(f"Start result: {json.dumps(r4.json(), indent=2, ensure_ascii=False)[:300]}")
except Exception as e:
    print(f"Error: {e}")

# 5. Test opensieve search via PluginRegistry
print("\n=== OpenSieve Search Test ===")
try:
    r5 = requests.post(f"{BASE}/plugins/opensieve_search/execute",
                       json={"params": {"query": "AI technology news"}},
                       timeout=30)
    print(f"Status: {r5.status_code}")
    result = r5.json()
    # Truncate results for display
    if "results" in result:
        count = len(result["results"])
        print(f"Found {count} results")
    else:
        print(f"Response: {json.dumps(result, indent=2, ensure_ascii=False)[:300]}")
except Exception as e:
    print(f"Error: {e}")

# 6. Test solo task with real model
print("\n=== Solo Task with Real Model ===")
try:
    r6 = requests.post(f"{BASE}/tasks", json={
        "query": "Hello, please introduce yourself briefly",
        "mode": "solo",
        "persona": "default",
    })
    task = r6.json()
    task_id = task.get("data", {}).get("task_id", "")
    print(f"Task created: {task_id}")
except Exception as e:
    print(f"Error: {e}")
