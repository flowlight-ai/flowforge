"""Verify plugin execute endpoint and OpenRoute real model call."""
import requests
import json
import time

BASE = "http://127.0.0.1:8000/api/v1"

# 1. Start OpenRoute
print("=== Starting OpenRoute ===")
try:
    r = requests.post(BASE + "/openroute/start", timeout=60)
    print(json.dumps(r.json(), indent=2, ensure_ascii=False)[:300])
except Exception as e:
    print(f"Error: {e}")

# 2. Wait and check health
time.sleep(5)
print("\n=== Plugin Health Check ===")
for name in ["openroute", "opensieve_search"]:
    try:
        r2 = requests.get(f"{BASE}/plugins/{name}/health", timeout=10)
        data = r2.json().get("data", {})
        print(f"  {name}: state={data.get('state', '?')} msg={data.get('message', '')[:80]}")
    except Exception as e:
        print(f"  {name}: error={e}")

# 3. Test plugin execute endpoint with cache tool
print("\n=== Test Plugin Execute (cache) ===")
try:
    r3 = requests.post(f"{BASE}/plugins/cache/execute",
                       json={"params": {"key": "test_key", "action": "set", "value": {"msg": "hello"}}},
                       timeout=10)
    print(f"  SET: {json.dumps(r3.json(), indent=2, ensure_ascii=False)[:200]}")
except Exception as e:
    print(f"  Error: {e}")

try:
    r4 = requests.post(f"{BASE}/plugins/cache/execute",
                       json={"params": {"key": "test_key", "action": "get"}},
                       timeout=10)
    print(f"  GET: {json.dumps(r4.json(), indent=2, ensure_ascii=False)[:200]}")
except Exception as e:
    print(f"  Error: {e}")

# 4. Test solo task with real model
print("\n=== Solo Task with Real Model ===")
try:
    r5 = requests.post(f"{BASE}/tasks", json={
        "query": "Hello, please introduce yourself briefly",
        "mode": "solo",
        "persona": "default",
    })
    task = r5.json()
    task_id = task.get("data", {}).get("task_id", "")
    print(f"  Task created: {task_id}")

    # Wait for completion
    time.sleep(30)
    r6 = requests.get(f"{BASE}/tasks/{task_id}")
    task_data = r6.json().get("data", {})
    print(f"  Status: {task_data.get('status', '?')}")
    result = str(task_data.get("result", ""))[:200]
    if result:
        print(f"  Result: {result}")
except Exception as e:
    print(f"  Error: {e}")
