import urllib.request, json, time

BASE = "http://127.0.0.1:8000/api/v1"

def test_workflow(name, workflow, intent, min_len=50):
    print(f"\n=== {name} ===")
    data = json.dumps({
        "intent": intent,
        "persona": f"wf_test_{int(time.time())}",
        "model": "doubao-web/chat",
        "workflow": workflow,
    }).encode()
    req = urllib.request.Request(f"{BASE}/tasks", data=data, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        result = json.loads(resp.read().decode())
        task_id = result["data"]["task_id"]
        mode = result["data"].get("mode", "unknown")
        print(f"Task: {task_id}, mode={mode}")
    except urllib.error.HTTPError as e:
        print(f"Create failed: HTTP {e.code}")
        print(e.read().decode()[:300])
        return

    for i in range(60):
        time.sleep(3)
        try:
            resp2 = urllib.request.urlopen(f"{BASE}/tasks/{task_id}", timeout=5)
            state = json.loads(resp2.read().decode())["data"]
            status = state.get("status", "unknown")
            if status in ("completed", "failed", "error"):
                print(f"Status: {status} ({i*3}s)")
                if status == "completed":
                    output = state.get("output_data", {})
                    response = output.get("response") or output.get("final_answer") or ""
                    print(f"Response: {len(response)} chars")
                    if response:
                        print(response[:200])
                else:
                    print(f"Error: {state.get('error', 'unknown')}")
                return
        except Exception as e:
            print(f"Poll error: {e}")
    print("TIMEOUT (180s)")

# Test quick_post (simplest workflow)
test_workflow("quick_post", "quick_post", "写一篇关于GPT-5最新发布消息的速报", 50)

time.sleep(5)

# Test deep_article
test_workflow("deep_article", "deep_article", "帮我写一篇关于2026年AI Agent发展趋势的深度分析文章", 100)
