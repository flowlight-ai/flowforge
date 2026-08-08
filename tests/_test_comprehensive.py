"""Comprehensive test: Phase 1 + Phase 2 Content API."""
import httpx
import time
import json
import sys

API = "http://localhost:8001"
KEY = "or-local"
headers = {"X-API-Key": KEY, "Content-Type": "application/json"}

passed = 0
failed = 0

def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS: {name}")
    else:
        failed += 1
        print(f"  FAIL: {name} - {detail}")

# ── Test 1: Health ──
print("\n=== Test 1: Health ===")
resp = httpx.get(f"{API}/health", timeout=5)
test("health endpoint", resp.status_code == 200)

# ── Test 2: Phase 1 Create (single mode) ──
print("\n=== Test 2: Phase 1 Create ===")
resp = httpx.post(f"{API}/api/v1/content/create", headers=headers, json={
    "system_prompt": "你是一位资深教育领域内容创作者。",
    "user_prompt": "写一段关于AI教育趋势的短评，约200字。",
    "persona": "education",
    "mode": "single",
    "options": {"polish": False},
}, timeout=30)
test("create returns 202", resp.status_code == 202)
data = resp.json()
task_id = data.get("data", {}).get("task_id", "")
test("create has task_id", bool(task_id))

if task_id:
    for i in range(20):
        time.sleep(3)
        try:
            resp = httpx.get(f"{API}/api/v1/content/tasks/{task_id}", headers=headers, timeout=10)
            if resp.status_code != 200:
                continue
            task_data = resp.json()
        except Exception:
            continue
        status = task_data.get("data", {}).get("status", "unknown")
        if status in ("completed", "error", "cancelled"):
            result = task_data.get("data", {}).get("result")
            error = task_data.get("data", {}).get("error")
            if result:
                content = result.get("content", "") if isinstance(result, dict) else getattr(result, "content", "")
                test("create has content", len(content) > 50, f"len={len(content)}")
            else:
                test("create has content", False, f"result is None, error={error}")
            break

# ── Test 3: Phase 1 Polish ──
print("\n=== Test 3: Phase 1 Polish ===")
resp = httpx.post(f"{API}/api/v1/content/polish", headers=headers, json={
    "system_prompt": "你是一位资深内容编辑。",
    "content": "人工智能正在改变教育。AI可以帮助老师批改作业，也可以帮助学生个性化学习。这是一个重要的趋势。",
    "persona": "education",
    "options": {"platform": "toutiao"},
}, timeout=30)
test("polish returns 202", resp.status_code == 202)
data = resp.json()
task_id = data.get("data", {}).get("task_id", "")
test("polish has task_id", bool(task_id))

if task_id:
    for i in range(20):
        time.sleep(3)
        try:
            resp = httpx.get(f"{API}/api/v1/content/tasks/{task_id}", headers=headers, timeout=10)
            if resp.status_code != 200:
                continue
            task_data = resp.json()
        except Exception:
            continue
        status = task_data.get("data", {}).get("status", "unknown")
        if status in ("completed", "error", "cancelled"):
            result = task_data.get("data", {}).get("result")
            if result:
                content = result.get("content", "") if isinstance(result, dict) else getattr(result, "content", "")
                test("polish has content", len(content) > 20, f"len={len(content)}")
            else:
                test("polish has content", False, "result is None")
            break

# ── Test 4: Phase 2 Pipeline (single mode, fast) ──
print("\n=== Test 4: Phase 2 Pipeline ===")
resp = httpx.post(f"{API}/api/v1/content/pipeline", headers=headers, json={
    "intent": "写一篇关于AI教育趋势的短文",
    "persona": "education",
    "options": {
        "creation_mode": "single",
        "word_count": 500,
        "include_images": False,
        "auto_publish": False,
    },
}, timeout=30)
test("pipeline returns 202", resp.status_code == 202)
data = resp.json()
task_id = data.get("data", {}).get("task_id", "")
test("pipeline has task_id", bool(task_id))

if task_id:
    for i in range(30):
        time.sleep(3)
        try:
            resp = httpx.get(f"{API}/api/v1/content/tasks/{task_id}", headers=headers, timeout=10)
            if resp.status_code != 200:
                continue
            task_data = resp.json()
        except Exception:
            continue
        status = task_data.get("data", {}).get("status", "unknown")
        if status in ("completed", "error", "cancelled"):
            result = task_data.get("data", {}).get("result")
            error = task_data.get("data", {}).get("error")
            if result and isinstance(result, dict):
                content = result.get("content", "")
                stages = result.get("stages", {})
                test("pipeline has content", len(content) > 50, f"len={len(content)}")
                test("pipeline has stages", len(stages) >= 3, f"stages={list(stages.keys())}")
                test("pipeline has topic stage", "topic" in stages)
                test("pipeline has create stage", "create" in stages)
                test("pipeline has polish stage", "polish" in stages)
            else:
                test("pipeline has content", False, f"result={result}, error={error}")
            break

# ── Test 5: FlowForge core APIs not affected ──
print("\n=== Test 5: FlowForge Core APIs ===")
resp = httpx.get(f"{API}/api/v1/modes", headers=headers, timeout=5)
test("modes endpoint", resp.status_code == 200)

resp = httpx.get(f"{API}/api/v1/agents", headers=headers, timeout=5)
test("agents endpoint", resp.status_code == 200)

resp = httpx.get(f"{API}/api/v1/personas", headers=headers, timeout=5)
test("personas endpoint", resp.status_code == 200)

# ── Test 6: Auth middleware ──
print("\n=== Test 6: Auth Middleware ===")
resp = httpx.post(f"{API}/api/v1/content/create", headers={"Content-Type": "application/json"}, json={
    "system_prompt": "test", "user_prompt": "test", "persona": "test",
}, timeout=5)
test("no API key returns 401", resp.status_code == 401)

# ── Test 7: Cancel task ──
print("\n=== Test 7: Cancel Task ===")
resp = httpx.post(f"{API}/api/v1/content/create", headers=headers, json={
    "system_prompt": "你是一位内容创作者。",
    "user_prompt": "写一篇长文章。",
    "persona": "education",
    "mode": "single",
    "options": {"polish": False},
}, timeout=30)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    resp = httpx.post(f"{API}/api/v1/content/tasks/{task_id}/cancel", headers=headers, timeout=5)
    test("cancel returns success", resp.status_code == 200)

# ── Summary ──
print(f"\n{'='*50}")
print(f"Results: {passed} passed, {failed} failed, {passed+failed} total")
sys.exit(0 if failed == 0 else 1)
