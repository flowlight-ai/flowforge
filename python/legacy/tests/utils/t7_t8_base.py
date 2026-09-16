"""T7/T8 测试基础设施 — MetricsCollector + TestReporter。

供FlowForge及所有*Forge项目测试用例复用。

包含：
- MetricsCollector: 指标采集器（T6铁律）
- TestReporter: 测试报告生成器（含T7+T8联合验证报告）

使用方式：
    from flowforge.tests.utils.t7_t8_base import MetricsCollector, TestReporter
    from flowforge.tests.utils.t7_reviewer import T7Reviewer
    from flowforge.tests.utils.t8_dom_verifier import DOMVerifier

    metrics = MetricsCollector(task_id="test_001")
    reviewer = T7Reviewer()
    verifier = DOMVerifier()

    # ... 执行测试 ...

    reporter = TestReporter(metrics, reviewer, verifier)
    print(reporter.generate())
"""
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class MetricsCollector:
    """指标采集器，满足 T6 铁律。

    采集 LLM 调用次数、工具调用链、执行时长等指标。
    """
    task_id: str = ""
    start_time: float = field(default_factory=time.time)
    end_time: float = 0.0
    llm_calls: int = 0
    llm_details: List[Dict[str, Any]] = field(default_factory=list)
    tool_calls: int = 0
    tool_details: List[Dict[str, Any]] = field(default_factory=list)
    test_results: List[Dict[str, Any]] = field(default_factory=list)
    pass_count: int = 0
    fail_count: int = 0

    def record_test(self, name: str, passed: bool, detail: str = "",
                    duration: float = 0, llm_calls: int = 0, tool_calls: int = 0):
        """记录单个测试结果。"""
        self.test_results.append({
            "name": name,
            "passed": passed,
            "detail": detail,
            "duration_s": round(duration, 2),
            "llm_calls": llm_calls,
            "tool_calls": tool_calls,
        })
        if passed:
            self.pass_count += 1
        else:
            self.fail_count += 1
        self.llm_calls += llm_calls
        self.tool_calls += tool_calls

    def record_llm_call(self, agent: str = "", model: str = "", elapsed: float = 0,
                        input_tokens: int = 0, output_tokens: int = 0, status: str = "ok"):
        """记录LLM调用详情。"""
        self.llm_calls += 1
        self.llm_details.append({
            "agent": agent, "model": model, "elapsed_s": round(elapsed, 2),
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "status": status,
        })

    def record_tool_call(self, tool: str, status: str = "ok", detail: str = "", elapsed: float = 0):
        """记录工具调用详情。"""
        self.tool_calls += 1
        self.tool_details.append({
            "tool": tool, "status": status, "detail": detail, "elapsed_s": round(elapsed, 2),
        })

    def report(self) -> str:
        """生成指标报告。"""
        self.end_time = time.time()
        total = round(self.end_time - self.start_time, 2)
        lines = [
            f"\n{'='*60}",
            f"  Metrics Report (T6)",
            f"{'='*60}",
            f"Task ID: {self.task_id or 'N/A'}",
            f"Total duration: {total}s",
            f"LLM calls: {self.llm_calls}",
            f"Tool calls: {self.tool_calls}",
            f"Tests: {self.pass_count} passed, {self.fail_count} failed",
            f"{'='*60}",
        ]
        for r in self.test_results:
            icon = "OK" if r["passed"] else "FAIL"
            lines.append(f"  [{icon}] {r['name']} ({r['duration_s']}s) {r['detail']}")
        if self.llm_details:
            lines.append(f"\n  LLM调用详情:")
            for d in self.llm_details:
                lines.append(f"    - {d['agent']} -> {d['model']} ({d['elapsed_s']}s) {d['status']}")
        if self.tool_details:
            lines.append(f"\n  工具调用详情:")
            for d in self.tool_details:
                lines.append(f"    - {d['tool']} ({d['elapsed_s']}s) {d['status']} {d['detail']}")
        lines.append(f"{'='*60}")
        return "\n".join(lines)

    def exit_code(self) -> int:
        """返回退出码（0=全部通过，1=有失败）。"""
        return 0 if self.fail_count == 0 else 1


class TestReporter:
    """测试报告生成器 — 生成符合 V6 模板的验证结果报告。

    整合 T6（指标）、T7（LLM审核）、T8（DOM验证）三个维度的结果。
    """

    def __init__(self, metrics: MetricsCollector, reviewer=None, verifier=None):
        self.metrics = metrics
        self.reviewer = reviewer
        self.verifier = verifier

    def generate(self) -> str:
        """生成完整的验证结果报告。"""
        lines = [
            f"\n{'='*60}",
            f"  验证结果报告 (T6+T7+T8)",
            f"{'='*60}",
        ]

        # T7 LLM内容审核结果
        if self.reviewer and getattr(self.reviewer, "results", None):
            t7_results = self.reviewer.results
            lines.append(f"\n### LLM内容审核结果（T7）")
            lines.append(f"| 场景 | 生成内容 | 审核结果 | 审核原因 |")
            lines.append(f"|------|---------|---------|---------|")
            for r in t7_results:
                icon = "PASS" if r.get("passed") else "FAIL"
                preview = r.get("content_preview", "")[:30]
                lines.append(f"| {r.get('content_type', '?')} | {preview}... | {icon} {r.get('verdict', '?')} | {r.get('reason', '')[:50]} |")
        else:
            lines.append(f"\n### LLM内容审核结果（T7）— 无审核记录")

        # T8 DOM验证结果
        if self.verifier and getattr(self.verifier, "results", None):
            t8_results = self.verifier.results
            lines.append(f"\n### Web功能DOM验证结果（T8）")
            lines.append(f"| 场景 | 验证模式 | 目标 | DOM验证结果 | 详情 |")
            lines.append(f"|------|---------|------|------------|------|")
            for r in t8_results:
                icon = "PASS" if r.get("found") else "FAIL"
                url = r.get("url", "")[:30]
                lines.append(f"| {r.get('mode', '?')} | {r.get('mode', '?')} | {url} | {icon} | {r.get('detail', '')[:50]} |")
        else:
            lines.append(f"\n### Web功能DOM验证结果（T8）— 无验证记录")

        # 指标报告
        lines.append(self.metrics.report())

        # 总结
        t7_pass = sum(1 for r in (self.reviewer.results if self.reviewer else []) if r.get("passed"))
        t7_total = len(self.reviewer.results) if self.reviewer else 0
        t8_pass = sum(1 for r in (self.verifier.results if self.verifier else []) if r.get("found"))
        t8_total = len(self.verifier.results) if self.verifier else 0

        lines.append(f"\n### 总结")
        lines.append(f"- LLM审核(T7): {t7_pass}/{t7_total} 通过")
        lines.append(f"- DOM验证(T8): {t8_pass}/{t8_total} 通过")
        lines.append(f"- 测试指标(T6): {self.metrics.pass_count}/{self.metrics.pass_count + self.metrics.fail_count} 通过")
        all_pass = (
            self.metrics.fail_count == 0
            and t7_pass == t7_total
            and t8_pass == t8_total
        )
        lines.append(f"- 整体结论: {'全部通过 OK' if all_pass else '有失败项需修复 FAIL'}")
        lines.append(f"{'='*60}")
        return "\n".join(lines)


def print_result(name: str, passed: bool, detail: str = "", metrics: MetricsCollector = None):
    """打印测试结果并记录到指标。"""
    icon = "OK" if passed else "FAIL"
    print(f"  [{icon}] {name}" + (f" | {detail}" if detail else ""))
    if metrics:
        metrics.record_test(name, passed, detail)
