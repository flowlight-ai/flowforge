"""Quick E2E test: real LLM call via openroute."""
import urllib.request, json, time, sys

BASE = "http://127.0.0.1:8002"

def create_task(task, persona="default", model="openroute/DeepSeek-V4-Pro"):
    data = json.dumps({"task": task, "persona": persona, "mode": "helm", "model": model}).encode()
    req = urllib.request.Request(f"{BASE}/api/v1/tasks", data=data, headers={"Content-Type": "application/json"})
    r = urllib.request.urlopen(req, timeout=30)
    return json.loads(r.read().decode())["data"]

def wait_task(task_id, timeout=300):
    for i in range(timeout // 5):
        time.sleep(5)
        try:
            r = urllib.request.urlopen(f"{BASE}/api/v1/tasks/{task_id}", timeout=10)
            d = json.loads(r.read().decode())["data"]
            s = d.get("status", "")
            if i % 6 == 0:
                print(f"  [{i*5}s] status={s}")
            if s in ("completed", "failed", "error", "rejected"):
                return d
        except Exception as e:
            print(f"  [{i*5}s] error: {e}")
    return None

results = []

# Test 1: Simple chat
print("=" * 60)
print("Test 1: Simple chat (openroute/DeepSeek-V4-Pro)")
print("=" * 60)
t1 = create_task("你好，请用一句话介绍自己", "default", "openroute/DeepSeek-V4-Pro")
tid1 = t1["task_id"]
print(f"Task ID: {tid1}")
r1 = wait_task(tid1)
if r1:
    print(f"Status: {r1['status']}")
    if r1.get("summary"):
        print(f"Summary: {r1['summary'][:200]}")
    if r1.get("error"):
        print(f"Error: {r1['error'][:300]}")
    passed = r1["status"] == "completed"
    results.append(("Simple chat", passed))
    print("PASS" if passed else f"FAIL: expected completed, got {r1['status']}")
else:
    results.append(("Simple chat", False))
    print("FAIL: timeout")

# Test 2: OpenRouter free model
print("\n" + "=" * 60)
print("Test 2: OpenRouter free model (moonshotai/kimi-k2.6:free)")
print("=" * 60)
try:
    t2 = create_task("What is 2+2? Answer briefly.", "default", "moonshotai/kimi-k2.6:free")
    tid2 = t2["task_id"]
    print(f"Task ID: {tid2}")
    r2 = wait_task(tid2)
    if r2:
        print(f"Status: {r2['status']}")
        if r2.get("summary"):
            print(f"Summary: {r2['summary'][:200]}")
        if r2.get("error"):
            print(f"Error: {r2['error'][:300]}")
        passed = r2["status"] == "completed"
        results.append(("OpenRouter free", passed))
        print("PASS" if passed else f"FAIL: expected completed, got {r2['status']}")
    else:
        results.append(("OpenRouter free", False))
        print("FAIL: timeout")
except Exception as e:
    results.append(("OpenRouter free", False))
    print(f"FAIL: {e}")

# Summary
print("\n" + "=" * 60)
print("E2E Test Summary")
print("=" * 60)
for name, passed in results:
    print(f"  {'PASS' if passed else 'FAIL'}: {name}")
total = len(results)
passed_count = sum(1 for _, p in results if p)
print(f"\nTotal: {passed_count}/{total} passed")
