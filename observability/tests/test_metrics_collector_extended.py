"""MetricsCollector 扩展指标单元测试（P3-003）。

覆盖 T6 测试铁律：E2E 测试必须用 MetricsCollector 采集完整指标。
本测试模块验证 Loop/LLM/降级恢复/Provider 配额 6 类新增 record 方法、
业务汇总方法、SLO 判定逻辑、histogram bucket 输出格式，
以及 T6 铁律合规性（一个 MetricsCollector 实例可完整采集 E2E 流程的所有指标）。
"""

import time

import pytest

from flowforge.observability.metrics_collector import MetricsCollector

# ──────────────────────────────────────────────────────────────────
# Loop 执行指标测试
# ──────────────────────────────────────────────────────────────────


class TestRecordLoopExecution:
    """record_loop_execution 测试。"""

    def test_basic_success(self):
        """基本成功执行：4 个指标全部记录。"""
        mc = MetricsCollector()
        mc.record_loop_execution(
            loop_name="creation",
            duration_seconds=120.0,
            success=True,
            iteration_count=3,
            quality_score=0.92,
        )
        all_metrics = mc.get_all_metrics()
        # counter: flowforge_loop_total{loop_name=creation,success=true}
        assert any(
            "flowforge_loop_total{" in k and "loop_name=creation" in k and "success=true" in k
            for k in all_metrics["counters"]
        )
        # histogram: flowforge_loop_duration_seconds{loop_name=creation}
        assert any(
            "flowforge_loop_duration_seconds{" in k and "loop_name=creation" in k
            for k in all_metrics["histograms"]
        )
        # counter: flowforge_loop_iterations_total{loop_name=creation}
        iter_key = next(
            k for k in all_metrics["counters"]
            if k.startswith("flowforge_loop_iterations_total{") and "loop_name=creation" in k
        )
        assert all_metrics["counters"][iter_key] == 3.0
        # gauge: flowforge_loop_quality_score{loop_name=creation}
        quality_key = next(
            k for k in all_metrics["gauges"]
            if k.startswith("flowforge_loop_quality_score{") and "loop_name=creation" in k
        )
        assert all_metrics["gauges"][quality_key] == pytest.approx(0.92)

    def test_failure_label(self):
        """失败执行：success=false 标签正确。"""
        mc = MetricsCollector()
        mc.record_loop_execution(
            loop_name="polish",
            duration_seconds=60.0,
            success=False,
            iteration_count=1,
            quality_score=0.0,
        )
        all_metrics = mc.get_all_metrics()
        assert any(
            "flowforge_loop_total{" in k and "success=false" in k
            for k in all_metrics["counters"]
        )

    @pytest.mark.parametrize("loop_name,success", [
        ("creation", True),
        ("creation", False),
        ("polish", True),
        ("polish", False),
        ("fact_check", True),
    ])
    def test_parameterized_label_combinations(self, loop_name: str, success: bool):
        """参数化：多种 loop_name 与 success 组合分别记录。"""
        mc = MetricsCollector()
        mc.record_loop_execution(
            loop_name=loop_name,
            duration_seconds=30.0,
            success=success,
            iteration_count=1,
            quality_score=0.5,
        )
        all_metrics = mc.get_all_metrics()
        success_label = "true" if success else "false"
        assert any(
            f"loop_name={loop_name}" in k and f"success={success_label}" in k
            for k in all_metrics["counters"]
            if k.startswith("flowforge_loop_total{")
        )

    def test_multiple_loops_tracked_separately(self):
        """不同 loop_name 的指标分别记录。"""
        mc = MetricsCollector()
        mc.record_loop_execution("creation", 100.0, True, 2, 0.9)
        mc.record_loop_execution("polish", 50.0, True, 1, 0.95)
        all_metrics = mc.get_all_metrics()
        creation_keys = [k for k in all_metrics["counters"] if "loop_name=creation" in k]
        polish_keys = [k for k in all_metrics["counters"] if "loop_name=polish" in k]
        assert len(creation_keys) > 0
        assert len(polish_keys) > 0
        # 不应混合
        assert not any("loop_name=creation" in k and "loop_name=polish" in k for k in all_metrics["counters"])

    def test_iterations_counter_accumulates(self):
        """iterations 计数器累加。"""
        mc = MetricsCollector()
        mc.record_loop_execution("creation", 30.0, True, iteration_count=2)
        mc.record_loop_execution("creation", 30.0, True, iteration_count=3)
        all_metrics = mc.get_all_metrics()
        iter_key = next(
            k for k in all_metrics["counters"]
            if k.startswith("flowforge_loop_iterations_total{") and "loop_name=creation" in k
        )
        assert all_metrics["counters"][iter_key] == 5.0

    def test_quality_gauge_overwrites(self):
        """quality_score gauge 后写覆盖前值。"""
        mc = MetricsCollector()
        mc.record_loop_execution("creation", 30.0, True, 1, quality_score=0.6)
        mc.record_loop_execution("creation", 30.0, True, 1, quality_score=0.9)
        all_metrics = mc.get_all_metrics()
        quality_key = next(
            k for k in all_metrics["gauges"]
            if k.startswith("flowforge_loop_quality_score{") and "loop_name=creation" in k
        )
        assert all_metrics["gauges"][quality_key] == pytest.approx(0.9)


class TestRecordLoopStep:
    """record_loop_step 测试。"""

    def test_basic(self):
        """基本单步执行。"""
        mc = MetricsCollector()
        mc.record_loop_step("creation", "discover", 5.0, True)
        all_metrics = mc.get_all_metrics()
        assert any(
            k.startswith("flowforge_loop_step_duration_seconds{") and "step_name=discover" in k
            for k in all_metrics["histograms"]
        )
        assert any(
            k.startswith("flowforge_loop_step_total{") and "step_name=discover" in k and "success=true" in k
            for k in all_metrics["counters"]
        )

    @pytest.mark.parametrize("step_name", ["discover", "assign", "act", "verify", "persist"])
    def test_parameterized_step_names(self, step_name: str):
        """参数化：5 大步骤名都能记录。"""
        mc = MetricsCollector()
        mc.record_loop_step("creation", step_name, 5.0, True)
        all_metrics = mc.get_all_metrics()
        assert any(
            f"step_name={step_name}" in k
            for k in all_metrics["histograms"]
            if k.startswith("flowforge_loop_step_duration_seconds{")
        )

    @pytest.mark.parametrize("success", [True, False])
    def test_success_failure_labels(self, success: bool):
        """参数化：success/failure 标签。"""
        mc = MetricsCollector()
        mc.record_loop_step("creation", "act", 5.0, success)
        all_metrics = mc.get_all_metrics()
        success_label = "true" if success else "false"
        assert any(
            f"success={success_label}" in k
            for k in all_metrics["counters"]
            if k.startswith("flowforge_loop_step_total{")
        )

    def test_duration_histogram_accumulates(self):
        """直方图累积多次观测。"""
        mc = MetricsCollector()
        mc.record_loop_step("creation", "act", 1.0, True)
        mc.record_loop_step("creation", "act", 3.0, True)
        all_metrics = mc.get_all_metrics()
        hist_key = next(
            k for k in all_metrics["histograms"]
            if k.startswith("flowforge_loop_step_duration_seconds{") and "step_name=act" in k
        )
        assert all_metrics["histograms"][hist_key]["count"] == 2
        assert all_metrics["histograms"][hist_key]["sum"] == pytest.approx(4.0)


# ──────────────────────────────────────────────────────────────────
# LLM 调用指标测试
# ──────────────────────────────────────────────────────────────────


class TestRecordLLMCall:
    """record_llm_call 测试。"""

    def test_basic_with_tokens(self):
        """基本调用：含 token。"""
        mc = MetricsCollector()
        mc.record_llm_call(
            model="claude-3-5-sonnet",
            provider="openrouter",
            duration_seconds=2.5,
            success=True,
            token_usage=1500,
            call_type="chat",
        )
        all_metrics = mc.get_all_metrics()
        assert any(
            "flowforge_llm_calls_total{" in k
            and "model=claude-3-5-sonnet" in k
            and "provider=openrouter" in k
            and "success=true" in k
            and "call_type=chat" in k
            for k in all_metrics["counters"]
        )
        assert any(
            "flowforge_llm_duration_seconds{" in k
            and "model=claude-3-5-sonnet" in k
            for k in all_metrics["histograms"]
        )
        token_key = next(
            k for k in all_metrics["counters"]
            if k.startswith("flowforge_llm_tokens_total{") and "model=claude-3-5-sonnet" in k
        )
        assert all_metrics["counters"][token_key] == 1500.0

    def test_no_tokens_when_zero(self):
        """token_usage=0 时不记录 token 指标。"""
        mc = MetricsCollector()
        mc.record_llm_call(
            model="gpt-4o",
            provider="openai",
            duration_seconds=1.0,
            success=True,
            token_usage=0,
        )
        all_metrics = mc.get_all_metrics()
        assert not any(
            k.startswith("flowforge_llm_tokens_total{") for k in all_metrics["counters"]
        )

    @pytest.mark.parametrize("model,provider", [
        ("claude-3-5-sonnet", "openrouter"),
        ("gpt-4o", "openai"),
        ("doubao-pro", "doubao"),
        ("deepseek-chat", "deepseek"),
    ])
    def test_parameterized_models(self, model: str, provider: str):
        """参数化：多种模型/提供方组合。"""
        mc = MetricsCollector()
        mc.record_llm_call(model, provider, 1.0, True, 100, "chat")
        all_metrics = mc.get_all_metrics()
        assert any(
            f"model={model}" in k and f"provider={provider}" in k
            for k in all_metrics["counters"]
            if k.startswith("flowforge_llm_calls_total{")
        )

    @pytest.mark.parametrize("call_type", ["chat", "embedding", "review", "judge", "summarize"])
    def test_parameterized_call_types(self, call_type: str):
        """参数化：多种 call_type。"""
        mc = MetricsCollector()
        mc.record_llm_call("claude-3-5-sonnet", "openrouter", 1.0, True, 100, call_type)
        all_metrics = mc.get_all_metrics()
        assert any(
            f"call_type={call_type}" in k
            for k in all_metrics["counters"]
            if k.startswith("flowforge_llm_calls_total{")
        )

    def test_failure_does_not_skip_histogram(self):
        """失败调用也记录 histogram。"""
        mc = MetricsCollector()
        mc.record_llm_call("claude-3-5-sonnet", "openrouter", 5.0, success=False)
        all_metrics = mc.get_all_metrics()
        assert any(
            k.startswith("flowforge_llm_duration_seconds{")
            for k in all_metrics["histograms"]
        )


class TestRecordLLMWebchatCall:
    """record_llm_webchat_call 测试。"""

    def test_basic(self):
        """基本 webchat 调用。"""
        mc = MetricsCollector()
        mc.record_llm_webchat_call("claude-3-5-sonnet", 15.0, True)
        all_metrics = mc.get_all_metrics()
        # 计入 flowforge_llm_calls_total (call_type=webchat)
        assert any(
            "flowforge_llm_calls_total{" in k
            and "call_type=webchat" in k
            and "provider=webchat" in k
            for k in all_metrics["counters"]
        )
        # 同时记录到独立直方图
        assert any(
            k.startswith("flowforge_llm_webchat_duration_seconds{")
            for k in all_metrics["histograms"]
        )

    @pytest.mark.parametrize("model", ["claude-3-5-sonnet", "gpt-4o", "doubao-pro"])
    def test_parameterized_models(self, model: str):
        """参数化：多种模型。"""
        mc = MetricsCollector()
        mc.record_llm_webchat_call(model, 10.0, True)
        all_metrics = mc.get_all_metrics()
        assert any(
            f"model={model}" in k
            for k in all_metrics["histograms"]
            if k.startswith("flowforge_llm_webchat_duration_seconds{")
        )

    def test_separate_from_general_llm_duration(self):
        """webchat 调用不污染 flowforge_llm_duration_seconds 直方图。"""
        mc = MetricsCollector()
        mc.record_llm_webchat_call("claude-3-5-sonnet", 15.0, True)
        all_metrics = mc.get_all_metrics()
        # webchat 调用只计入 webchat_duration_seconds，不计入 llm_duration_seconds
        assert not any(
            k.startswith("flowforge_llm_duration_seconds{")
            for k in all_metrics["histograms"]
        )

    def test_failure_label(self):
        """失败调用：success=false。"""
        mc = MetricsCollector()
        mc.record_llm_webchat_call("claude-3-5-sonnet", 5.0, False)
        all_metrics = mc.get_all_metrics()
        assert any(
            "success=false" in k and "call_type=webchat" in k
            for k in all_metrics["counters"]
            if k.startswith("flowforge_llm_calls_total{")
        )


# ──────────────────────────────────────────────────────────────────
# 降级与恢复指标测试
# ──────────────────────────────────────────────────────────────────


class TestRecordDegradation:
    """record_degradation 测试。"""

    def test_basic(self):
        """基本降级记录。"""
        mc = MetricsCollector()
        mc.record_degradation(
            component="llm_provider",
            action_type="fallback",
            reason="openroute 5xx",
        )
        all_metrics = mc.get_all_metrics()
        key = next(
            k for k in all_metrics["counters"]
            if k.startswith("flowforge_degradation_total{")
            and "component=llm_provider" in k
            and "action_type=fallback" in k
        )
        assert all_metrics["counters"][key] == 1.0

    @pytest.mark.parametrize("component,action_type", [
        ("llm_provider", "fallback"),
        ("llm_provider", "skip"),
        ("openroute", "disable"),
        ("loop_executor", "cache_only"),
        ("openroute", "circuit_break"),
    ])
    def test_parameterized_label_combinations(self, component: str, action_type: str):
        """参数化：多种 component/action_type 组合。"""
        mc = MetricsCollector()
        mc.record_degradation(component, action_type, "test reason")
        all_metrics = mc.get_all_metrics()
        assert any(
            f"component={component}" in k and f"action_type={action_type}" in k
            for k in all_metrics["counters"]
            if k.startswith("flowforge_degradation_total{")
        )

    def test_accumulates(self):
        """同标签降级累加。"""
        mc = MetricsCollector()
        mc.record_degradation("llm_provider", "fallback", "r1")
        mc.record_degradation("llm_provider", "fallback", "r2")
        all_metrics = mc.get_all_metrics()
        key = next(
            k for k in all_metrics["counters"]
            if k.startswith("flowforge_degradation_total{") and "component=llm_provider" in k
        )
        assert all_metrics["counters"][key] == 2.0


class TestRecordRecovery:
    """record_recovery 测试。"""

    def test_basic_success(self):
        """基本恢复成功记录。"""
        mc = MetricsCollector()
        mc.record_recovery("llm_provider", 10.0, True)
        all_metrics = mc.get_all_metrics()
        assert any(
            "flowforge_recovery_total{" in k
            and "component=llm_provider" in k
            and "success=true" in k
            for k in all_metrics["counters"]
        )
        assert any(
            k.startswith("flowforge_recovery_duration_seconds{")
            and "component=llm_provider" in k
            for k in all_metrics["histograms"]
        )

    @pytest.mark.parametrize("success", [True, False])
    def test_success_failure_labels(self, success: bool):
        """参数化：success/failure 标签。"""
        mc = MetricsCollector()
        mc.record_recovery("openroute", 5.0, success)
        all_metrics = mc.get_all_metrics()
        success_label = "true" if success else "false"
        assert any(
            f"success={success_label}" in k
            for k in all_metrics["counters"]
            if k.startswith("flowforge_recovery_total{")
        )

    def test_duration_histogram(self):
        """恢复时长直方图累积。"""
        mc = MetricsCollector()
        mc.record_recovery("llm_provider", 2.0, True)
        mc.record_recovery("llm_provider", 4.0, True)
        all_metrics = mc.get_all_metrics()
        hist_key = next(
            k for k in all_metrics["histograms"]
            if k.startswith("flowforge_recovery_duration_seconds{") and "component=llm_provider" in k
        )
        assert all_metrics["histograms"][hist_key]["count"] == 2
        assert all_metrics["histograms"][hist_key]["sum"] == pytest.approx(6.0)


# ──────────────────────────────────────────────────────────────────
# Provider 配额指标测试
# ──────────────────────────────────────────────────────────────────


class TestRecordProviderQuota:
    """record_provider_quota 测试。"""

    def test_basic(self):
        """基本配额记录。"""
        mc = MetricsCollector()
        mc.record_provider_quota("openroute", used=30.0, limit=100.0)
        all_metrics = mc.get_all_metrics()
        ratio_key = next(
            k for k in all_metrics["gauges"]
            if k.startswith("flowforge_provider_quota_used_ratio{") and "provider=openroute" in k
        )
        remaining_key = next(
            k for k in all_metrics["gauges"]
            if k.startswith("flowforge_provider_quota_remaining{") and "provider=openroute" in k
        )
        assert all_metrics["gauges"][ratio_key] == pytest.approx(0.3)
        assert all_metrics["gauges"][remaining_key] == pytest.approx(70.0)

    def test_zero_limit_edge_case(self):
        """limit=0 边界：ratio=1.0，remaining=0。"""
        mc = MetricsCollector()
        mc.record_provider_quota("doubao", used=0.0, limit=0.0)
        all_metrics = mc.get_all_metrics()
        ratio_key = next(
            k for k in all_metrics["gauges"]
            if k.startswith("flowforge_provider_quota_used_ratio{") and "provider=doubao" in k
        )
        remaining_key = next(
            k for k in all_metrics["gauges"]
            if k.startswith("flowforge_provider_quota_remaining{") and "provider=doubao" in k
        )
        assert all_metrics["gauges"][ratio_key] == pytest.approx(1.0)
        assert all_metrics["gauges"][remaining_key] == pytest.approx(0.0)

    def test_overuse_clamps_remaining_to_zero(self):
        """used > limit 时 remaining 不为负。"""
        mc = MetricsCollector()
        mc.record_provider_quota("openai", used=120.0, limit=100.0)
        all_metrics = mc.get_all_metrics()
        remaining_key = next(
            k for k in all_metrics["gauges"]
            if k.startswith("flowforge_provider_quota_remaining{") and "provider=openai" in k
        )
        assert all_metrics["gauges"][remaining_key] == pytest.approx(0.0)

    def test_multiple_providers_tracked_separately(self):
        """多个 provider 分别记录。"""
        mc = MetricsCollector()
        mc.record_provider_quota("openroute", 30.0, 100.0)
        mc.record_provider_quota("doubao", 50.0, 200.0)
        all_metrics = mc.get_all_metrics()
        or_key = next(
            k for k in all_metrics["gauges"]
            if "provider=openroute" in k and k.startswith("flowforge_provider_quota_used_ratio{")
        )
        db_key = next(
            k for k in all_metrics["gauges"]
            if "provider=doubao" in k and k.startswith("flowforge_provider_quota_used_ratio{")
        )
        assert all_metrics["gauges"][or_key] == pytest.approx(0.3)
        assert all_metrics["gauges"][db_key] == pytest.approx(0.25)


# ──────────────────────────────────────────────────────────────────
# get_flowforge_metrics 业务汇总测试
# ──────────────────────────────────────────────────────────────────


class TestGetFlowforgeMetrics:
    """get_flowforge_metrics 测试。"""

    def test_structure_has_all_top_level_keys(self):
        """返回结构包含 5 个顶层键。"""
        mc = MetricsCollector()
        summary = mc.get_flowforge_metrics()
        assert set(summary.keys()) == {"loop", "llm", "degradation", "recovery", "provider"}

    def test_loop_substructure(self):
        """loop 子结构包含所有 6 个子键。"""
        mc = MetricsCollector()
        mc.record_loop_execution("creation", 30.0, True, 2, 0.9)
        mc.record_loop_step("creation", "act", 5.0, True)
        summary = mc.get_flowforge_metrics()
        assert set(summary["loop"].keys()) == {
            "total", "iterations", "step_total", "quality_scores", "durations", "step_durations"
        }
        assert len(summary["loop"]["total"]) > 0
        assert len(summary["loop"]["iterations"]) > 0
        assert len(summary["loop"]["step_total"]) > 0
        assert len(summary["loop"]["quality_scores"]) > 0
        assert len(summary["loop"]["durations"]) > 0
        assert len(summary["loop"]["step_durations"]) > 0

    def test_llm_substructure(self):
        """llm 子结构包含所有 4 个子键。"""
        mc = MetricsCollector()
        mc.record_llm_call("claude-3-5-sonnet", "openrouter", 2.0, True, 100, "chat")
        mc.record_llm_webchat_call("claude-3-5-sonnet", 15.0, True)
        summary = mc.get_flowforge_metrics()
        assert set(summary["llm"].keys()) == {"calls", "tokens", "durations", "webchat_durations"}
        assert len(summary["llm"]["calls"]) >= 2  # 普通 + webchat
        assert len(summary["llm"]["tokens"]) > 0
        assert len(summary["llm"]["durations"]) > 0
        assert len(summary["llm"]["webchat_durations"]) > 0

    def test_degradation_recovery_provider_substructure(self):
        """degradation/recovery/provider 子结构正确。"""
        mc = MetricsCollector()
        mc.record_degradation("llm_provider", "fallback", "r")
        mc.record_recovery("llm_provider", 5.0, True)
        mc.record_provider_quota("openroute", 30.0, 100.0)
        summary = mc.get_flowforge_metrics()
        assert set(summary["degradation"].keys()) == {"total"}
        assert set(summary["recovery"].keys()) == {"total", "durations"}
        assert set(summary["provider"].keys()) == {"quota_used_ratio", "quota_remaining"}
        assert len(summary["degradation"]["total"]) > 0
        assert len(summary["recovery"]["total"]) > 0
        assert len(summary["recovery"]["durations"]) > 0
        assert len(summary["provider"]["quota_used_ratio"]) > 0
        assert len(summary["provider"]["quota_remaining"]) > 0


# ──────────────────────────────────────────────────────────────────
# get_slo_status SLO 判定测试
# ──────────────────────────────────────────────────────────────────


class TestGetSloStatus:
    """get_slo_status 测试。"""

    def test_empty_all_slo_pass(self):
        """无数据时所有 SLO 应通过（健康）。"""
        mc = MetricsCollector()
        slo = mc.get_slo_status()
        assert slo["loop_3min_slo"] is True
        assert slo["webchat_30s_slo"] is True
        assert slo["degradation_rate"] == pytest.approx(0.0)
        assert slo["loop_p95_seconds"] == pytest.approx(0.0)
        assert slo["webchat_p95_seconds"] == pytest.approx(0.0)
        assert slo["loop_sample_count"] == 0
        assert slo["webchat_sample_count"] == 0

    def test_loop_healthy(self):
        """Loop P95 < 180s：SLO 通过。"""
        mc = MetricsCollector()
        # 20 个快速调用 + 1 个稍慢调用，P95 应远低于 180s
        for _ in range(20):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        mc.record_loop_execution("creation", 60.0, True, 1, 0.9)
        slo = mc.get_slo_status()
        assert slo["loop_3min_slo"] is True
        assert slo["loop_p95_seconds"] < 180.0
        assert slo["loop_sample_count"] == 21

    def test_loop_unhealthy(self):
        """Loop P95 >= 180s：SLO 不通过。"""
        mc = MetricsCollector()
        # 20 个 30s + 2 个 200s = 22 样本
        # P95 计算：k = 21*0.95 = 19.95，sorted_vals[19]=30, sorted_vals[20]=200
        # 线性插值：30 + (200-30)*0.95 = 191.5 > 180
        for _ in range(20):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        for _ in range(2):
            mc.record_loop_execution("creation", 200.0, True, 1, 0.9)
        slo = mc.get_slo_status()
        assert slo["loop_3min_slo"] is False
        assert slo["loop_p95_seconds"] >= 180.0

    def test_webchat_healthy(self):
        """WebChat P95 < 30s：SLO 通过。"""
        mc = MetricsCollector()
        for _ in range(20):
            mc.record_llm_webchat_call("claude-3-5-sonnet", 10.0, True)
        mc.record_llm_webchat_call("claude-3-5-sonnet", 25.0, True)
        slo = mc.get_slo_status()
        assert slo["webchat_30s_slo"] is True
        assert slo["webchat_p95_seconds"] < 30.0
        assert slo["webchat_sample_count"] == 21

    def test_webchat_unhealthy(self):
        """WebChat P95 >= 30s：SLO 不通过。"""
        mc = MetricsCollector()
        # 20 个 10s + 2 个 45s = 22 样本
        # P95 计算：k = 21*0.95 = 19.95, sorted_vals[19]=10, sorted_vals[20]=45
        # 线性插值：10 + (45-10)*0.95 = 43.25 > 30
        for _ in range(20):
            mc.record_llm_webchat_call("claude-3-5-sonnet", 10.0, True)
        for _ in range(2):
            mc.record_llm_webchat_call("claude-3-5-sonnet", 45.0, True)
        slo = mc.get_slo_status()
        assert slo["webchat_30s_slo"] is False
        assert slo["webchat_p95_seconds"] >= 30.0

    def test_degradation_rate_low(self):
        """降级率 < 0.05：健康。"""
        mc = MetricsCollector()
        # 100 次 loop，2 次降级 -> rate = 0.02
        for _ in range(100):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        mc.record_degradation("llm_provider", "fallback", "r1")
        mc.record_degradation("llm_provider", "fallback", "r2")
        slo = mc.get_slo_status()
        assert slo["degradation_rate"] == pytest.approx(0.02)
        assert slo["degradation_rate"] < MetricsCollector.DEGRADATION_RATE_THRESHOLD

    def test_degradation_rate_high(self):
        """降级率 >= 0.05：不健康。"""
        mc = MetricsCollector()
        # 10 次 loop，1 次降级 -> rate = 0.1
        for _ in range(10):
            mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        mc.record_degradation("llm_provider", "fallback", "r1")
        slo = mc.get_slo_status()
        assert slo["degradation_rate"] == pytest.approx(0.1)
        assert slo["degradation_rate"] >= MetricsCollector.DEGRADATION_RATE_THRESHOLD

    def test_no_loops_degradation_rate_zero(self):
        """无 loop 时降级率为 0（即使有降级记录）。"""
        mc = MetricsCollector()
        mc.record_degradation("llm_provider", "fallback", "r1")
        slo = mc.get_slo_status()
        assert slo["degradation_rate"] == pytest.approx(0.0)


# ──────────────────────────────────────────────────────────────────
# Histogram bucket 输出格式测试
# ──────────────────────────────────────────────────────────────────


class TestHistogramBucketOutput:
    """histogram bucket 输出格式测试。"""

    def test_bucket_lines_present(self):
        """配置了 bucket 的直方图输出 _bucket{le="x"} 行。"""
        mc = MetricsCollector()
        mc.record_loop_execution("creation", 25.0, True, 1, 0.9)
        output = mc.get_prometheus_format()
        # 应包含 _bucket{le="..."} 行
        assert 'flowforge_loop_duration_seconds_bucket{' in output
        assert 'le="10"' in output
        assert 'le="30"' in output
        assert 'le="180"' in output

    def test_bucket_le_inf_present(self):
        """+Inf bucket 必须存在。"""
        mc = MetricsCollector()
        mc.record_loop_execution("creation", 25.0, True, 1, 0.9)
        output = mc.get_prometheus_format()
        assert 'le="+Inf"' in output

    def test_bucket_count_matches_observations(self):
        """bucket 累积计数与观测值匹配。"""
        mc = MetricsCollector()
        # 5 个观测值：5, 15, 35, 65, 95
        for d in [5.0, 15.0, 35.0, 65.0, 95.0]:
            mc.record_loop_execution("creation", d, True, 1, 0.9)
        output = mc.get_prometheus_format()
        lines = output.split("\n")
        # bucket le="10" 应包含 1 个（5.0）
        le_10_line = next(l for l in lines if 'flowforge_loop_duration_seconds_bucket{' in l and 'le="10"' in l)
        assert le_10_line.endswith(" 1")
        # bucket le="30" 应包含 2 个（5.0, 15.0）
        le_30_line = next(l for l in lines if 'flowforge_loop_duration_seconds_bucket{' in l and 'le="30"' in l)
        assert le_30_line.endswith(" 2")
        # bucket le="120" 应包含 5 个（全部）
        le_120_line = next(l for l in lines if 'flowforge_loop_duration_seconds_bucket{' in l and 'le="120"' in l)
        assert le_120_line.endswith(" 5")
        # +Inf bucket 应等于总样本数
        inf_line = next(l for l in lines if 'flowforge_loop_duration_seconds_bucket{' in l and 'le="+Inf"' in l)
        assert inf_line.endswith(" 5")
        # _count 与 _sum 行
        count_line = next(l for l in lines if l.startswith("flowforge_loop_duration_seconds_count{"))
        assert count_line.endswith(" 5")
        sum_line = next(l for l in lines if l.startswith("flowforge_loop_duration_seconds_sum{"))
        # 5+15+35+65+95 = 215
        assert sum_line.endswith(" 215.0")

    def test_no_bucket_legacy_format(self):
        """未配置 bucket 的直方图保持原有简化格式。"""
        mc = MetricsCollector()
        # 直接 observe 一个未配置 bucket 的指标
        mc.observe_histogram("custom_metric_no_bucket", 1.5)
        output = mc.get_prometheus_format()
        # 应该有简化格式 _count 与 _sum（无 _bucket 行）
        assert "custom_metric_no_bucket_count " in output
        assert "custom_metric_no_bucket_sum " in output
        assert "custom_metric_no_bucket_bucket{" not in output

    def test_observe_histogram_buckets_param_registers(self):
        """observe_histogram 的 buckets 参数可注册新 bucket 配置。"""
        mc = MetricsCollector()
        custom_buckets = [0.1, 0.5, 1.0, 5.0]
        mc.observe_histogram("my_custom_hist", 0.3, buckets=custom_buckets)
        mc.observe_histogram("my_custom_hist", 2.0)
        output = mc.get_prometheus_format()
        # 应使用新注册的 bucket
        assert 'le="0.1"' in output
        assert 'le="0.5"' in output
        assert 'le="1.0"' in output
        assert 'le="5.0"' in output
        assert 'le="+Inf"' in output
        # 验证 bucket 计数：0.3, 2.0 -> le=0.5:1, le=1.0:1, le=5.0:2, +Inf:2
        lines = output.split("\n")
        le_05_line = next(l for l in lines if 'my_custom_hist_bucket{' in l and 'le="0.5"' in l)
        assert le_05_line.endswith(" 1")
        le_5_line = next(l for l in lines if 'my_custom_hist_bucket{' in l and 'le="5.0"' in l)
        assert le_5_line.endswith(" 2")

    def test_webchat_buckets_are_5_10_20_30_60_120_300(self):
        """webchat 直方图 bucket 必须为 5/10/20/30/60/120/300。"""
        mc = MetricsCollector()
        mc.record_llm_webchat_call("claude-3-5-sonnet", 7.0, True)
        assert mc._get_buckets("flowforge_llm_webchat_duration_seconds") == [5, 10, 20, 30, 60, 120, 300]


# ──────────────────────────────────────────────────────────────────
# T6 铁律合规性测试
# ──────────────────────────────────────────────────────────────────


class TestT6Compliance:
    """T6 测试铁律：MetricsCollector 实例可完整采集 E2E 流程的所有指标。"""

    def test_full_e2e_flow_metrics_collection(self):
        """模拟一次完整 E2E 流程，验证所有类别指标都被采集。"""
        mc = MetricsCollector()

        # ── 阶段 1：Loop 执行（creation + polish）──
        mc.record_loop_execution("creation", 90.0, True, 2, 0.88)
        mc.record_loop_execution("polish", 30.0, True, 1, 0.92)
        # Loop 内部步骤
        for step in ["discover", "assign", "act", "verify", "persist"]:
            mc.record_loop_step("creation", step, 5.0, True)
        mc.record_loop_step("polish", "act", 8.0, True)
        mc.record_loop_step("polish", "verify", 3.0, False)  # 一次失败

        # ── 阶段 2：LLM 调用 ──
        mc.record_llm_call("claude-3-5-sonnet", "openrouter", 2.5, True, 1500, "chat")
        mc.record_llm_call("claude-3-5-sonnet", "openrouter", 0.8, True, 200, "embedding")
        mc.record_llm_call("doubao-pro", "doubao", 1.2, True, 800, "review")
        mc.record_llm_webchat_call("claude-3-5-sonnet", 12.0, True)
        mc.record_llm_webchat_call("claude-3-5-sonnet", 25.0, True)

        # ── 阶段 3：一次降级 + 恢复 ──
        mc.record_degradation("openroute", "fallback", "5xx surge")
        mc.record_recovery("openroute", 15.0, True)

        # ── 阶段 4：Provider 配额 ──
        mc.record_provider_quota("openroute", 4500.0, 10000.0)
        mc.record_provider_quota("doubao", 200.0, 500.0)

        # ── 验证：所有类别指标都被采集 ──
        summary = mc.get_flowforge_metrics()
        # Loop 类
        assert len(summary["loop"]["total"]) >= 2  # creation + polish
        assert len(summary["loop"]["iterations"]) >= 2
        assert len(summary["loop"]["step_total"]) >= 6  # 5 creation + 2 polish (含失败)
        assert len(summary["loop"]["quality_scores"]) >= 2
        assert len(summary["loop"]["durations"]) >= 2
        assert len(summary["loop"]["step_durations"]) >= 2  # 至少 creation 多步 + polish

        # LLM 类
        # 普通 LLM 调用 3 个唯一标签组合（claude-chat / claude-embedding / doubao-review）
        # + webchat 调用 1 个唯一标签组合（2 次相同 model 聚合为 1 个 counter）= 4 个唯一 key
        assert len(summary["llm"]["calls"]) >= 4
        assert len(summary["llm"]["tokens"]) >= 3
        assert len(summary["llm"]["durations"]) >= 3  # claude chat + claude embedding + doubao review
        assert len(summary["llm"]["webchat_durations"]) >= 1

        # Degradation 类
        assert len(summary["degradation"]["total"]) >= 1

        # Recovery 类
        assert len(summary["recovery"]["total"]) >= 1
        assert len(summary["recovery"]["durations"]) >= 1

        # Provider 类
        assert len(summary["provider"]["quota_used_ratio"]) >= 2
        assert len(summary["provider"]["quota_remaining"]) >= 2

        # ── 验证：SLO 状态可计算 ──
        slo = mc.get_slo_status()
        assert "loop_3min_slo" in slo
        assert "webchat_30s_slo" in slo
        assert "degradation_rate" in slo
        # 2 次 loop + 1 次降级 -> 降级率 = 1/2 = 0.5，不健康
        assert slo["degradation_rate"] == pytest.approx(0.5)

        # ── 验证：Prometheus 格式输出包含所有指标名 ──
        prom = mc.get_prometheus_format()
        expected_metric_names = [
            "flowforge_loop_total",
            "flowforge_loop_duration_seconds",
            "flowforge_loop_iterations_total",
            "flowforge_loop_quality_score",
            "flowforge_loop_step_duration_seconds",
            "flowforge_loop_step_total",
            "flowforge_llm_calls_total",
            "flowforge_llm_duration_seconds",
            "flowforge_llm_tokens_total",
            "flowforge_llm_webchat_duration_seconds",
            "flowforge_degradation_total",
            "flowforge_recovery_total",
            "flowforge_recovery_duration_seconds",
            "flowforge_provider_quota_used_ratio",
            "flowforge_provider_quota_remaining",
        ]
        for name in expected_metric_names:
            assert name in prom, f"Prometheus 输出缺少指标: {name}"

    def test_disabled_collector_records_nothing(self):
        """禁用的 collector 不记录任何指标。"""
        mc = MetricsCollector(config={"enabled": False})
        mc.record_loop_execution("creation", 30.0, True, 1, 0.9)
        mc.record_llm_call("claude-3-5-sonnet", "openrouter", 1.0, True, 100)
        mc.record_degradation("llm_provider", "fallback", "r")
        mc.record_recovery("llm_provider", 5.0, True)
        mc.record_provider_quota("openroute", 10.0, 100.0)
        all_metrics = mc.get_all_metrics()
        assert len(all_metrics["counters"]) == 0
        assert len(all_metrics["gauges"]) == 0
        assert len(all_metrics["histograms"]) == 0


# ──────────────────────────────────────────────────────────────────
# 辅助方法测试
# ──────────────────────────────────────────────────────────────────


class TestHelperMethods:
    """辅助方法测试。"""

    def test_percentile_basic(self):
        """_percentile 基本计算。"""
        # 1..10 的 P95 应接近 10
        values = list(range(1, 11))
        p95 = MetricsCollector._percentile(values, 95)
        assert 9.0 <= p95 <= 10.0
        # P50 应接近 5.5（中位数）
        p50 = MetricsCollector._percentile(values, 50)
        assert 5.0 <= p50 <= 6.0

    def test_percentile_single_value(self):
        """单值列表分位数等于该值。"""
        assert MetricsCollector._percentile([42.0], 95) == pytest.approx(42.0)

    def test_percentile_empty(self):
        """空列表分位数为 0。"""
        assert MetricsCollector._percentile([], 95) == 0.0

    def test_recent_histogram_values_window_filtering(self):
        """_recent_histogram_values 按时间窗口过滤。"""
        mc = MetricsCollector()
        # 记录一个观测值
        mc.observe_histogram("flowforge_loop_duration_seconds", 50.0, labels={"loop_name": "creation"})
        # 手动将第一个观测的时间戳设为 10 分钟前（超出 5min 窗口）
        key = next(iter(mc._histograms.keys()))
        mc._histogram_timestamps[key][0] = time.time() - 600  # 10 分钟前
        # 再记录一个最近的观测值
        mc.observe_histogram("flowforge_loop_duration_seconds", 30.0, labels={"loop_name": "creation"})
        recent = mc._recent_histogram_values("flowforge_loop_duration_seconds", 300)
        # 只应包含最近 5min 内的 1 个观测值（30.0）
        assert len(recent) == 1
        assert recent[0] == pytest.approx(30.0)

    def test_parse_key_roundtrip(self):
        """_parse_key 与 _make_key 互逆。"""
        mc = MetricsCollector()
        labels = {"loop_name": "creation", "success": "true"}
        key = mc._make_key("flowforge_loop_total", labels)
        base, parsed_labels = mc._parse_key(key)
        assert base == "flowforge_loop_total"
        assert parsed_labels == labels

    def test_format_prometheus_labels_quotes(self):
        """_format_prometheus_labels 输出带引号的 Prometheus 标签。"""
        mc = MetricsCollector()
        out = mc._format_prometheus_labels({"model": "claude", "call_type": "chat"})
        assert out == '{call_type="chat",model="claude"}'

    def test_get_status_includes_bucket_config_count(self):
        """get_status 返回 bucket_config_count。"""
        mc = MetricsCollector()
        status = mc.get_status()
        assert "bucket_config_count" in status
        assert status["bucket_config_count"] == len(MetricsCollector.DEFAULT_BUCKETS)


# ──────────────────────────────────────────────────────────────────
# 现有方法不破坏测试
# ──────────────────────────────────────────────────────────────────


class TestExistingMethodsNotBroken:
    """验证新增功能不破坏现有 ContentForge 方法。"""

    def test_record_article_quality_still_works(self):
        """record_article_quality 仍正常工作。"""
        mc = MetricsCollector()
        mc.record_article_quality(0.85, persona="life", task_id="t-001")
        cf_metrics = mc.get_contentforge_metrics()
        assert len(cf_metrics["article_quality_scores"]) > 0

    def test_record_publish_result_still_works(self):
        """record_publish_result 仍正常工作。"""
        mc = MetricsCollector()
        mc.record_publish_result(True, platform="wechat", persona="life")
        mc.record_publish_result(False, platform="wechat", persona="life")
        cf_metrics = mc.get_contentforge_metrics()
        assert len(cf_metrics["publish_success"]) > 0
        assert len(cf_metrics["publish_failure"]) > 0

    def test_get_publish_success_rate_still_works(self):
        """get_publish_success_rate 仍正常工作。

        注：现有 ``get_publish_success_rate`` 在仅传 ``platform`` 不传 ``persona`` 时
        会构造带空 persona 的 key（与 ``record_publish_result`` 不一致），属于既有
        实现细节。本测试通过不传任何过滤参数来验证无过滤场景下的正确性。
        """
        mc = MetricsCollector()
        mc.record_publish_result(True)
        mc.record_publish_result(True)
        mc.record_publish_result(False)
        rate = mc.get_publish_success_rate()
        assert rate == pytest.approx(2.0 / 3.0)

    def test_observe_histogram_backward_compat_signature(self):
        """observe_histogram 旧调用方式（无 buckets 参数）仍正常工作。"""
        mc = MetricsCollector()
        # 旧方式：3 个位置参数
        mc.observe_histogram("legacy_metric", 1.5, {"label": "value"})
        all_metrics = mc.get_all_metrics()
        assert any("legacy_metric{" in k for k in all_metrics["histograms"])

    def test_existing_prometheus_format_still_has_counter_and_gauge(self):
        """Prometheus 格式仍正确输出 counter 和 gauge。"""
        mc = MetricsCollector()
        mc.inc_counter("test_total", labels={"method": "GET"})
        mc.set_gauge("test_gauge", 42.0, labels={"host": "h1"})
        output = mc.get_prometheus_format()
        assert "test_total{method=GET}" in output
        assert "test_gauge{host=h1}" in output
        assert "# TYPE test_total counter" in output
        assert "# TYPE test_gauge gauge" in output
