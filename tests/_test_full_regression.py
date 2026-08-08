"""Full regression test: Phase 1 + Phase 2 + FlowForge core."""
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

def wait_for_task(task_id, max_wait=300):
    """Poll task until terminal state, return task data."""
    for i in range(max_wait // 3):
        time.sleep(3)
        try:
            resp = httpx.get(f"{API}/api/v1/content/tasks/{task_id}", headers=headers, timeout=10)
            if resp.status_code != 200:
                continue
            task_data = resp.json()
            status = task_data.get("data", {}).get("status", "unknown")
            if status in ("completed", "error", "cancelled"):
                return task_data.get("data", {})
        except Exception:
            continue
    return None

# ── Test 1: Health ──
print("\n=== Test 1: Health ===")
resp = httpx.get(f"{API}/health", timeout=5)
test("health endpoint", resp.status_code == 200)

# ── Test 2: Phase 1 Create ──
print("\n=== Test 2: Phase 1 Create ===")
resp = httpx.post(f"{API}/api/v1/content/create", headers=headers, json={
    "system_prompt": "你是一位资深教育领域内容创作者。",
    "user_prompt": "写一段关于AI教育趋势的短评，约200字。",
    "persona": "education",
    "mode": "single",
    "options": {"polish": False},
}, timeout=60)
test("create returns 202", resp.status_code == 202)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    data = wait_for_task(task_id)
    if data:
        result = data.get("result", {})
        content = result.get("content", "") if isinstance(result, dict) else ""
        test("create has content", len(content) > 30, f"len={len(content)}")
    else:
        test("create has content", False, "timeout")

# ── Test 3: Phase 1 Polish ──
print("\n=== Test 3: Phase 1 Polish ===")
resp = httpx.post(f"{API}/api/v1/content/polish", headers=headers, json={
    "system_prompt": "你是一位资深内容编辑。",
    "content": "人工智能正在改变教育。AI可以帮助老师批改作业，也可以帮助学生个性化学习。这是一个重要的趋势。",
    "persona": "education",
}, timeout=60)
test("polish returns 202", resp.status_code == 202)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    data = wait_for_task(task_id)
    if data:
        result = data.get("result", {})
        content = result.get("content", "") if isinstance(result, dict) else ""
        test("polish has content", len(content) > 10, f"len={len(content)}")

# ── Test 4: Phase 2 Pipeline ──
print("\n=== Test 4: Phase 2 Pipeline ===")
resp = httpx.post(f"{API}/api/v1/content/pipeline", headers=headers, json={
    "intent": "写一篇关于AI教育趋势的短文",
    "persona": "education",
    "options": {"creation_mode": "single", "word_count": 500, "include_images": False, "auto_publish": False},
}, timeout=60)
test("pipeline returns 202", resp.status_code == 202)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    data = wait_for_task(task_id, max_wait=180)
    if data:
        result = data.get("result", {})
        if isinstance(result, dict):
            test("pipeline has content", len(result.get("content", "")) > 50)
            test("pipeline has stages", len(result.get("stages", {})) >= 3, f"stages={list(result.get('stages', {}).keys())}")

# ── Test 5: Short (微头条) ──
print("\n=== Test 5: Short ===")
resp = httpx.post(f"{API}/api/v1/content/short", headers=headers, json={
    "intent": "AI教育最新动态速览",
    "persona": "education",
    "options": {"include_images": False},
}, timeout=60)
test("short returns 202", resp.status_code == 202)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    data = wait_for_task(task_id, max_wait=180)
    if data:
        result = data.get("result", {})
        if isinstance(result, dict):
            test("short has content", len(result.get("content", "")) > 30, f"len={len(result.get('content', ''))}")

# ── Test 6: Video ──
print("\n=== Test 6: Video ===")
resp = httpx.post(f"{API}/api/v1/content/video", headers=headers, json={
    "intent": "AI如何改变课堂教育",
    "persona": "education",
    "options": {"duration_seconds": 60},
}, timeout=60)
test("video returns 202", resp.status_code == 202)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    data = wait_for_task(task_id, max_wait=120)
    if data:
        result = data.get("result", {})
        if isinstance(result, dict):
            test("video has script", len(result.get("script", "")) > 30, f"script_len={len(result.get('script', ''))}")
            test("video has narration", len(result.get("narration", "")) > 10, f"narration_len={len(result.get('narration', ''))}")

# ── Test 7: Series ──
print("\n=== Test 7: Series ===")
resp = httpx.post(f"{API}/api/v1/content/series", headers=headers, json={
    "intent": "AI教育全景解读系列",
    "persona": "education",
    "options": {"action": "plan", "episodes": 3},
}, timeout=60)
test("series returns 202", resp.status_code == 202)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    data = wait_for_task(task_id, max_wait=120)
    if data:
        result = data.get("result", {})
        if isinstance(result, dict):
            test("series has plan", result.get("plan") is not None or len(result.get("content", "")) > 30)
            test("series action=plan", result.get("action") == "plan")

# ── Test 8: Interact ──
print("\n=== Test 8: Interact ===")
resp = httpx.post(f"{API}/api/v1/content/interact", headers=headers, json={
    "intent": "AI正在改变教育方式，老师会被取代吗？",
    "persona": "education",
    "options": {"action": "comment", "count": 3},
}, timeout=60)
test("interact returns 202", resp.status_code == 202)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    data = wait_for_task(task_id, max_wait=120)
    if data:
        result = data.get("result", {})
        if isinstance(result, dict):
            items = result.get("items", [])
            test("interact has items", len(items) >= 1, f"items_count={len(items)}")
            test("interact action=comment", result.get("action") == "comment")

# ── Test 9: FlowForge Core APIs ──
print("\n=== Test 9: FlowForge Core APIs ===")
resp = httpx.get(f"{API}/api/v1/modes", headers=headers, timeout=5)
test("modes endpoint", resp.status_code == 200)
resp = httpx.get(f"{API}/api/v1/agents", headers=headers, timeout=5)
test("agents endpoint", resp.status_code == 200)
resp = httpx.get(f"{API}/api/v1/personas", headers=headers, timeout=5)
test("personas endpoint", resp.status_code == 200)
resp = httpx.get(f"{API}/api/v1/dashboard", headers=headers, timeout=5)
test("dashboard endpoint", resp.status_code == 200)

# ── Test 10: Auth ──
print("\n=== Test 10: Auth ===")
resp = httpx.post(f"{API}/api/v1/content/create", headers={"Content-Type": "application/json"}, json={
    "system_prompt": "test", "user_prompt": "test", "persona": "test",
}, timeout=5)
test("no API key returns 401", resp.status_code == 401)

# ── Test 11: Cancel ──
print("\n=== Test 11: Cancel ===")
resp = httpx.post(f"{API}/api/v1/content/create", headers=headers, json={
    "system_prompt": "你是一位内容创作者。",
    "user_prompt": "写一篇长文章。",
    "persona": "education",
    "mode": "single",
    "options": {"polish": False},
}, timeout=60)
task_id = resp.json().get("data", {}).get("task_id", "")
if task_id:
    resp = httpx.post(f"{API}/api/v1/content/tasks/{task_id}/cancel", headers=headers, timeout=5)
    test("cancel returns success", resp.status_code == 200)

# ── Test 12: Idempotency ──
print("\n=== Test 12: Idempotency ===")
idem_key = f"test-idem-{int(time.time())}"
resp1 = httpx.post(f"{API}/api/v1/content/create", headers=headers, json={
    "system_prompt": "test", "user_prompt": "test", "persona": "test",
    "idempotency_key": idem_key,
}, timeout=60)
resp2 = httpx.post(f"{API}/api/v1/content/create", headers=headers, json={
    "system_prompt": "test", "user_prompt": "test", "persona": "test",
    "idempotency_key": idem_key,
}, timeout=60)
test("idempotency same task_id", resp1.json().get("data", {}).get("task_id") == resp2.json().get("data", {}).get("task_id"))

# ── Summary ──
print(f"\n{'='*50}")
print(f"Results: {passed} passed, {failed} failed, {passed+failed} total")
sys.exit(0 if failed == 0 else 1)
