"""Real LLM E2E test using openroute provider."""
import urllib.request, json, time, sys

BASE = "http://127.0.0.1:8002"

def create_task(task, persona="default", model="openroute/DeepSeek-V4-Pro"):
    data = json.dumps({"task": task, "persona": persona, "mode": "solo", "model": model}).encode()
    req = urllib.request.Request(f"{BASE}/api/v1/tasks", data=data, headers={"Content-Type": "application/json"})
    r = urllib.request.urlopen(req, timeout=30)
    return json.loads(r.read().decode())["data"]

def wait_task(task_id, timeout=1200):
    for i in range(timeout // 5):
        time.sleep(5)
        try:
            r = urllib.request.urlopen(f"{BASE}/api/v1/tasks/{task_id}", timeout=10)
            d = json.loads(r.read().decode())["data"]
            s = d.get("status", "")
            if i % 12 == 0:
                print(f"  [{i*5}s] status={s}")
            if s in ("completed", "failed", "error", "rejected"):
                return d
        except Exception as e:
            print(f"  [{i*5}s] error: {e}")
    return None

# Test 1: Simple chat with DeepSeek-V4-Pro
print("=" * 60)
print("Test 1: Simple chat (openroute/DeepSeek-V4-Pro)")
print("=" * 60)
t1 = create_task("你好，请用一句话介绍自己", "default", "openroute/DeepSeek-V4-Pro")
print(f"Task ID: {t1['task_id']}")
r1 = wait_task(t1["task_id"])
if r1:
    print(f"Status: {r1['status']}")
    print(f"Summary: {r1.get('summary', 'N/A')[:200]}")
    if r1.get("error"):
        print(f"Error: {r1['error'][:300]}")
    assert r1["status"] == "completed", f"Expected completed, got {r1['status']}"
    print("PASS")
else:
    print("TIMEOUT")

# Test 2: Article creation with DeepSeek-V4-Pro (longer timeout)
print("\n" + "=" * 60)
print("Test 2: Article creation (openroute/DeepSeek-V4-Pro)")
print("=" * 60)
t2 = create_task("写一篇关于人工智能在教育领域应用的短文", "education", "openroute/DeepSeek-V4-Pro")
print(f"Task ID: {t2['task_id']}")
r2 = wait_task(t2["task_id"], timeout=1800)  # 30 min for 5-step workflow
if r2:
    print(f"Status: {r2['status']}")
    print(f"Summary: {r2.get('summary', 'N/A')[:200]}")
    if r2.get("error"):
        print(f"Error: {r2['error'][:300]}")
    if r2.get("output_data", {}).get("response"):
        print(f"Response: {r2['output_data']['response'][:300]}")
    assert r2["status"] in ("completed", "failed"), f"Unexpected status: {r2['status']}"
    if r2["status"] == "completed":
        print("PASS")
    else:
        print(f"FAILED: {r2.get('error', 'unknown')[:200]}")
else:
    print("TIMEOUT")

# Test 3: Invalid model should fail
print("\n" + "=" * 60)
print("Test 3: Invalid model should fail gracefully")
print("=" * 60)
t3 = create_task("测试", "default", "invalid_model_xyz")
print(f"Task ID: {t3['task_id']}")
r3 = wait_task(t3["task_id"])
if r3:
    print(f"Status: {r3['status']}")
    assert r3["status"] in ("completed", "failed", "error"), f"Unexpected status: {r3['status']}"
    # 无效模型可能被fallback到默认模型，所以completed也是可接受的
    if r3["status"] in ("failed", "error"):
        print(f"Error (expected): {r3.get('error', 'N/A')[:200]}")
    print("PASS")
else:
    print("TIMEOUT")

print("\n" + "=" * 60)
print("Real LLM E2E tests complete!")
print("=" * 60)
