import urllib.request, json, time

# Create search task
data = json.dumps({
    "intent": "搜索2024年中国AI行业最新发展趋势",
    "persona": "search_debug",
    "model": "doubao-web/chat"
}).encode()
req = urllib.request.Request("http://127.0.0.1:8000/api/v1/tasks", data=data, headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req, timeout=15)
result = json.loads(resp.read().decode())
task_id = result["data"]["task_id"]
mode = result["data"]["mode"]
print(f"Created task: {task_id}, mode={mode}")

# Wait for completion
for i in range(60):
    time.sleep(3)
    try:
        resp2 = urllib.request.urlopen(f"http://127.0.0.1:8000/api/v1/tasks/{task_id}", timeout=5)
        state = json.loads(resp2.read().decode())["data"]
        status = state.get("status", "unknown")
        print(f"  [{i*3}s] status={status}")
        if status in ("completed", "failed", "error"):
            print(f"\nFinal state:")
            print(json.dumps(state, ensure_ascii=False, indent=2)[:3000])
            break
    except Exception as e:
        print(f"  Poll error: {e}")
else:
    print("TIMEOUT")
