"""
FlowForge 产品功能/业务验证（真实运行场景，非代码审查）

测试专家视角：把 flowforge 当"产品"测 —— 真实起服务、真实打 HTTP 业务入口，
观察实际返回与运行状态，发现业务/功能 bug。

覆盖（对应 docs/test T004 集成 / T005 Workflow API / T012 Multi-Agent）：
  - 业务入口健康检查 / metrics
  - Workflow API 负向契约（缺 intent / 空白 / 非法 mode / 非法 workflow）
  - Workflow API 正向分发（quick_post 真实主题）→ 观察后台执行真实行为
  - 议会（Council）任务真实分发

说明：当前沙箱无可用真实 LLM（OPENROUTER/OPENROUTE 密钥为空占位），
故"LLM 步骤实际产出内容"层属验证阻塞（T1 禁止 Mock），本节只验证到
「请求契约 + 任务分发 + 无 LLM 时的降级行为」这一可测业务边界。
"""
import json
import sys
import time
import uuid

import httpx

BASE = "http://127.0.0.1:8000"

# 真实场景意图（T2 禁止假数据）：一个具体的选题，不是 "hello"/"test"
REAL_INTENT = "写一篇关于新能源汽车购置补贴退坡后二手车保值率变化的科普文章，面向普通消费者"


def _show(title, resp, body=None):
    print(f"\n===== {title} =====")
    print(f"HTTP {resp.status_code}")
    try:
        print(json.dumps(resp.json(), ensure_ascii=False, indent=2)[:2500])
    except Exception:
        print((body or resp.text)[:1500])


def test_health():
    r = httpx.get(f"{BASE}/api/v1/health", timeout=10)
    _show("SC-A 健康检查 /api/v1/health", r)
    return r


def test_metrics():
    r = httpx.get(f"{BASE}/metrics", timeout=10)
    txt = r.text
    print(f"\n===== SC-B /metrics =====\nHTTP {r.status_code}  len={len(txt)}")
    print(txt[:600])


def test_neg_missing_intent():
    r = httpx.post(f"{BASE}/api/v1/tasks", json={}, timeout=10)
    _show("SC-C 缺 intent+input → 期望 422 MISSING_INPUT", r)


def test_neg_whitespace_intent():
    r = httpx.post(f"{BASE}/api/v1/tasks", json={"intent": "   "}, timeout=10)
    _show("SC-D 空白 intent → 期望 422 EMPTY_INPUT", r)


def test_neg_invalid_mode():
    r = httpx.post(f"{BASE}/api/v1/tasks", json={"intent": REAL_INTENT, "mode": "xyz"}, timeout=10)
    _show("SC-E 非法 mode=xyz → 期望 422 INVALID_MODE", r)


def test_neg_invalid_workflow():
    r = httpx.post(f"{BASE}/api/v1/tasks", json={"intent": REAL_INTENT, "workflow": "not_exist"}, timeout=10)
    _show("SC-F 非法 workflow=not_exist → 期望 400 INVALID_WORKFLOW", r)


def test_pos_workflow_dispatch():
    """正向：真实意图 + 合法 workflow=quick_post → 期望 201 + task_id，并观察后台执行。"""
    r = httpx.post(
        f"{BASE}/api/v1/tasks",
        json={"intent": REAL_INTENT, "workflow": "quick_post", "persona": "default"},
        timeout=15,
    )
    _show("SC-G 正向 quick_post 分发 → 期望 201", r)
    if r.status_code != 201:
        return None
    tid = r.json().get("data", {}).get("task_id") or r.json().get("task_id")
    print(f"\n-- 轮询任务状态 task_id={tid} --")
    for i in range(8):
        time.sleep(5)
        try:
            g = httpx.get(f"{BASE}/api/v1/tasks/{tid}", timeout=10)
            j = g.json()
            st = j.get("data", {}).get("status") or j.get("status") or j.get("data", {}).get("state")
            print(f"  poll#{i+1} HTTP {g.status_code} status={st}")
            if st in ("completed", "failed", "error", "cancelled"):
                _show(f"SC-G 终态 task={tid}", g)
                break
        except Exception as e:
            print(f"  poll#{i+1} 查询异常: {e}")
    return tid


def test_council_dispatch():
    """议会任务真实分发：POST /api/v1/forgemind/council/tasks。"""
    r = httpx.post(
        f"{BASE}/api/v1/forgemind/council/tasks",
        json={"intent": REAL_INTENT, "persona": "default"},
        timeout=15,
    )
    _show("SC-H 议会任务分发 → 期望 201/200 + task_id", r)
    return r


if __name__ == "__main__":
    print("BASE =", BASE)
    test_health()
    test_metrics()
    test_neg_missing_intent()
    test_neg_whitespace_intent()
    test_neg_invalid_mode()
    test_neg_invalid_workflow()
    test_pos_workflow_dispatch()
    test_council_dispatch()
    print("\n===== DONE =====")
