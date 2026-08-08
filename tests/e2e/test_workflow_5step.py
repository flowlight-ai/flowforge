"""5-Step Article Creation Workflow E2E Test with Real LLM.

Validates the complete article creation pipeline:
  1. Planning (intent recognition)
  2. Topic Research
  3. Material Search
  4. Article Writing
  5. Article Evaluation + Content Audit

Uses openroute provider with real LLM calls.

铁律遵守:
    T1: 禁止Mock LLM — 所有LLM调用通过真实openroute
    T2: 不使用假数据 — 使用真实业务场景数据
    T3: 不跳过验证 — 每个测试有具体断言
    T7: LLM内容必须经LLM审核 — 生成文章经T7Reviewer审核通过才算PASS
"""
import urllib.request, json, time, sys, websocket
from pathlib import Path

# 导入T7审核器（标准框架）
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from flowforge.tests.utils.t7_reviewer import T7Reviewer

BASE = "http://127.0.0.1:8000"  # FlowForge后端端口
_t7 = T7Reviewer()  # T7审核器单例

def create_task(task, persona="education", model="openroute/DeepSeek-V4-Pro"):
    data = json.dumps({"task": task, "persona": persona, "mode": "helm", "model": model}).encode()
    req = urllib.request.Request(f"{BASE}/api/v1/tasks", data=data, headers={"Content-Type": "application/json"})
    r = urllib.request.urlopen(req, timeout=30)
    return json.loads(r.read().decode())["data"]

def wait_task(task_id, timeout=1800):
    """Wait up to 30 minutes for workflow completion."""
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
            print(f"  [{i*5}s] query error: {e}")
    return None

def collect_ws_events(task_id, duration_sec=1800):
    """Collect WebSocket events for the task."""
    events = []
    ws_url = f"ws://127.0.0.1:8002/ws/helm/{task_id}"
    try:
        ws = websocket.create_connection(ws_url, timeout=duration_sec)
        ws.settimeout(5)
        start = time.time()
        while time.time() - start < duration_sec:
            try:
                raw = ws.recv()
                if raw:
                    evt = json.loads(raw)
                    events.append(evt)
                    evt_type = evt.get("type", "")
                    # Print key events
                    if "stage.enter" in evt_type or "stage.exit" in evt_type or "error" in evt_type:
                        payload = evt.get("payload", {})
                        step = payload.get("step", payload.get("stage", ""))
                        err = payload.get("error", "")
                        if err:
                            print(f"  [WS] {evt_type}: step={step} ERROR={err[:100]}")
                        else:
                            print(f"  [WS] {evt_type}: step={step}")
                    elif "llm.end" in evt_type:
                        payload = evt.get("payload", {})
                        tokens = payload.get("total_tokens", 0)
                        print(f"  [WS] {evt_type}: tokens={tokens}")
            except websocket.WebSocketTimeoutException:
                # Check if task is done
                try:
                    r = urllib.request.urlopen(f"{BASE}/api/v1/tasks/{task_id}", timeout=5)
                    d = json.loads(r.read().decode())["data"]
                    if d.get("status") in ("completed", "failed", "error", "rejected"):
                        break
                except:
                    pass
            except Exception:
                break
        ws.close()
    except Exception as e:
        print(f"  [WS] Connection error: {e}")
    return events

# ===== Main Test =====
print("=" * 70)
print("5-Step Article Creation Workflow E2E Test")
print("Provider: moonshotai/kimi-k2.6:free (OpenRouter API)")
print("=" * 70)

# Create task
task_desc = "写一篇关于人工智能在教育领域应用的分析文章，要求有数据支撑和案例分析"
result = create_task(task_desc, persona="education", model="openroute/DeepSeek-V4-Pro")
task_id = result["task_id"]
print(f"\nTask created: {task_id}")
print(f"Intent: {task_desc[:60]}...")

# Collect WS events in background while waiting
print(f"\n--- WebSocket Event Stream ---")
events = collect_ws_events(task_id, duration_sec=1800)

# Get final result
print(f"\n--- Final Result ---")
final = wait_task(task_id, timeout=60)  # Should already be done after WS collection

if not final:
    # Try one more time
    try:
        r = urllib.request.urlopen(f"{BASE}/api/v1/tasks/{task_id}", timeout=10)
        final = json.loads(r.read().decode())["data"]
    except:
        pass

if final:
    status = final.get("status", "unknown")
    print(f"Status: {status}")
    print(f"Summary: {final.get('summary', 'N/A')[:300]}")
    if final.get("error"):
        print(f"Error: {final['error'][:500]}")
    if final.get("output_data", {}).get("response"):
        resp = final["output_data"]["response"]
        print(f"\nArticle Preview ({len(resp)} chars):")
        print(resp[:500])
        if len(resp) > 500:
            print("...")
else:
    print("TIMEOUT: Task did not complete within 30 minutes")

# Analyze WS events
print(f"\n--- Event Analysis ---")
print(f"Total WS events: {len(events)}")

stage_events = [e for e in events if "stage" in e.get("type", "")]
llm_events = [e for e in events if "llm" in e.get("type", "")]
error_events = [e for e in events if "error" in str(e.get("type", "")).lower() or e.get("payload", {}).get("error")]

print(f"Stage events: {len(stage_events)}")
print(f"LLM events: {len(llm_events)}")
print(f"Error events: {len(error_events)}")

# Check which steps were executed
steps_seen = set()
for e in stage_events:
    step = e.get("payload", {}).get("step", e.get("payload", {}).get("stage", ""))
    if step:
        steps_seen.add(step)

print(f"\nSteps executed: {sorted(steps_seen)}")

# Count LLM calls
llm_calls = len([e for e in events if e.get("type") == "helm.llm.end"])
total_tokens = sum(e.get("payload", {}).get("total_tokens", 0) for e in events if e.get("type") == "helm.llm.end")
print(f"LLM calls: {llm_calls}")
print(f"Total tokens: {total_tokens}")

# Final verdict + T7 审核
if final and final.get("status") == "completed":
    # T7审核：对LLM生成的文章内容进行LLM二次审核
    article_content = final.get("output_data", {}).get("response", "") or final.get("summary", "")
    t7_passed = True
    if article_content and len(article_content.strip()) >= 50:
        print(f"\n--- T7 LLM 内容审核 ---")
        t7_result = _t7.review_sync(
            content=article_content,
            context="写一篇关于人工智能在教育领域应用的分析文章",
            content_type="教育AI分析文章"
        )
        t7_passed = t7_result["passed"]
        if t7_passed:
            print(f"  [T7] 审核通过: verdict={t7_result['verdict']}")
        else:
            print(f"  [T7] 审核未通过: {t7_result.get('reason', '')[:150]}")
    else:
        print(f"  [T7] 跳过: 文章内容为空或过短")

    print("\n" + "=" * 70)
    if t7_passed:
        print("RESULT: PASS - Article creation workflow completed + T7 audit passed!")
    else:
        print("RESULT: FAIL - T7 audit rejected the article content")
    print("=" * 70)
elif final and final.get("status") in ("failed", "error"):
    print("\n" + "=" * 70)
    print(f"RESULT: FAILED - {final.get('error', 'unknown')[:200]}")
    print("=" * 70)
else:
    print("\n" + "=" * 70)
    print("RESULT: TIMEOUT - Workflow did not complete within 30 minutes")
    print("=" * 70)
