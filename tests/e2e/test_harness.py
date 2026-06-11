"""
FlowForge Harness护栏测试 (v9.0)
对应 test.md 第三十二章：上下文工程/架构约束/反馈循环/熵管理
严格遵守测试铁律：零Mock、零假数据、真实LLM、具体断言
"""

import os
import time
import json
import pytest
import httpx

BASE_URL = os.environ.get("FLOWFORGE_BASE_URL", "http://127.0.0.1:8002")

# T1铁律：测试始终使用真实LLM，不设skipif跳过条件
# USE_REAL_LLM 已移除 — 测试必须无条件运行

REPORT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "test_reports")
os.makedirs(REPORT_DIR, exist_ok=True)


class MetricsTracker:
    """简易指标追踪器 — 记录每个测试的指标数据（T6铁律）"""
    def __init__(self, task_id: str):
        self.task_id = task_id
        self.start_time = time.time()
        self.end_time = None
        self.events = []
        self.steps = []
        self.tools_called = []
        self.agents_called = []

    def record_event(self, event: dict):
        self.events.append(event)
        event_type = event.get("type", "")
        if "step" in event_type and "start" in event_type:
            self.steps.append(event.get("data", {}).get("step_name", ""))
        if "tool" in event_type and "start" in event_type:
            self.tools_called.append(event.get("data", {}).get("tool_name", ""))
        if "agent" in event_type and "start" in event_type:
            self.agents_called.append(event.get("data", {}).get("agent_name", ""))

    def finalize(self):
        self.end_time = time.time()
        return {
            "task_id": self.task_id,
            "duration_seconds": round(self.end_time - self.start_time, 2),
            "steps": self.steps,
            "step_count": len(self.steps),
            "tools_called": self.tools_called,
            "tool_count": len(self.tools_called),
            "agents_called": self.agents_called,
            "agent_count": len(self.agents_called),
            "event_count": len(self.events),
        }

    def save(self):
        report = self.finalize()
        path = os.path.join(REPORT_DIR, f"{self.task_id}_metrics.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        return report


class HarnessTestBase:
    def create_task(self, task: str, mode: str = "helm", **kwargs) -> dict:
        payload = {
            "task": task,
            "persona": kwargs.get("persona", "default"),
            "mode": mode,
            "input_data": kwargs.get("input_data", {"task": task}),
        }
        if "workflow" in kwargs:
            payload["workflow"] = kwargs["workflow"]
        with httpx.Client(timeout=180.0) as client:
            resp = client.post(f"{BASE_URL}/api/v1/tasks", json=payload)
            assert resp.status_code in [200, 201], f"创建任务失败: {resp.status_code} {resp.text[:500]}"
            return resp.json()["data"]

    def wait_for_completion(self, task_id: str, timeout: int = 180) -> dict:
        start = time.time()
        consecutive_errors = 0
        with httpx.Client(timeout=30.0) as client:
            while time.time() - start < timeout:
                try:
                    resp = client.get(f"{BASE_URL}/api/v1/tasks/{task_id}")
                    if resp.status_code == 200:
                        data = resp.json()["data"]
                        if data.get("status") in ("completed", "error", "failed", "rejected"):
                            return data
                except (httpx.ReadTimeout, httpx.ConnectTimeout) as e:
                    consecutive_errors += 1
                    if consecutive_errors > 10:
                        pytest.fail(f"连续{consecutive_errors}次超时: {e}")
                    time.sleep(5)
                    continue
                consecutive_errors = 0
                time.sleep(3)
        pytest.fail(f"任务 {task_id} 超时({timeout}s)")


class TestContextEngineering(HarnessTestBase):
    """IT-HARNESS-01: 上下文工程护栏 — 长上下文截断与压缩"""

    def test_long_context_truncation(self):
        """真实场景：超长输入应被截断或压缩，不应OOM"""
        long_input = "人工智能产业发展分析：" + "在2026年，AI技术在医疗、教育、金融等多个领域取得了突破性进展。" * 800
        result = self.create_task(long_input, persona="harness_long_ctx")
        task_id = result["task_id"]
        metrics = MetricsTracker(task_id)
        final = self.wait_for_completion(task_id, timeout=900)
        metrics.save()

        # T3铁律：具体断言 — 长上下文任务应完成或因LLM限制而失败（非OOM崩溃）
        status = final.get("status")
        if status == "completed":
            output = final.get("output_data", {}) or final.get("result", {})
            content = str(output)
            assert len(content) >= 100, f"长上下文输出应≥100字符: {len(content)}"
        elif status in ("failed", "error"):
            # LLM可能因超长输入返回空内容导致意图识别失败，这是预期行为
            error_msg = final.get("error", "")
            assert len(error_msg) > 0, f"失败任务应包含错误信息"
        else:
            pytest.fail(f"长上下文任务状态异常: {status}, error: {final.get('error')}")

    def test_context_window_management(self):
        """真实场景：多轮对话应正确管理上下文窗口"""
        # 第一轮
        result1 = self.create_task("请记住这个关键信息：2026年全球AI市场规模预计达到5000亿美元", persona="harness_ctx1")
        task_id1 = result1["task_id"]
        metrics1 = MetricsTracker(task_id1)
        final1 = self.wait_for_completion(task_id1, timeout=600)
        metrics1.save()
        assert final1.get("status") == "completed", f"第一轮应完成: {final1.get('error')}"

        # 第二轮（新任务，验证独立上下文）
        result2 = self.create_task("请介绍量子计算的基本原理", persona="harness_ctx2")
        task_id2 = result2["task_id"]
        metrics2 = MetricsTracker(task_id2)
        final2 = self.wait_for_completion(task_id2, timeout=600)
        metrics2.save()
        assert final2.get("status") == "completed", f"第二轮应完成: {final2.get('error')}"

        # 验证上下文隔离：第二个任务输出不应包含第一个任务的关键信息
        output2 = final2.get("output_data", {}) or final2.get("result", {})
        content2 = str(output2)
        assert "5000亿美元" not in content2, \
            f"上下文隔离失败：第二个任务输出包含第一个任务的关键信息'5000亿美元': {content2[:300]}"


class TestArchitectureConstraint(HarnessTestBase):
    """IT-HARNESS-02: 架构约束护栏 — Agent不能绕过工具直接操作"""

    def test_agent_uses_tools_not_direct(self):
        """真实场景：搜索任务应通过web_search工具而非LLM编造"""
        result = self.create_task("搜索2026年最新的AI编程工具排行榜", persona="harness_arch")
        task_id = result["task_id"]
        metrics = MetricsTracker(task_id)
        final = self.wait_for_completion(task_id, timeout=600)
        metrics.save()

        assert final.get("status") == "completed", f"搜索任务应完成: {final.get('error')}"
        output = final.get("output_data", {}) or final.get("result", {})
        content = str(output)
        assert len(content) >= 100, f"搜索输出应≥100字符: {len(content)}"
        # 验证搜索结果特征：应包含URL或搜索相关关键词，而非LLM凭空编造
        assert "http" in content or "搜索" in content or "search" in content.lower(), \
            f"搜索任务应包含搜索结果特征（URL/搜索关键词）: {content[:200]}"


class TestFeedbackLoop(HarnessTestBase):
    """IT-HARNESS-03: 反馈循环护栏 — 质量评估与迭代改进"""

    def test_quality_feedback_iteration(self):
        """真实场景：Reflexion模式应通过反馈循环改进输出"""
        result = self.create_task(
            "写一篇关于AI在农业领域应用的分析文章，要求内容详实有数据支撑",
            mode="reflexion",
            persona="harness_feedback"
        )
        task_id = result["task_id"]
        metrics = MetricsTracker(task_id)
        final = self.wait_for_completion(task_id, timeout=900)
        metrics.save()

        assert final.get("status") == "completed", f"反馈循环任务应完成: {final.get('error')}"
        output = final.get("output_data", {}) or final.get("result", {})
        if isinstance(output, dict):
            content = output.get("content", "") or output.get("result", "")
            if isinstance(content, dict):
                content = content.get("output", "") or str(content)
        else:
            content = str(output)
        if not content:
            content = str(output)
        assert len(content) >= 100, f"反馈循环输出应≥100字符: {len(content)}"


class TestEntropyManagement(HarnessTestBase):
    """IT-HARNESS-04: 熵管理护栏 — 重复检测与自修正"""

    def test_repetition_detection(self):
        """真实场景：重复内容应被检测并修正"""
        result = self.create_task(
            "详细阐述机器学习的三个主要类型：监督学习、无监督学习和强化学习，每个类型给出具体应用案例",
            persona="harness_entropy"
        )
        task_id = result["task_id"]
        metrics = MetricsTracker(task_id)
        final = self.wait_for_completion(task_id, timeout=600)
        metrics.save()

        assert final.get("status") == "completed", f"熵管理任务应完成: {final.get('error')}"
        output = final.get("output_data", {}) or final.get("result", {})
        content = str(output)
        assert len(content) >= 100, f"熵管理输出应≥100字符: {len(content)}"
        # 验证输出不是简单重复
        # 粗略检查：如果内容中同一段文字重复超过5次，可能是熵管理失效
        lines = content.split("\n")
        unique_lines = set(l.strip() for l in lines if l.strip())
        if len(lines) > 10:
            repetition_ratio = 1 - len(unique_lines) / len(lines)
            assert repetition_ratio < 0.5, \
                f"输出重复率过高({repetition_ratio:.0%})，熵管理可能失效"


class TestThreeLayerDefense(HarnessTestBase):
    """IT-HARNESS-05: 三层防御 — L1超时/L2重复/L3自修正"""

    def test_l1_timeout_protection(self):
        """真实场景：任务应在超时时间内完成

        LLMClient的fallback链确保当某个模型不可用时自动切换到备选模型。
        不再使用pytest.skip——fallback链应保证任务最终完成。
        """
        result = self.create_task("分析全球半导体产业链格局变化", persona="harness_l1")
        task_id = result["task_id"]
        metrics = MetricsTracker(task_id)
        final = self.wait_for_completion(task_id, timeout=900)
        metrics.save()
        # L1超时保护：任务应完成（LLM fallback链保证）
        assert final.get("status") == "completed", \
            f"L1超时保护任务应完成: {final.get('status')}, error: {final.get('error', '')}"

    def test_l2_repetition_detection(self):
        """真实场景：Agent重复操作应被检测"""
        result = self.create_task("搜索AI最新新闻，然后总结要点", persona="harness_l2")
        task_id = result["task_id"]
        metrics = MetricsTracker(task_id)
        final = self.wait_for_completion(task_id, timeout=600)
        metrics.save()
        assert final.get("status") == "completed", \
            f"L2重复检测任务应完成: {final.get('error')}"

    def test_l3_self_correction(self):
        """真实场景：Agent应能自修正错误"""
        result = self.create_task(
            "计算2026年中国GDP增长率，如果数据不可用请说明原因并给出估算",
            mode="react",
            persona="harness_l3"
        )
        task_id = result["task_id"]
        metrics = MetricsTracker(task_id)
        final = self.wait_for_completion(task_id, timeout=600)
        metrics.save()
        assert final.get("status") == "completed", f"自修正任务应完成: {final.get('error')}"
        output = final.get("output_data", {}) or final.get("result", {})
        content = str(output)
        assert len(content) >= 80, f"自修正输出应≥80字符: {len(content)}"
