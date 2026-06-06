import urllib.request, json, time

BASE = "http://127.0.0.1:8000/api/v1"

def create_task(intent, persona, model):
    data = json.dumps({"intent": intent, "persona": persona, "model": model}).encode()
    req = urllib.request.Request(f"{BASE}/tasks", data=data, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read().decode())["data"]["task_id"]

def wait_for_task(task_id, timeout=300):
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = urllib.request.urlopen(f"{BASE}/tasks/{task_id}", timeout=5)
            state = json.loads(resp.read().decode())["data"]
            status = state.get("status", "unknown")
            elapsed = int(time.time() - start)
            if elapsed % 15 == 0:
                print(f"  [{elapsed}s] status={status}")
            if status in ("completed", "failed", "error"):
                return state, elapsed
        except Exception as e:
            print(f"  Poll error: {e}")
        time.sleep(3)
    return {"status": "timeout"}, timeout

# Test translate with doubao
print("=== Translate test (doubao) ===")
tid = create_task(
    "将以下英文翻译成中文：Artificial intelligence is transforming healthcare by enabling early disease detection and personalized treatment plans.",
    "translate_test_doubao_v3",
    "doubao-web/chat"
)
print(f"Task: {tid}")
state, elapsed = wait_for_task(tid, timeout=300)
status = state.get("status")
print(f"Status: {status} ({elapsed}s)")
if status == "completed":
    output = state.get("output_data", {})
    response = output.get("response") or output.get("final_answer") or ""
    print(f"Response ({len(response)} chars): {response[:300]}")
else:
    print(f"Error: {state.get('error', 'unknown')}")

# Test translate with deepseek
print("\n=== Translate test (deepseek) ===")
tid2 = create_task(
    "将以下英文翻译成中文：Artificial intelligence is transforming healthcare by enabling early disease detection and personalized treatment plans.",
    "translate_test_ds_v3",
    "deepseek-web/chat"
)
print(f"Task: {tid2}")
state2, elapsed2 = wait_for_task(tid2, timeout=300)
status2 = state2.get("status")
print(f"Status: {status2} ({elapsed2}s)")
if status2 == "completed":
    output2 = state2.get("output_data", {})
    response2 = output2.get("response") or output2.get("final_answer") or ""
    print(f"Response ({len(response2)} chars): {response2[:300]}")
else:
    print(f"Error: {state2.get('error', 'unknown')}")
