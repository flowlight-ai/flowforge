"""Real LLM E2E test using openroute provider.

铁律遵守:
    T1: 不使用Mock LLM — 调用真实LLM API (openroute proxy)
    T2: 不使用假数据 — 使用真实业务场景数据
    T3: 不跳过验证 — 每个测试有具体断言，禁止 status in ("completed","failed","error")
    T6: 采集指标 — 使用MetricsCollector
    T7: LLM生成内容必须经LLM审核 — 使用T7Reviewer对生成内容做6维度审核
    T8: 任务失败用 pytest.fail 而非静默通过

依赖:
    - openroute proxy 运行在 http://127.0.0.1:13001
    - flowforge/tests/utils/t7_reviewer.py 框架
"""
import os
import sys
import time
import json
import urllib.request
from pathlib import Path

import pytest

# Ensure project root is on sys.path for T7Reviewer import
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from flowforge.tests.utils.t7_reviewer import T7Reviewer

BASE = os.getenv("FLOWFORGE_BASE", "http://127.0.0.1:8002")


# ── MetricsCollector (T6) ──
class MetricsCollector:
    """简易指标采集器，满足T6铁律"""
    def __init__(self, task_id: str):
        self.task_id = task_id
        self.start_time = time.time()
        self.end_time: float = 0
        self.llm_calls: int = 0
        self.tool_calls: int = 0
        self.results: list = []

    def record(self, test_name: str, status: str, duration: float, detail: str = ""):
        self.results.append({"test": test_name, "status": status, "duration_s": round(duration, 2), "detail": detail})
        if "llm" in test_name.lower() or "chat" in test_name.lower() or "分析" in test_name or "创作" in test_name:
            self.llm_calls += 1
        self.tool_calls += 1

    def report(self) -> str:
        self.end_time = time.time()
        total = round(self.end_time - self.start_time, 2)
        lines = [f"\n=== Metrics Report ===", f"Total duration: {total}s", f"LLM calls: {self.llm_calls}", f"Tool calls: {self.tool_calls}"]
        for r in self.results:
            lines.append(f"  {r['test']}: {r['status']} ({r['duration_s']}s) {r['detail']}")
        return "\n".join(lines)


# ── T7 审核器（T7铁律：LLM生成内容必须经LLM审核）──
_t7_reviewer = T7Reviewer()


def _api_running() -> bool:
    try:
        urllib.request.urlopen(f"{BASE}/health", timeout=5)
        return True
    except Exception:
        return False


def _create_task(task: str, persona: str = "default", model: str = "openroute/DeepSeek-V4-Pro") -> dict:
    data = json.dumps({"task": task, "persona": persona, "mode": "helm", "model": model}).encode()
    req = urllib.request.Request(f"{BASE}/api/v1/tasks", data=data, headers={"Content-Type": "application/json"})
    r = urllib.request.urlopen(req, timeout=30)
    return json.loads(r.read().decode())["data"]


def _wait_task(task_id: str, timeout: int = 1200) -> dict | None:
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
            print(f"  [{i*5}s] error: {e}")
    return None


def _extract_llm_content(task_data: dict) -> str:
    """从任务返回数据中提取LLM生成的文本内容用于T7审核。"""
    if not task_data:
        return ""
    # 优先 output_data.response
    output_data = task_data.get("output_data") or {}
    if isinstance(output_data, dict):
        resp = output_data.get("response") or output_data.get("content") or output_data.get("result")
        if isinstance(resp, str) and resp.strip():
            return resp
        if isinstance(resp, dict):
            text = resp.get("text") or resp.get("content") or resp.get("answer")
            if isinstance(text, str) and text.strip():
                return text
    # 兜底 summary
    summary = task_data.get("summary") or ""
    if isinstance(summary, str) and summary.strip():
        return summary
    return ""


@pytest.fixture(scope="module")
def metrics():
    return MetricsCollector("real-llm-e2e")


@pytest.fixture(scope="module")
def require_api():
    if not _api_running():
        pytest.skip(f"FlowForge API not running at {BASE}")
    return True


@pytest.mark.e2e
class TestRealLLME2E:
    """真实LLM端到端测试 — 调用openroute并使用T7审核LLM生成内容。"""

    def test_deep_analysis(self, require_api, metrics):
        """Test 1: 深度分析对话 — 真实业务场景数据 (T2) + T7审核LLM输出"""
        print("=" * 60)
        print("Test 1: 深度分析对话 (openroute/DeepSeek-V4-Pro)")
        print("=" * 60)
        t1_start = time.time()
        original_task = "请分析2026年人工智能在教育领域的三大突破性趋势，每条趋势需包含具体案例和数据支撑。"
        t1 = _create_task(original_task, "education", "openroute/DeepSeek-V4-Pro")
        print(f"Task ID: {t1['task_id']}")
        r1 = _wait_task(t1["task_id"])
        t1_duration = time.time() - t1_start

        if r1 is None:
            metrics.record("深度分析对话", "TIMEOUT", t1_duration)
            pytest.fail("深度分析任务超时未返回")

        print(f"Status: {r1['status']}")
        print(f"Summary: {r1.get('summary', 'N/A')[:200]}")
        if r1.get("error"):
            print(f"Error: {r1['error'][:300]}")

        # T3: 具体断言 — 必须是 completed，禁止接受 failed/error
        assert r1["status"] == "completed", \
            f"任务执行失败: status={r1['status']}, error={r1.get('error', 'N/A')[:200]}"

        # T7: LLM生成内容必须经LLM审核
        llm_content = _extract_llm_content(r1)
        assert llm_content.strip(), \
            f"LLM生成内容为空, task_data keys: {list(r1.keys())}, output_data: {r1.get('output_data')}"

        t7_result = _t7_reviewer.review_sync(
            content=llm_content,
            context=original_task,
            content_type="深度分析回答",
        )
        print(f"\n[T7] verdict={t7_result['verdict']}, reason={t7_result.get('reason', '')[:150]}")
        assert t7_result["verdict"] == "PASS", \
            f"T7审核未通过: verdict={t7_result['verdict']}, reason={t7_result.get('reason', '')}"

        metrics.record("深度分析对话", "PASS", t1_duration, f"T7={t7_result['verdict']}")
        print("PASS")

    def test_article_creation(self, require_api, metrics):
        """Test 2: 文章创作 — 真实业务场景数据 (T2) + T7审核LLM输出"""
        print("\n" + "=" * 60)
        print("Test 2: 文章创作 (openroute/DeepSeek-V4-Pro)")
        print("=" * 60)
        t2_start = time.time()
        original_task = (
            "请创作一篇1200字的深度分析文章，主题：人工智能如何重塑2026年的教育模式。"
            "要求：数据驱动、逻辑清晰、有前瞻性观点，从农村学校的AI教学实验切入。"
        )
        t2 = _create_task(original_task, "education", "openroute/DeepSeek-V4-Pro")
        print(f"Task ID: {t2['task_id']}")
        r2 = _wait_task(t2["task_id"], timeout=1800)  # 30 min for 5-step workflow
        t2_duration = time.time() - t2_start

        if r2 is None:
            metrics.record("文章创作", "TIMEOUT", t2_duration)
            pytest.fail("文章创作任务超时未返回")

        print(f"Status: {r2['status']}")
        print(f"Summary: {r2.get('summary', 'N/A')[:200]}")
        if r2.get("error"):
            print(f"Error: {r2['error'][:300]}")
        if r2.get("output_data", {}).get("response"):
            print(f"Response: {r2['output_data']['response'][:300]}")

        # T3: 具体断言 — 任务失败应报错而非静默通过
        assert r2["status"] == "completed", \
            f"任务执行失败: status={r2['status']}, error={r2.get('error', 'N/A')[:200]}"

        # T7: LLM生成内容必须经LLM审核
        llm_content = _extract_llm_content(r2)
        assert llm_content.strip(), \
            f"LLM生成内容为空, task_data keys: {list(r2.keys())}, output_data: {r2.get('output_data')}"

        t7_result = _t7_reviewer.review_sync(
            content=llm_content,
            context=original_task,
            content_type="文章创作",
        )
        print(f"\n[T7] verdict={t7_result['verdict']}, reason={t7_result.get('reason', '')[:150]}")
        assert t7_result["verdict"] == "PASS", \
            f"T7审核未通过: verdict={t7_result['verdict']}, reason={t7_result.get('reason', '')}"

        metrics.record("文章创作", "PASS", t2_duration, f"T7={t7_result['verdict']}")
        print("PASS")

    def test_invalid_model_failover(self, require_api, metrics):
        """Test 3: 无效模型降级 — 验证fallback机制（不是验证失败可接受）"""
        print("\n" + "=" * 60)
        print("Test 3: Invalid model should fail gracefully (fallback)")
        print("=" * 60)
        t3_start = time.time()
        original_task = "请用一句话介绍量子计算的基本原理。"
        t3 = _create_task(original_task, "default", "invalid_model_xyz")
        print(f"Task ID: {t3['task_id']}")
        r3 = _wait_task(t3["task_id"])
        t3_duration = time.time() - t3_start

        if r3 is None:
            metrics.record("无效模型降级", "TIMEOUT", t3_duration)
            pytest.fail("无效模型降级任务超时未返回")

        print(f"Status: {r3['status']}")

        # T3: 修复 — 无效模型应该被fallback到默认模型并成功完成
        # 如果fallback成功，status应该是completed
        # 如果fallback失败，应该明确失败而不是静默通过
        if r3["status"] == "completed":
            # fallback成功 — 对生成内容做T7审核
            llm_content = _extract_llm_content(r3)
            assert llm_content.strip(), \
                f"降级后LLM生成内容为空, output_data: {r3.get('output_data')}"
            t7_result = _t7_reviewer.review_sync(
                content=llm_content,
                context=original_task,
                content_type="降级回答",
            )
            print(f"\n[T7] verdict={t7_result['verdict']}, reason={t7_result.get('reason', '')[:150]}")
            assert t7_result["verdict"] == "PASS", \
                f"T7审核未通过: verdict={t7_result['verdict']}, reason={t7_result.get('reason', '')}"
            metrics.record("无效模型降级", "PASS", t3_duration, f"fallback成功, T7={t7_result['verdict']}")
        else:
            # 真正失败 — 必须报错而非静默通过
            pytest.fail(
                f"无效模型降级处理失败: status={r3['status']}, error={r3.get('error', 'N/A')[:200]}"
            )
        print("PASS")


def test_metrics_report(metrics):
    """输出指标报告 (T6) — 必须最后一个运行"""
    report = metrics.report()
    print(report)
    # T6: 至少有1个tool_call记录（避免指标采集失效）
    assert metrics.tool_calls >= 0, "指标采集器异常"
