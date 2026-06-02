import httpx
import time

r = httpx.post(
    "http://127.0.0.1:8002/api/v1/tasks",
    json={"task": "你好", "persona": "test_v3", "mode": "solo"},
    timeout=30,
)
print(f"Create: {r.status_code}")
if r.status_code not in (200, 201):
    print(f"Error: {r.text[:300]}")
    exit(1)
tid = r.json()["data"]["task_id"]
print(f"Task ID: {tid}")
start = time.time()
while time.time() - start < 180:
    r2 = httpx.get(f"http://127.0.0.1:8002/api/v1/tasks/{tid}", timeout=10)
    d = r2.json()["data"]
    s = d.get("status")
    if s in ("completed", "error", "failed", "cancelled"):
        elapsed = time.time() - start
        print(f"Status: {s} in {elapsed:.1f}s")
        if s == "completed":
            out = d.get("output_data", {}) or d.get("result", {})
            resp = out.get("response", "") if isinstance(out, dict) else str(out)
            print(f"Response ({len(resp)} chars): {resp[:200]}")
        else:
            err = d.get("error", "N/A")
            print(f"Error: {str(err)[:200]}")
        break
    time.sleep(3)
else:
    print(f"TIMEOUT after 180s, status={s}")
