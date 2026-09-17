"""SLO Validator — P3-002 性能 SLO 达标验证工具。

基于 :class:`MetricsCollector` 的 in-memory 数据验证 5 个性能 SLO：

- **SLO-1**: Loop 执行时长 P95 < 180s（错误预算 5%）
- **SLO-2**: LLM webchat 调用时长 P95 < 30s（错误预算 1%）
- **SLO-3**: 创建/润色接口时长 P95 < 180s（错误预算 5%）
- **SLO-4**: 降级率 < 5%（错误预算 0%，实际阈值 5%）
- **SLO-5**: 系统可用性 > 99.5%（错误预算 0.5%）

设计约束：
1. **不依赖真实 Prometheus 查询**：仅基于 :class:`MetricsCollector` in-memory 数据
2. **不调用真实 LLM**：仅基于 metrics 数据验证
3. **DI 容器集成**：通过构造函数注入 :class:`MetricsCollector`
4. **类型注解强制**：所有方法签名使用 Python 3.11+ 类型注解
5. **不简化质量标准**：仅做 SLO 达标判定，不修改 Loop 流程或质量门禁

详细 SLO 定义见 :doc:`flowforge/docs/design/D047-performance-slo.md`
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.observability.metrics_collector import MetricsCollector


# ── SLO 定义 ──────────────────────────────────────────────────────────


SLO_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "SLO-1": {
        "name": "Loop 执行时长",
        "target": "P95 < 180s",
        "metric": "flowforge_loop_duration_seconds",
        "threshold_seconds": 180.0,
        "error_budget": 0.05,  # 5%
        "description": "Loop 执行 P95 时长应小于 180 秒（3 分钟）",
    },
    "SLO-2": {
        "name": "LLM webchat 调用时长",
        "target": "P95 < 30s",
        "metric": "flowforge_llm_webchat_duration_seconds",
        "threshold_seconds": 30.0,
        "error_budget": 0.01,  # 1%
        "description": "LLM webchat 调用 P95 时长应小于 30 秒",
    },
    "SLO-3": {
        "name": "创建/润色接口时长",
        "target": "P95 < 180s",
        "metric": "flowforge_api_request_duration_seconds",
        "threshold_seconds": 180.0,
        "error_budget": 0.05,  # 5%
        "description": "创建/润色接口 P95 时长应小于 180 秒（由 loop_duration{loop_name=creation|polish} 派生）",
        "source_loop_names": ("creation", "polish"),
    },
    "SLO-4": {
        "name": "降级率",
        "target": "< 5%",
        "metric": "flowforge_degradation_total / flowforge_loop_total",
        "threshold_rate": 0.05,
        "error_budget": 0.05,  # 与阈值相等
        "description": "降级率应小于 5%",
    },
    "SLO-5": {
        "name": "系统可用性",
        "target": "> 99.5%",
        "metric": "1 - (failed_loops / total_loops)",
        "threshold_availability": 0.995,
        "error_budget": 0.005,  # 0.5%
        "description": "系统可用性应大于 99.5%（任务失败率 < 0.5%）",
    },
}


# ── 数据模型 ──────────────────────────────────────────────────────────


class SLOValidationResult(BaseModel):
    """SLO 验证结果。

    Attributes:
        slo_id: SLO 标识符（如 ``SLO-1``）。
        name: SLO 名称。
        target: SLO 目标描述（如 ``P95 < 180s``）。
        actual: 实际测量值描述（如 ``P95 = 145.20s (samples=87)``）。
        passed: 是否通过 SLO。
        burn_rate: 燃烧率（实际错误率 / 错误预算），0.0 表示无错误。
        error_budget_remaining: 错误预算剩余比例（0.0-1.0），1.0 表示完全健康。
        details: 详细指标数据（包含 p95_seconds、sample_count、error_rate 等）。
    """

    slo_id: str
    name: str
    target: str
    actual: str
    passed: bool
    burn_rate: float = 0.0
    error_budget_remaining: float = 1.0
    details: Dict[str, Any] = Field(default_factory=dict)


# ── 验证器 ────────────────────────────────────────────────────────────


class SLOValidator:
    """SLO 验证器。

    基于 :class:`MetricsCollector` 的 in-memory 数据验证 5 个性能 SLO。

    Args:
        metrics_collector: :class:`MetricsCollector` 实例，通过 DI 容器注入。
        logger: 可选的日志记录器，为 None 则使用默认 logger。

    Example:
        >>> from flowforge.tools.slo_validator import SLOValidator
        >>> from flowforge.observability.metrics_collector import MetricsCollector
        >>> mc = MetricsCollector()
        >>> mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        >>> validator = SLOValidator(metrics_collector=mc)
        >>> result = validator.validate_slo("SLO-1")
        >>> result.passed
        True
        >>> report = validator.generate_report()
    """

    def __init__(
        self,
        metrics_collector: MetricsCollector,
        logger: Optional[Any] = None,
    ) -> None:
        self.metrics_collector: MetricsCollector = metrics_collector
        self.logger = logger if logger is not None else get_logger("tools.slo_validator")

    # ── 公开 API ──────────────────────────────────────────────────────

    def validate_all(self) -> Dict[str, SLOValidationResult]:
        """验证所有 5 个 SLO。

        Returns:
            以 SLO ID 为键的验证结果字典。
        """
        results: Dict[str, SLOValidationResult] = {}
        for slo_id in SLO_DEFINITIONS:
            results[slo_id] = self.validate_slo(slo_id)
        self.logger.debug(
            f"SLO validation completed: {sum(1 for r in results.values() if r.passed)}/{len(results)} passed"
        )
        return results

    def validate_slo(self, slo_id: str) -> SLOValidationResult:
        """验证单个 SLO。

        Args:
            slo_id: SLO 标识符（如 ``SLO-1``）。

        Returns:
            :class:`SLOValidationResult` 验证结果。

        Raises:
            ValueError: 当 ``slo_id`` 不在已定义的 SLO 列表中时。
        """
        if slo_id not in SLO_DEFINITIONS:
            raise ValueError(
                f"未知 SLO ID: {slo_id}，支持的 SLO: {list(SLO_DEFINITIONS.keys())}"
            )

        handler = {
            "SLO-1": self._validate_loop_duration,
            "SLO-2": self._validate_webchat_duration,
            "SLO-3": self._validate_api_request_duration,
            "SLO-4": self._validate_degradation_rate,
            "SLO-5": self._validate_availability,
        }[slo_id]
        return handler()

    def get_burn_rate(self, slo_id: str) -> float:
        """计算指定 SLO 的燃烧率。

        燃烧率 = 实际错误率 / 错误预算。
        - ``0.0``：完全健康（无错误）
        - ``1.0``：错误预算耗尽（恰好达到 SLO 阈值）
        - ``> 1.0``：SLO 已超标

        Args:
            slo_id: SLO 标识符。

        Returns:
            燃烧率浮点数。
        """
        return self.validate_slo(slo_id).burn_rate

    def generate_report(self) -> str:
        """生成 Markdown 格式的 SLO 验证报告。

        Returns:
            Markdown 格式字符串，包含汇总表与各 SLO 详情。
        """
        results = self.validate_all()
        total = len(results)
        passed = sum(1 for r in results.values() if r.passed)
        failed = total - passed

        lines: list[str] = []
        lines.append("# FlowForge SLO 验证报告")
        lines.append("")
        lines.append(f"**总体状态**: {passed}/{total} 通过，{failed} 失败")
        lines.append("")
        lines.append("## SLO 汇总")
        lines.append("")
        lines.append("| SLO ID | 名称 | 目标 | 实际值 | 状态 | 燃烧率 | 错误预算剩余 |")
        lines.append("|--------|------|------|--------|------|--------|-------------|")
        for slo_id, result in results.items():
            status = "✅ PASS" if result.passed else "❌ FAIL"
            lines.append(
                f"| {slo_id} | {result.name} | {result.target} | "
                f"{result.actual} | {status} | {result.burn_rate:.2f}x | "
                f"{result.error_budget_remaining:.1%} |"
            )
        lines.append("")
        lines.append("## SLO 详情")
        lines.append("")
        for slo_id, result in results.items():
            lines.append(f"### {slo_id}: {result.name}")
            lines.append("")
            lines.append(f"- **目标**: {result.target}")
            lines.append(f"- **实际值**: {result.actual}")
            lines.append(f"- **状态**: {'PASS' if result.passed else 'FAIL'}")
            lines.append(f"- **燃烧率**: {result.burn_rate:.2f}x")
            lines.append(f"- **错误预算剩余**: {result.error_budget_remaining:.1%}")
            if result.details:
                lines.append("- **详细数据**:")
                for key, value in result.details.items():
                    if isinstance(value, float):
                        lines.append(f"  - `{key}`: {value:.4f}")
                    else:
                        lines.append(f"  - `{key}`: {value}")
            lines.append("")
        return "\n".join(lines)

    # ── 私有验证方法 ──────────────────────────────────────────────────

    def _validate_loop_duration(self) -> SLOValidationResult:
        """验证 SLO-1: Loop 执行时长 P95 < 180s。"""
        definition = SLO_DEFINITIONS["SLO-1"]
        slo_status = self.metrics_collector.get_slo_status()
        p95 = slo_status["loop_p95_seconds"]
        sample_count = slo_status["loop_sample_count"]
        passed = slo_status["loop_3min_slo"]

        recent_values = self.metrics_collector._recent_histogram_values(
            "flowforge_loop_duration_seconds",
            self.metrics_collector.SLO_WINDOW_SECONDS,
        )
        threshold = definition["threshold_seconds"]
        error_budget = definition["error_budget"]

        if recent_values:
            exceeded = sum(1 for v in recent_values if v >= threshold)
            error_rate = exceeded / len(recent_values)
        else:
            error_rate = 0.0

        burn_rate = error_rate / error_budget if error_budget > 0 else 0.0
        error_budget_remaining = max(0.0, 1.0 - burn_rate)

        return SLOValidationResult(
            slo_id="SLO-1",
            name=definition["name"],
            target=definition["target"],
            actual=f"P95 = {p95:.2f}s (samples={sample_count})",
            passed=passed,
            burn_rate=burn_rate,
            error_budget_remaining=error_budget_remaining,
            details={
                "p95_seconds": p95,
                "threshold_seconds": threshold,
                "sample_count": sample_count,
                "error_rate": error_rate,
                "error_budget": error_budget,
                "exceeded_count": sum(1 for v in recent_values if v >= threshold),
                "metric": definition["metric"],
                "window_seconds": self.metrics_collector.SLO_WINDOW_SECONDS,
            },
        )

    def _validate_webchat_duration(self) -> SLOValidationResult:
        """验证 SLO-2: LLM webchat 调用时长 P95 < 30s。"""
        definition = SLO_DEFINITIONS["SLO-2"]
        slo_status = self.metrics_collector.get_slo_status()
        p95 = slo_status["webchat_p95_seconds"]
        sample_count = slo_status["webchat_sample_count"]
        passed = slo_status["webchat_30s_slo"]

        recent_values = self.metrics_collector._recent_histogram_values(
            "flowforge_llm_webchat_duration_seconds",
            self.metrics_collector.SLO_WINDOW_SECONDS,
        )
        threshold = definition["threshold_seconds"]
        error_budget = definition["error_budget"]

        if recent_values:
            exceeded = sum(1 for v in recent_values if v >= threshold)
            error_rate = exceeded / len(recent_values)
        else:
            error_rate = 0.0

        burn_rate = error_rate / error_budget if error_budget > 0 else 0.0
        error_budget_remaining = max(0.0, 1.0 - burn_rate)

        return SLOValidationResult(
            slo_id="SLO-2",
            name=definition["name"],
            target=definition["target"],
            actual=f"P95 = {p95:.2f}s (samples={sample_count})",
            passed=passed,
            burn_rate=burn_rate,
            error_budget_remaining=error_budget_remaining,
            details={
                "p95_seconds": p95,
                "threshold_seconds": threshold,
                "sample_count": sample_count,
                "error_rate": error_rate,
                "error_budget": error_budget,
                "exceeded_count": sum(1 for v in recent_values if v >= threshold),
                "metric": definition["metric"],
                "window_seconds": self.metrics_collector.SLO_WINDOW_SECONDS,
            },
        )

    def _validate_api_request_duration(self) -> SLOValidationResult:
        """验证 SLO-3: 创建/润色接口时长 P95 < 180s。

        实际数据源：``flowforge_loop_duration_seconds{loop_name=creation|polish}``。
        概念性指标 ``flowforge_api_request_duration_seconds`` 由上述数据派生。
        """
        definition = SLO_DEFINITIONS["SLO-3"]
        threshold = definition["threshold_seconds"]
        error_budget = definition["error_budget"]
        source_loop_names: tuple[str, ...] = definition["source_loop_names"]

        # 从 metrics_collector 中按 loop_name 过滤最近窗口的观测值
        recent_values = self._recent_loop_durations_by_names(source_loop_names)
        sample_count = len(recent_values)

        if recent_values:
            p95 = MetricsCollector._percentile(recent_values, 95)
            passed = p95 < threshold
            exceeded = sum(1 for v in recent_values if v >= threshold)
            error_rate = exceeded / sample_count
        else:
            p95 = 0.0
            passed = True  # 无数据时默认健康
            error_rate = 0.0
            exceeded = 0

        burn_rate = error_rate / error_budget if error_budget > 0 else 0.0
        error_budget_remaining = max(0.0, 1.0 - burn_rate)

        return SLOValidationResult(
            slo_id="SLO-3",
            name=definition["name"],
            target=definition["target"],
            actual=f"P95 = {p95:.2f}s (samples={sample_count}, loops={list(source_loop_names)})",
            passed=passed,
            burn_rate=burn_rate,
            error_budget_remaining=error_budget_remaining,
            details={
                "p95_seconds": p95,
                "threshold_seconds": threshold,
                "sample_count": sample_count,
                "error_rate": error_rate,
                "error_budget": error_budget,
                "exceeded_count": exceeded,
                "metric": definition["metric"],
                "source_loop_names": list(source_loop_names),
                "window_seconds": self.metrics_collector.SLO_WINDOW_SECONDS,
            },
        )

    def _validate_degradation_rate(self) -> SLOValidationResult:
        """验证 SLO-4: 降级率 < 5%。"""
        definition = SLO_DEFINITIONS["SLO-4"]
        slo_status = self.metrics_collector.get_slo_status()
        degradation_rate = slo_status["degradation_rate"]
        threshold = definition["threshold_rate"]
        error_budget = definition["error_budget"]

        passed = degradation_rate < threshold

        # 降级率错误预算 = 阈值本身（5%），燃烧率 = degradation_rate / 0.05
        burn_rate = degradation_rate / error_budget if error_budget > 0 else 0.0
        error_budget_remaining = max(0.0, 1.0 - burn_rate)

        # 提取降级总数与 loop 总数用于详情
        degradation_count = sum(
            v for k, v in self.metrics_collector._counters.items()
            if k.startswith("flowforge_degradation_total{")
        )
        loop_count = sum(
            v for k, v in self.metrics_collector._counters.items()
            if k.startswith("flowforge_loop_total{")
        )

        return SLOValidationResult(
            slo_id="SLO-4",
            name=definition["name"],
            target=definition["target"],
            actual=f"降级率 = {degradation_rate:.2%} ({degradation_count}/{loop_count})",
            passed=passed,
            burn_rate=burn_rate,
            error_budget_remaining=error_budget_remaining,
            details={
                "degradation_rate": degradation_rate,
                "threshold_rate": threshold,
                "degradation_count": degradation_count,
                "loop_count": loop_count,
                "error_budget": error_budget,
                "metric": definition["metric"],
            },
        )

    def _validate_availability(self) -> SLOValidationResult:
        """验证 SLO-5: 系统可用性 > 99.5%。

        基于 ``flowforge_loop_total{success=true|false}`` 计算任务失败率：
        ``availability = 1 - failed_loops / total_loops``。
        """
        definition = SLO_DEFINITIONS["SLO-5"]
        threshold_availability = definition["threshold_availability"]
        error_budget = definition["error_budget"]

        # 从 metrics_collector._counters 累计成功与失败 loop 数
        success_count = 0.0
        failure_count = 0.0
        for key, value in self.metrics_collector._counters.items():
            if not key.startswith("flowforge_loop_total{"):
                continue
            # 解析 labels 中 success 字段
            if "success=true" in key:
                success_count += value
            elif "success=false" in key:
                failure_count += value

        total = success_count + failure_count
        if total > 0:
            failure_rate = failure_count / total
            availability = 1.0 - failure_rate
            passed = availability > threshold_availability
        else:
            failure_rate = 0.0
            availability = 1.0
            passed = True  # 无数据时默认健康

        burn_rate = failure_rate / error_budget if error_budget > 0 else 0.0
        error_budget_remaining = max(0.0, 1.0 - burn_rate)

        return SLOValidationResult(
            slo_id="SLO-5",
            name=definition["name"],
            target=definition["target"],
            actual=f"可用性 = {availability:.4%} (failed={int(failure_count)}/{int(total)})",
            passed=passed,
            burn_rate=burn_rate,
            error_budget_remaining=error_budget_remaining,
            details={
                "availability": availability,
                "failure_rate": failure_rate,
                "success_count": success_count,
                "failure_count": failure_count,
                "total_count": total,
                "threshold_availability": threshold_availability,
                "error_budget": error_budget,
                "metric": definition["metric"],
            },
        )

    # ── 辅助方法 ──────────────────────────────────────────────────────

    def _recent_loop_durations_by_names(
        self,
        loop_names: tuple[str, ...],
    ) -> list[float]:
        """获取最近 SLO 窗口内指定 loop_name 列表的 loop_duration 观测值。

        Args:
            loop_names: loop_name 元组（如 ``("creation", "polish")``）。

        Returns:
            观测值列表。
        """
        import time

        now = time.time()
        cutoff = now - self.metrics_collector.SLO_WINDOW_SECONDS
        result: list[float] = []
        for key, values in self.metrics_collector._histograms.items():
            # 解析 key：flowforge_loop_duration_seconds{loop_name=creation}
            if not key.startswith("flowforge_loop_duration_seconds{"):
                continue
            # 检查 loop_name 是否在目标列表中
            matched = any(
                f"loop_name={ln}" in key for ln in loop_names
            )
            if not matched:
                continue
            timestamps = self.metrics_collector._histogram_timestamps.get(key, [])
            for ts, val in zip(timestamps, values):
                if ts >= cutoff:
                    result.append(val)
        return result
