"""E2E 测试套件模板

提供 E2E 测试的基类和工具，确保：
- T2: 不使用假数据 — 使用真实业务场景数据
- T3: 不跳过验证 — 每个测试有具体断言
- T6: 采集指标 — 使用 MetricsCollector

使用方式：
    class TestMyFeature(E2ETestBase):
        def test_xxx(self):
            result = self.run_task("真实业务场景任务描述")
            self.assert_task_completed(result)
            self.assert_result_quality(result, min_length=100)
"""
import time
import json
import urllib.request
from abc import ABC
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class MetricsCollector:
    """简易指标采集器，满足 T6 铁律

    采集 LLM 调用次数、工具调用链、执行时长等指标。
    """
    task_id: str
    start_time: float = field(default_factory=time.time)
    end_time: float = 0.0
    llm_calls: int = 0
    tool_calls: int = 0
    results: List[Dict[str, Any]] = field(default_factory=list)

    def record(
        self,
        test_name: str,
        status: str,
        duration: float,
        detail: str = "",
        llm_calls: int = 0,
        tool_calls: int = 0,
    ) -> None:
        self.results.append({
            "test": test_name,
            "status": status,
            "duration_s": round(duration, 2),
            "detail": detail,
        })
        self.llm_calls += llm_calls
        self.tool_calls += tool_calls

    def report(self) -> str:
        self.end_time = time.time()
        total = round(self.end_time - self.start_time, 2)
        lines = [
            f"\n=== Metrics Report ===",
            f"Task ID: {self.task_id}",
            f"Total duration: {total}s",
            f"LLM calls: {self.llm_calls}",
            f"Tool calls: {self.tool_calls}",
        ]
        for r in self.results:
            lines.append(
                f"  {r['test']}: {r['status']} ({r['duration_s']}s) {r['detail']}"
            )
        return "\n".join(lines)


class E2ETestBase(ABC):
    """E2E 测试基类

    子类继承此基类，使用真实数据和真实 LLM 调用，
    不允许 Mock LLM 或使用假数据（铁律 T1/T2）。
    """

    BASE_URL: str = "http://127.0.0.1:8000"
    DEFAULT_PERSONA: str = "default"
    DEFAULT_MODEL: str = "openroute/DeepSeek-V4-Pro"
    DEFAULT_TIMEOUT: int = 300

    def __init__(self):
        self.metrics = MetricsCollector(task_id="e2e-test")

    # ── 任务操作 ─────────────────────────────────────────────────

    def create_task(
        self,
        task: str,
        persona: Optional[str] = None,
        model: Optional[str] = None,
        mode: str = "helm",
    ) -> dict:
        """创建任务

        Args:
            task: 真实业务场景任务描述（铁律 T2）
            persona: 人设
            model: 模型
            mode: 执行模式

        Returns:
            创建的任务数据
        """
        persona = persona or self.DEFAULT_PERSONA
        model = model or self.DEFAULT_MODEL
        data = json.dumps({
            "task": task,
            "persona": persona,
            "mode": mode,
            "model": model,
        }).encode()
        req = urllib.request.Request(
            f"{self.BASE_URL}/api/v1/tasks",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        r = urllib.request.urlopen(req, timeout=30)
        return json.loads(r.read().decode())["data"]

    def wait_task(self, task_id: str, timeout: Optional[int] = None) -> Optional[dict]:
        """等待任务完成

        Args:
            task_id: 任务 ID
            timeout: 超时秒数

        Returns:
            任务结果数据，超时返回 None
        """
        timeout = timeout or self.DEFAULT_TIMEOUT
        for i in range(timeout // 5):
            time.sleep(5)
            try:
                r = urllib.request.urlopen(
                    f"{self.BASE_URL}/api/v1/tasks/{task_id}", timeout=10
                )
                d = json.loads(r.read().decode())["data"]
                status = d.get("status", "")
                if status in ("completed", "failed", "error", "rejected"):
                    return d
            except Exception:
                pass
        return None

    def run_task(
        self,
        task: str,
        persona: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[int] = None,
    ) -> Optional[dict]:
        """创建并等待任务完成（便捷方法）

        Args:
            task: 真实业务场景任务描述
            persona: 人设
            model: 模型
            timeout: 超时秒数

        Returns:
            任务结果数据
        """
        created = self.create_task(task, persona, model)
        task_id = created["task_id"]
        return self.wait_task(task_id, timeout)

    # ── 断言方法 ─────────────────────────────────────────────────

    def assert_task_completed(self, result: Optional[dict]) -> None:
        """断言任务已完成（铁律 T3：不跳过验证）"""
        assert result is not None, "Task timed out"
        status = result.get("status", "")
        assert status == "completed", (
            f"Expected status 'completed', got '{status}'"
            + (f": {result.get('error', '')[:200]}" if status == "error" else "")
        )

    def assert_result_quality(
        self,
        result: dict,
        min_length: int = 50,
        required_keys: Optional[List[str]] = None,
    ) -> None:
        """断言结果质量（铁律 T3：不跳过验证）

        Args:
            result: 任务结果
            min_length: 结果内容最小长度
            required_keys: 结果中必须包含的 key
        """
        summary = result.get("summary", "")
        assert len(summary) >= min_length, (
            f"Result too short: {len(summary)} chars (min {min_length})"
        )
        if required_keys:
            for key in required_keys:
                assert key in result, f"Missing required key: {key}"

    def assert_no_error(self, result: dict) -> None:
        """断言结果无错误"""
        assert not result.get("error"), f"Task has error: {result.get('error', '')[:300]}"
