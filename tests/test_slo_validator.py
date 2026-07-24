"""SLOValidator 单元测试 — P3-002 性能 SLO 达标验证。

覆盖 :class:`SLOValidator` 的 5 个 SLO 验证逻辑、燃烧率计算、报告生成、
空数据默认健康、边界条件等场景。

测试铁律合规：
- **T1 不使用 Mock LLM**：本测试仅基于 metrics 数据验证，不调用 LLM
- **T2 不使用假数据**：测试数据为真实场景的 loop/llm/degradation 指标
- **T3 必须有具体断言**：每个测试用例均有明确 passed/burn_rate/error_budget 断言
- **T6 必须采集指标**：使用真实 MetricsCollector 实例采集指标
"""

from __future__ import annotations

import pytest

from flowforge.observability.metrics_collector import MetricsCollector
from flowforge.tools.slo_validator import (
    SLO_DEFINITIONS,
    SLOValidationResult,
    SLOValidator,
)


# ──────────────────────────────────────────────────────────────────
# SLOValidationResult 数据模型测试
# ──────────────────────────────────────────────────────────────────


class TestSLOValidationResult:
    """SLOValidationResult 字段测试。"""

    def test_default_field_values(self):
        """默认字段值：burn_rate=0.0, error_budget_remaining=1.0, details={}。"""
        result = SLOValidationResult(
            slo_id="SLO-X",
            name="测试 SLO",
            target="测试目标",
            actual="测试实际值",
            passed=True,
        )
        assert result.slo_id == "SLO-X"
        assert result.name == "测试 SLO"
        assert result.target == "测试目标"
        assert result.actual == "测试实际值"
        assert result.passed is True
        assert result.burn_rate == 0.0
        assert result.error_budget_remaining == 1.0
        assert result.details == {}

    def test_explicit_field_values(self):
        """显式字段值可正确赋值。"""
        result = SLOValidationResult(
            slo_id="SLO-1",
            name="Loop 执行时长",
            target="P95 < 180s",
            actual="P95 = 150.0s",
            passed=True,
            burn_rate=0.5,
            error_budget_remaining=0.5,
            details={"p95_seconds": 150.0, "sample_count": 100},
        )
        assert result.burn_rate == 0.5
        assert result.error_budget_remaining == 0.5
        assert result.details["p95_seconds"] == 150.0
        assert result.details["sample_count"] == 100

    def test_details_mutable_default_isolated(self):
        """details 默认值在不同实例间相互隔离（Pydantic Field default_factory）。"""
        r1 = SLOValidationResult(
            slo_id="SLO-1", name="n", target="t", actual="a", passed=True
        )
        r2 = SLOValidationResult(
            slo_id="SLO-2", name="n", target="t", actual="a", passed=True
        )
        r1.details["key"] = "value"
        assert "key" not in r2.details


# ──────────────────────────────────────────────────────────────────
# SLOValidator 初始化测试
# ──────────────────────────────────────────────────────────────────


class TestSLOValidatorInit:
    """SLOValidator 初始化测试。"""

    def test_init_with_explicit_collector(self):
        """显式传入 MetricsCollector 实例。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)
        assert validator.metrics_collector is mc
        assert validator.logger is not None

    def test_init_with_custom_logger(self):
        """自定义 logger 可被注入。"""
        mc = MetricsCollector()
        custom_logger = type("DummyLogger", (), {"info": lambda *a: None})()
        validator = SLOValidator(metrics_collector=mc, logger=custom_logger)
        assert validator.logger is custom_logger

    def test_validate_unknown_slo_raises(self):
        """未知 SLO ID 应抛出 ValueError。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)
        with pytest.raises(ValueError, match="未知 SLO ID"):
            validator.validate_slo("SLO-999")


# ──────────────────────────────────────────────────────────────────
# SLO-1: Loop 执行时长测试
# ──────────────────────────────────────────────────────────────────


class TestSLO1LoopDuration:
    """SLO-1: Loop 执行时长 P95 < 180s。"""

    def test_slo1_healthy_with_100_fast_loops(self):
        """健康场景：注入 100 个 loop_duration < 180s，SLO-1 通过。"""
        mc = MetricsCollector()
        # 100 个时长在 [30, 150] 区间的 loop，P95 应远低于 180s
        for i in range(100):
            duration = 30.0 + (i % 120)  # 30~149
            mc.record_loop_execution("creation", duration, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-1")

        assert result.slo_id == "SLO-1"
        assert result.passed is True
        assert result.details["p95_seconds"] < 180.0
        assert result.details["sample_count"] == 100
        assert result.burn_rate < 1.0  # 错误预算未耗尽
        assert "P95" in result.actual

    def test_slo1_unhealthy_with_50_slow_loops(self):
        """不健康场景：注入 50 个 loop_duration > 180s，SLO-1 失败。"""
        mc = MetricsCollector()
        # 50 个时长 200s 的 loop，P95 = 200s > 180s
        for _ in range(50):
            mc.record_loop_execution("creation", 200.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-1")

        assert result.passed is False
        assert result.details["p95_seconds"] >= 180.0
        # 50/50 全部超阈值 → error_rate=1.0, burn_rate = 1.0 / 0.05 = 20.0
        assert result.details["error_rate"] == pytest.approx(1.0)
        assert result.burn_rate == pytest.approx(20.0)
        assert result.error_budget_remaining == pytest.approx(0.0)

    def test_slo1_partial_exceed_burn_rate_calculation(self):
        """部分超阈值：5% 超阈值时 burn_rate=1.0（错误预算恰好耗尽）。"""
        mc = MetricsCollector()
        # 100 个 loop，5 个 200s + 95 个 100s → 5% 超阈值
        for _ in range(95):
            mc.record_loop_execution("creation", 100.0, True, 1, 0.9)
        for _ in range(5):
            mc.record_loop_execution("creation", 200.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-1")

        assert result.details["exceeded_count"] == 5
        assert result.details["error_rate"] == pytest.approx(0.05)
        assert result.burn_rate == pytest.approx(1.0)


# ──────────────────────────────────────────────────────────────────
# SLO-2: LLM webchat 调用时长测试
# ──────────────────────────────────────────────────────────────────


class TestSLO2WebchatDuration:
    """SLO-2: LLM webchat 调用时长 P95 < 30s。"""

    def test_slo2_healthy_with_fast_calls(self):
        """健康场景：注入 webchat 调用 P95 < 30s。"""
        mc = MetricsCollector()
        # 50 个 5-25s 的调用，P95 < 30s
        for i in range(50):
            duration = 5.0 + (i % 20)  # 5~24
            mc.record_llm_webchat_call("claude-3-5-sonnet", duration, True)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-2")

        assert result.slo_id == "SLO-2"
        assert result.passed is True
        assert result.details["p95_seconds"] < 30.0
        assert result.details["sample_count"] == 50
        assert result.burn_rate == pytest.approx(0.0)  # 无超阈值
        assert result.error_budget_remaining == pytest.approx(1.0)

    def test_slo2_unhealthy_with_slow_calls(self):
        """不健康场景：注入 webchat 调用 P95 >= 30s。"""
        mc = MetricsCollector()
        # 20 个 45s 的调用，P95 = 45s > 30s
        for _ in range(20):
            mc.record_llm_webchat_call("claude-3-5-sonnet", 45.0, True)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-2")

        assert result.passed is False
        assert result.details["p95_seconds"] >= 30.0
        # 全部超阈值 → error_rate=1.0, burn_rate = 1.0 / 0.01 = 100.0
        assert result.details["error_rate"] == pytest.approx(1.0)
        assert result.burn_rate == pytest.approx(100.0)


# ──────────────────────────────────────────────────────────────────
# SLO-3: 创建/润色接口时长测试
# ──────────────────────────────────────────────────────────────────


class TestSLO3ApiRequestDuration:
    """SLO-3: 创建/润色接口时长 P95 < 180s。"""

    def test_slo3_filters_creation_and_polish_loops(self):
        """SLO-3 仅统计 creation 与 polish 两个 loop_name 的时长。"""
        mc = MetricsCollector()
        # creation: 30 个快速 loop
        for _ in range(30):
            mc.record_loop_execution("creation", 60.0, True, 1, 0.9)
        # polish: 20 个快速 loop
        for _ in range(20):
            mc.record_loop_execution("polish", 40.0, True, 1, 0.9)
        # fact_check: 50 个慢速 loop（不应计入 SLO-3）
        for _ in range(50):
            mc.record_loop_execution("fact_check", 250.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-3")

        assert result.slo_id == "SLO-3"
        assert result.passed is True
        # 只统计 creation + polish = 50 个样本
        assert result.details["sample_count"] == 50
        assert result.details["p95_seconds"] < 180.0

    def test_slo3_unhealthy_when_creation_loop_slow(self):
        """creation loop 慢导致 SLO-3 失败。"""
        mc = MetricsCollector()
        # creation: 30 个 200s 慢 loop
        for _ in range(30):
            mc.record_loop_execution("creation", 200.0, True, 1, 0.9)
        # polish: 20 个 30s 快 loop
        for _ in range(20):
            mc.record_loop_execution("polish", 30.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-3")

        # 50 个样本中 30 个超阈值
        assert result.details["sample_count"] == 50
        assert result.details["exceeded_count"] == 30
        assert result.passed is False


# ──────────────────────────────────────────────────────────────────
# SLO-4: 降级率测试
# ──────────────────────────────────────────────────────────────────


class TestSLO4DegradationRate:
    """SLO-4: 降级率 < 5%。"""

    def test_slo4_healthy_low_degradation_rate(self):
        """健康场景：100 loop + 3 降级 = 3% < 5%，通过。"""
        mc = MetricsCollector()
        for _ in range(100):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        # 3 次降级 → 3%
        for _ in range(3):
            mc.record_degradation("llm_provider", "fallback", "r")

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-4")

        assert result.slo_id == "SLO-4"
        assert result.passed is True
        assert result.details["degradation_rate"] == pytest.approx(0.03)
        assert result.details["degradation_count"] == 3.0
        assert result.details["loop_count"] == 100.0
        # burn_rate = 0.03 / 0.05 = 0.6
        assert result.burn_rate == pytest.approx(0.6)
        assert result.error_budget_remaining == pytest.approx(0.4)

    def test_slo4_unhealthy_high_degradation_rate(self):
        """不健康场景：100 loop + 10 降级 = 10% > 5%，失败。"""
        mc = MetricsCollector()
        for _ in range(100):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        for _ in range(10):
            mc.record_degradation("llm_provider", "fallback", "r")

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-4")

        assert result.passed is False
        assert result.details["degradation_rate"] == pytest.approx(0.10)
        # burn_rate = 0.10 / 0.05 = 2.0
        assert result.burn_rate == pytest.approx(2.0)
        assert result.error_budget_remaining == pytest.approx(0.0)


# ──────────────────────────────────────────────────────────────────
# SLO-5: 系统可用性测试
# ──────────────────────────────────────────────────────────────────


class TestSLO5Availability:
    """SLO-5: 系统可用性 > 99.5%。"""

    def test_slo5_healthy_high_availability(self):
        """健康场景：200 个成功 + 1 个失败 = 99.5% 可用性边界之上。"""
        mc = MetricsCollector()
        # 199 成功 + 1 失败 = 99.5% 可用性边界之上（实际为 99.5%，需 > 99.5% 才通过）
        # 199/200 = 99.5% — 由于 passed 用 `> threshold`，恰好 99.5% 不通过
        # 改为 200 成功 + 1 失败 = 200/201 ≈ 99.502% > 99.5% 通过
        for _ in range(200):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        mc.record_loop_execution("creation", 30.0, False, 1, 0.0)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-5")

        assert result.slo_id == "SLO-5"
        assert result.passed is True
        assert result.details["availability"] > 0.995
        assert result.details["failure_count"] == 1.0
        assert result.details["total_count"] == 201.0

    def test_slo5_unhealthy_low_availability(self):
        """不健康场景：10 个成功 + 5 个失败 = 66.7% 可用性，失败。"""
        mc = MetricsCollector()
        for _ in range(10):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        for _ in range(5):
            mc.record_loop_execution("creation", 30.0, False, 1, 0.0)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-5")

        assert result.passed is False
        assert result.details["availability"] == pytest.approx(10.0 / 15.0)
        assert result.details["failure_rate"] == pytest.approx(5.0 / 15.0)
        # burn_rate = (5/15) / 0.005 ≈ 66.67
        assert result.burn_rate > 1.0


# ──────────────────────────────────────────────────────────────────
# validate_all 测试
# ──────────────────────────────────────────────────────────────────


class TestValidateAll:
    """validate_all 返回 5 个 SLO 结果。"""

    def test_validate_all_returns_5_results(self):
        """validate_all 返回 5 个 SLO 结果。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)
        results = validator.validate_all()

        assert isinstance(results, dict)
        assert len(results) == 5
        assert set(results.keys()) == {"SLO-1", "SLO-2", "SLO-3", "SLO-4", "SLO-5"}
        for slo_id, result in results.items():
            assert isinstance(result, SLOValidationResult)
            assert result.slo_id == slo_id

    def test_validate_all_all_pass_on_empty_metrics(self):
        """空 metrics 时所有 SLO 默认通过（健康）。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)
        results = validator.validate_all()

        for slo_id, result in results.items():
            assert result.passed is True, f"{slo_id} 应在空 metrics 时通过"
            assert result.burn_rate == 0.0
            assert result.error_budget_remaining == 1.0


# ──────────────────────────────────────────────────────────────────
# get_burn_rate 测试
# ──────────────────────────────────────────────────────────────────


class TestGetBurnRate:
    """get_burn_rate 计算测试。"""

    def test_get_burn_rate_healthy(self):
        """健康场景 burn_rate 接近 0。"""
        mc = MetricsCollector()
        for _ in range(50):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        burn_rate = validator.get_burn_rate("SLO-1")
        assert burn_rate == pytest.approx(0.0)

    def test_get_burn_rate_unhealthy(self):
        """不健康场景 burn_rate > 1.0。"""
        mc = MetricsCollector()
        for _ in range(20):
            mc.record_loop_execution("creation", 200.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        burn_rate = validator.get_burn_rate("SLO-1")
        # 100% 错误率 / 5% 预算 = 20.0
        assert burn_rate == pytest.approx(20.0)

    def test_get_burn_rate_unknown_slo_raises(self):
        """未知 SLO 抛出 ValueError。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)
        with pytest.raises(ValueError, match="未知 SLO ID"):
            validator.get_burn_rate("SLO-999")


# ──────────────────────────────────────────────────────────────────
# generate_report 测试
# ──────────────────────────────────────────────────────────────────


class TestGenerateReport:
    """generate_report Markdown 格式测试。"""

    def test_report_is_markdown_format(self):
        """报告为 Markdown 格式（含标题、表格、列表）。"""
        mc = MetricsCollector()
        mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        validator = SLOValidator(metrics_collector=mc)
        report = validator.generate_report()

        assert isinstance(report, str)
        assert report.startswith("# FlowForge SLO 验证报告")
        assert "## SLO 汇总" in report
        assert "## SLO 详情" in report
        # 表格头
        assert "| SLO ID |" in report
        assert "| 燃烧率 |" in report

    def test_report_contains_all_5_slos(self):
        """报告包含所有 5 个 SLO。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)
        report = validator.generate_report()

        for slo_id in ["SLO-1", "SLO-2", "SLO-3", "SLO-4", "SLO-5"]:
            assert slo_id in report

    def test_report_shows_pass_fail_status(self):
        """报告显示 PASS/FAIL 状态。"""
        mc = MetricsCollector()
        # 注入慢 loop 使 SLO-1 失败
        for _ in range(10):
            mc.record_loop_execution("creation", 200.0, True, 1, 0.9)
        validator = SLOValidator(metrics_collector=mc)
        report = validator.generate_report()

        assert "FAIL" in report
        assert "PASS" in report  # 至少 SLO-2/3/4/5 应通过


# ──────────────────────────────────────────────────────────────────
# 空 metrics 默认健康测试
# ──────────────────────────────────────────────────────────────────


class TestEmptyMetrics:
    """空 metrics 时返回 passed=True（默认健康）。"""

    def test_empty_metrics_all_slos_pass(self):
        """全新 MetricsCollector 所有 SLO 默认通过。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)

        for slo_id in ["SLO-1", "SLO-2", "SLO-3", "SLO-4", "SLO-5"]:
            result = validator.validate_slo(slo_id)
            assert result.passed is True, f"{slo_id} 应在空 metrics 时通过"
            assert result.burn_rate == 0.0
            assert result.error_budget_remaining == 1.0

    def test_empty_metrics_actual_shows_zero_samples(self):
        """空 metrics 时 actual 字段显示 samples=0。"""
        mc = MetricsCollector()
        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-1")
        assert "samples=0" in result.actual


# ──────────────────────────────────────────────────────────────────
# 边界条件测试
# ──────────────────────────────────────────────────────────────────


class TestBoundaryConditions:
    """边界条件（恰好达到阈值）。"""

    def test_slo1_boundary_p95_exactly_at_threshold(self):
        """SLO-1 边界：所有样本恰好 180s，P95=180s，passed=False（严格小于）。"""
        mc = MetricsCollector()
        # 20 个 180s 样本，P95=180s（严格 < 不通过）
        for _ in range(20):
            mc.record_loop_execution("creation", 180.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-1")

        # P95 = 180s, 严格 < 180 → 不通过
        assert result.details["p95_seconds"] == pytest.approx(180.0)
        # 180s >= 180s 视为超阈值，error_rate=1.0
        assert result.details["exceeded_count"] == 20
        assert result.passed is False

    def test_slo4_boundary_exactly_5_percent_degradation(self):
        """SLO-4 边界：降级率恰好 5%，passed=False（严格小于）。"""
        mc = MetricsCollector()
        # 100 loop + 5 降级 = 5%，严格 < 5% 不通过
        for _ in range(100):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        for _ in range(5):
            mc.record_degradation("llm_provider", "fallback", "r")

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-4")

        assert result.details["degradation_rate"] == pytest.approx(0.05)
        assert result.passed is False  # 严格 < 5%

    def test_slo5_boundary_exactly_99_5_percent_availability(self):
        """SLO-5 边界：可用性恰好 99.5%，passed=False（严格大于）。"""
        mc = MetricsCollector()
        # 199 成功 + 1 失败 = 199/200 = 99.5%，严格 > 99.5% 不通过
        for _ in range(199):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        mc.record_loop_execution("creation", 30.0, False, 1, 0.0)

        validator = SLOValidator(metrics_collector=mc)
        result = validator.validate_slo("SLO-5")

        assert result.details["availability"] == pytest.approx(0.995)
        assert result.passed is False  # 严格 > 99.5%

    def test_slo1_burn_rate_exactly_1_when_error_rate_equals_budget(self):
        """燃烧率边界：error_rate == error_budget 时 burn_rate=1.0。"""
        mc = MetricsCollector()
        # 100 个样本，5 个超阈值 → error_rate=0.05, burn_rate = 0.05/0.05 = 1.0
        for _ in range(95):
            mc.record_loop_execution("creation", 100.0, True, 1, 0.9)
        for _ in range(5):
            mc.record_loop_execution("creation", 200.0, True, 1, 0.9)

        validator = SLOValidator(metrics_collector=mc)
        burn_rate = validator.get_burn_rate("SLO-1")
        assert burn_rate == pytest.approx(1.0)


# ──────────────────────────────────────────────────────────────────
# SLO 定义完整性测试
# ──────────────────────────────────────────────────────────────────


class TestSLODefinitions:
    """SLO 定义完整性测试。"""

    def test_slo_definitions_has_5_slos(self):
        """SLO_DEFINITIONS 包含 5 个 SLO。"""
        assert len(SLO_DEFINITIONS) == 5
        assert set(SLO_DEFINITIONS.keys()) == {"SLO-1", "SLO-2", "SLO-3", "SLO-4", "SLO-5"}

    def test_each_slo_has_required_fields(self):
        """每个 SLO 定义包含 name、target、error_budget 字段。"""
        for slo_id, definition in SLO_DEFINITIONS.items():
            assert "name" in definition, f"{slo_id} 缺少 name"
            assert "target" in definition, f"{slo_id} 缺少 target"
            assert "error_budget" in definition, f"{slo_id} 缺少 error_budget"
            assert "description" in definition, f"{slo_id} 缺少 description"
            assert "metric" in definition, f"{slo_id} 缺少 metric"
