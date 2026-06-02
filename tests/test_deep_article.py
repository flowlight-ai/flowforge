#!/usr/bin/env python3
"""Test deep_article workflow with increased timeout"""
import urllib.request, json, time

# Create a deep_article workflow task
data = json.dumps({
    "intent": "撰写一篇关于2026年中国AI大模型产业发展趋势的深度分析文章",
    "persona": "test_deep_" + str(int(time.time())),
    "mode": "workflow",
    "workflow": "deep_article",
    "model": "doubao-web/chat"
}).encode()
req = urllib.request.Request("http://127.0.0.1:8000/api/v1/tasks", data=data, headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req)
result = json.loads(resp.read().decode())
task_id = result["data"]["task_id"]
print(f"Task created: {task_id}")

# Poll for 600s
start = time.time()
while time.time() - start < 600:
    try:
        resp2 = urllib.request.urlopen(f"http://127.0.0.1:8000/api/v1/tasks/{task_id}")
        state = json.loads(resp2.read().decode())["data"]
        status = state.get("status", "unknown")
        elapsed = int(time.time() - start)
        if elapsed % 30 == 0:
            print(f"  [{elapsed}s] status={status}")
        if status in ("completed", "failed", "error"):
            print(f"\n=== Task {status} in {elapsed}s ===")
            output = state.get("output_data", {})
            if isinstance(output, dict):
                print(f"  output keys: {list(output.keys())}")
                draft = output.get("draft", "")
                print(f"  draft length: {len(str(draft))} chars")
                print(f"  draft preview: {str(draft)[:200]}")
            error = state.get("error", "")
            if error:
                print(f"  error: {error[:300]}")
            break
    except Exception as e:
        print(f"  Error: {e}")
    time.sleep(5)
else:
    print(f"TIMEOUT after 600s")
