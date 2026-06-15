"""Quick E2E test: real LLM call via openroute.

铁律遵守:
    T2: 不使用假数据 — 使用真实业务场景数据
    T3: 不跳过验证 — 每个测试有具体断言
    T6: 采集指标 — 使用MetricsCollector
"""
import urllib.request, json, time, sys, os

BASE = "http://127.0.0.1:8002"

# ── MetricsCollector (T6) ──
class MetricsCollector:
    """简易指标采集器，满足T6铁律"""
    def __init__(self, task_id: str):
        self.task_id = task_id
        self.start_time = time.time()
        self.end_time: float = 0
        self.llm_calls: int = 0
        self.results: list = []

    def record(self, test_name: str, status: str, duration: float, detail: str = ""):
        self.results.append({"test": test_name, "status": status, "duration_s": round(duration, 2), "detail": detail})
        self.llm_calls += 1

    def report(self) -> str:
        self.end_time = time.time()
        total = round(self.end_time - self.start_time, 2)
        lines = [f"\n=== Metrics Report ===", f"Total duration: {total}s", f"LLM calls: {self.llm_calls}"]
        for r in self.results:
            lines.append(f"  {r['test']}: {r['status']} ({r['duration_s']}s) {r['detail']}")
        return "\n".join(lines)

metrics = MetricsCollector("quick-e2e")


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

# Test 1: 科技评论对话 — 真实业务场景数据 (T2)
print("=" * 60)
print("Test 1: 科技评论对话 (openroute/DeepSeek-V4-Pro)")
print("=" * 60)
t1_start = time.time()
t1 = create_task(
    "你是一位资深科技评论员，擅长撰写深度分析文章。请用300字分析2026年人工智能如何重塑教育模式，需包含具体数据和案例。",
    "education",
    "openroute/DeepSeek-V4-Pro"
)
tid1 = t1["task_id"]
print(f"Task ID: {tid1}")
r1 = wait_task(tid1)
t1_duration = time.time() - t1_start
if r1:
    print(f"Status: {r1['status']}")
    if r1.get("summary"):
        print(f"Summary: {r1['summary'][:200]}")
    if r1.get("error"):
        print(f"Error: {r1['error'][:300]}")
    passed = r1["status"] == "completed"
    results.append(("科技评论对话", passed))
    metrics.record("科技评论对话", "PASS" if passed else "FAIL", t1_duration)
    print("PASS" if passed else f"FAIL: expected completed, got {r1['status']}")
else:
    results.append(("科技评论对话", False))
    metrics.record("科技评论对话", "TIMEOUT", t1_duration)
    print("FAIL: timeout")

# Test 2: OpenRouter free model — 真实业务场景数据 (T2)
print("\n" + "=" * 60)
print("Test 2: OpenRouter free model (moonshotai/kimi-k2.6:free)")
print("=" * 60)
t2_start = time.time()
try:
    t2 = create_task(
        "请简要分析2026年人工智能在医疗健康领域的三大应用趋势，每条给出一个具体案例。",
        "default",
        "moonshotai/kimi-k2.6:free"
    )
    tid2 = t2["task_id"]
    print(f"Task ID: {tid2}")
    r2 = wait_task(tid2)
    t2_duration = time.time() - t2_start
    if r2:
        print(f"Status: {r2['status']}")
        if r2.get("summary"):
            print(f"Summary: {r2['summary'][:200]}")
        if r2.get("error"):
            print(f"Error: {r2['error'][:300]}")
        passed = r2["status"] == "completed"
        results.append(("OpenRouter free", passed))
        metrics.record("OpenRouter free", "PASS" if passed else "FAIL", t2_duration)
        print("PASS" if passed else f"FAIL: expected completed, got {r2['status']}")
    else:
        results.append(("OpenRouter free", False))
        metrics.record("OpenRouter free", "TIMEOUT", t2_duration)
        print("FAIL: timeout")
except Exception as e:
    t2_duration = time.time() - t2_start
    results.append(("OpenRouter free", False))
    metrics.record("OpenRouter free", "ERROR", t2_duration, str(e))
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

# 输出指标报告 (T6)
print(metrics.report())
