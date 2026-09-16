"""P3-005 灾备降级 100% 成功保障 — ResilienceExecutor 单元测试

覆盖：
- 数据结构（AttemptRecord / ResilienceResult / AllProvidersFailedError）
- 错误分类（permanent / temporary / silent_failure）
- 静默失败检测
- execute_with_resilience 主流程
- 永久错误快速切换 / 临时错误指数退避重试
- on_all_fail 三种策略（raise / return_default / degrade_to_human）
- 质量门禁
- 配额检查
- metrics 集成
- 100% 成功场景

不使用 Mock LLM，但允许 Mock 可控的 operation / quota_manager / metrics_collector
作为单元测试桩件（与 T1 红线一致：仅 LLM 调用不得 Mock，桩件用于隔离执行流）。
"""

import asyncio
from typing import Any, Dict, List

import pytest

from flowforge.core.degradation import (
    AllProvidersFailedError,
    AttemptRecord,
    DegradationActionType,
    DegradationDecisionTree,
    ResilienceExecutor,
    ResilienceResult,
)


# ---------------------------------------------------------------------------
# 测试桩件
# ---------------------------------------------------------------------------


class FakeQuotaManager:
    """可控的配额管理器桩件。"""

    def __init__(
        self,
        allowed: Dict[str, bool] = None,
        raise_on: str = None,
    ) -> None:
        self.allowed = allowed or {}
        self.raise_on = raise_on
        self.check_calls: List[str] = []

    async def check_quota(self, provider: str) -> bool:
        self.check_calls.append(provider)
        if self.raise_on and provider == self.raise_on:
            raise RuntimeError(f"quota check error for {provider}")
        return self.allowed.get(provider, True)


class FakeMetrics:
    """可控的指标采集器桩件。"""

    def __init__(self) -> None:
        self.degradation_calls: List[Dict[str, Any]] = []
        self.counter_calls: List[Dict[str, Any]] = []

    def record_degradation(
        self, provider: str, success: bool, reason: str = ""
    ) -> None:
        self.degradation_calls.append(
            {"provider": provider, "success": success, "reason": reason}
        )

    def inc_counter(self, name: str, value: float = 1.0, labels=None) -> None:
        self.counter_calls.append(
            {"name": name, "value": value, "labels": labels or {}}
        )


class FakeMetricsCounterOnly:
    """仅支持 inc_counter 的指标采集器（用于回退路径测试）。"""

    def __init__(self) -> None:
        self.counter_calls: List[Dict[str, Any]] = []

    def inc_counter(self, name: str, value: float = 1.0, labels=None) -> None:
        self.counter_calls.append(
            {"name": name, "value": value, "labels": labels or {}}
        )


def make_op(
    *,
    fail_on: Dict[str, Exception] = None,
    succeed_after: Dict[str, int] = None,
    return_value: Any = "ok",
):
    """构造可控行为的同步 operation。

    fail_on: {provider: exception} — 该 provider 始终抛该异常
    succeed_after: {provider: N} — 该 provider 失败 N 次后成功
    return_value: 成功时返回的值
    """
    fail_on = fail_on or {}
    succeed_after = succeed_after or {}
    call_counts: Dict[str, int] = {}

    def op(*args, provider: str = None, **kwargs):
        call_counts[provider] = call_counts.get(provider, 0) + 1
        if provider in succeed_after:
            if call_counts[provider] < succeed_after[provider]:
                raise ConnectionError(f"timeout for {provider}")
        if provider in fail_on:
            raise fail_on[provider]
        return return_value

    op.call_counts = call_counts
    return op


def make_async_op(
    *,
    fail_on: Dict[str, Exception] = None,
    return_value: Any = "ok_async",
):
    """构造可控行为的异步 operation。"""
    fail_on = fail_on or {}

    async def op(*args, provider: str = None, **kwargs):
        if provider in fail_on:
            raise fail_on[provider]
        return return_value

    return op


# ---------------------------------------------------------------------------
# AttemptRecord 数据结构
# ---------------------------------------------------------------------------


class TestAttemptRecord:
    """AttemptRecord 数据类测试。"""

    def test_default_values(self):
        rec = AttemptRecord(provider="openroute")
        assert rec.provider == "openroute"
        assert rec.success is False
        assert rec.error_type == ""
        assert rec.error_msg == ""
        assert rec.attempts_count == 0
        assert rec.duration_seconds == 0.0
        assert rec.silent_failure is False
        assert rec.value is None

    def test_with_all_fields(self):
        rec = AttemptRecord(
            provider="doubao",
            success=True,
            error_type="",
            error_msg="",
            attempts_count=3,
            duration_seconds=2.5,
            silent_failure=False,
            value={"text": "hello"},
        )
        assert rec.provider == "doubao"
        assert rec.success is True
        assert rec.attempts_count == 3
        assert rec.duration_seconds == 2.5
        assert rec.value == {"text": "hello"}

    def test_value_accepts_any_type(self):
        # str
        assert AttemptRecord(provider="p", value="text").value == "text"
        # dict
        assert AttemptRecord(provider="p", value={"k": 1}).value == {"k": 1}
        # list
        assert AttemptRecord(provider="p", value=[1, 2, 3]).value == [1, 2, 3]
        # int
        assert AttemptRecord(provider="p", value=42).value == 42


# ---------------------------------------------------------------------------
# ResilienceResult 数据结构
# ---------------------------------------------------------------------------


class TestResilienceResult:
    """ResilienceResult 数据类测试。"""

    def test_default_values(self):
        r = ResilienceResult(success=True)
        assert r.success is True
        assert r.value is None
        assert r.provider_used == ""
        assert r.attempts == []
        assert r.total_duration_seconds == 0.0
        assert r.fallback_used is False
        assert r.degradation_action is None

    def test_with_attempts_list(self):
        attempts = [
            {"provider": "openroute", "success": False, "error_type": "timeout"},
            {"provider": "doubao", "success": True, "error_type": ""},
        ]
        r = ResilienceResult(
            success=True,
            value="ok",
            provider_used="doubao",
            attempts=attempts,
            total_duration_seconds=1.5,
            fallback_used=True,
        )
        assert r.value == "ok"
        assert r.provider_used == "doubao"
        assert len(r.attempts) == 2
        assert r.attempts[0]["provider"] == "openroute"
        assert r.fallback_used is True

    def test_attempts_default_factory_isolated(self):
        """确保 attempts 默认值在不同实例间不共享。"""
        r1 = ResilienceResult(success=True)
        r2 = ResilienceResult(success=True)
        r1.attempts.append({"provider": "p1"})
        assert r2.attempts == []

    def test_serialization(self):
        r = ResilienceResult(
            success=True,
            value="hello",
            provider_used="glm",
            attempts=[{"provider": "glm"}],
            total_duration_seconds=0.5,
            fallback_used=True,
        )
        d = r.model_dump()
        assert d["success"] is True
        assert d["value"] == "hello"
        assert d["provider_used"] == "glm"
        assert d["fallback_used"] is True
        # round-trip
        r2 = ResilienceResult.model_validate(d)
        assert r2.value == "hello"


# ---------------------------------------------------------------------------
# AllProvidersFailedError
# ---------------------------------------------------------------------------


class TestAllProvidersFailedError:
    """AllProvidersFailedError 异常类测试。"""

    def test_message(self):
        err = AllProvidersFailedError("all failed")
        assert str(err) == "all failed"

    def test_attempts_attribute(self):
        attempts = [AttemptRecord(provider="openroute", success=False)]
        err = AllProvidersFailedError("all failed", attempts=attempts)
        assert err.attempts == attempts
        assert len(err.attempts) == 1
        assert err.attempts[0].provider == "openroute"

    def test_default_attempts_empty(self):
        err = AllProvidersFailedError("all failed")
        assert err.attempts == []

    def test_is_exception_subclass(self):
        err = AllProvidersFailedError("err")
        assert isinstance(err, Exception)

    def test_can_be_raised(self):
        with pytest.raises(AllProvidersFailedError) as exc_info:
            raise AllProvidersFailedError("boom", attempts=[AttemptRecord(provider="p")])
        assert "boom" in str(exc_info.value)
        assert len(exc_info.value.attempts) == 1


# ---------------------------------------------------------------------------
# _classify_error
# ---------------------------------------------------------------------------


class TestClassifyError:
    """错误分类测试。"""

    def setup_method(self):
        self.executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=2,
            base_retry_delay=0,
        )

    def test_permanent_model_not_found(self):
        assert self.executor._classify_error(
            RuntimeError("model_not_found: gpt-5")
        ) == "permanent"

    def test_permanent_no_permission(self):
        assert self.executor._classify_error(
            PermissionError("no_permission to access")
        ) == "permanent"

    def test_permanent_model_disabled(self):
        assert self.executor._classify_error(
            RuntimeError("The model is currently model disabled")
        ) == "permanent"

    def test_permanent_all_backends_failed(self):
        assert self.executor._classify_error(
            RuntimeError("all_backends_failed: no provider available")
        ) == "permanent"

    def test_permanent_chinese_no_access(self):
        assert self.executor._classify_error(
            RuntimeError("用户无权访问该模型")
        ) == "permanent"

    def test_permanent_chinese_unavailable(self):
        assert self.executor._classify_error(
            RuntimeError("模型当前不可用")
        ) == "permanent"

    def test_permanent_empty_response(self):
        assert self.executor._classify_error(
            ValueError("empty_response from llm")
        ) == "permanent"

    def test_permanent_cannot_answer(self):
        assert self.executor._classify_error(
            RuntimeError("模型无法回答该问题")
        ) == "permanent"

    def test_temporary_timeout(self):
        assert self.executor._classify_error(
            TimeoutError("request timeout after 30s")
        ) == "temporary"

    def test_temporary_rate_limit(self):
        assert self.executor._classify_error(
            RuntimeError("rate_limit exceeded")
        ) == "temporary"

    def test_temporary_429(self):
        assert self.executor._classify_error(
            RuntimeError("HTTP 429 Too Many Requests")
        ) == "temporary"

    def test_temporary_503(self):
        assert self.executor._classify_error(
            RuntimeError("HTTP 503 Service Unavailable")
        ) == "temporary"

    def test_temporary_502(self):
        assert self.executor._classify_error(
            RuntimeError("HTTP 502 Bad Gateway")
        ) == "temporary"

    def test_temporary_connection_error(self):
        assert self.executor._classify_error(
            ConnectionError("connection reset by peer")
        ) == "temporary"

    def test_silent_failure_classification(self):
        assert self.executor._classify_error(
            RuntimeError("服务当前不可用，请稍后重试")
        ) == "silent_failure"

    def test_unknown_error_defaults_temporary(self):
        assert self.executor._classify_error(
            ValueError("some weird error")
        ) == "temporary"


# ---------------------------------------------------------------------------
# _is_silent_failure / _is_silent_failure_result
# ---------------------------------------------------------------------------


class TestSilentFailureDetection:
    """静默失败检测测试。"""

    def setup_method(self):
        self.executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
        )

    def test_silent_failure_current_unavailable(self):
        assert self.executor._is_silent_failure(
            "服务当前不可用，请稍后重试"
        ) is True

    def test_silent_failure_no_comma_variant(self):
        assert self.executor._is_silent_failure(
            "服务当前不可用,请稍后重试"
        ) is True

    def test_silent_failure_service_unavailable(self):
        assert self.executor._is_silent_failure(
            "服务暂时不可用"
        ) is True

    def test_no_silent_failure_normal_content(self):
        assert self.executor._is_silent_failure("hello world") is False

    def test_no_silent_failure_empty(self):
        assert self.executor._is_silent_failure("") is False

    def test_silent_failure_result_string(self):
        assert self.executor._is_silent_failure_result(
            "当前不可用，请稍后重试"
        ) is True

    def test_silent_failure_result_dict(self):
        assert self.executor._is_silent_failure_result(
            {"content": "当前不可用，请稍后重试"}
        ) is True

    def test_silent_failure_result_dict_text_field(self):
        assert self.executor._is_silent_failure_result(
            {"text": "当前不可用，请稍后重试"}
        ) is True

    def test_silent_failure_result_object(self):
        class FakeResp:
            content = "当前不可用，请稍后重试"

        assert self.executor._is_silent_failure_result(FakeResp()) is True

    def test_no_silent_failure_result_normal_dict(self):
        assert self.executor._is_silent_failure_result(
            {"content": "正常响应内容"}
        ) is False


# ---------------------------------------------------------------------------
# execute_with_resilience 主流程
# ---------------------------------------------------------------------------


class TestExecuteWithResilience:
    """execute_with_resilience 主流程测试。"""

    def setup_method(self):
        # base_retry_delay=0 避免测试慢
        self.executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao", "glm"],
            max_retries=3,
            base_retry_delay=0,
        )

    @pytest.mark.asyncio
    async def test_primary_success_no_fallback(self):
        op = make_op(return_value="primary_ok")
        result = await self.executor.execute_with_resilience(op)
        assert result.success is True
        assert result.value == "primary_ok"
        assert result.provider_used == "openroute"
        assert result.fallback_used is False
        assert len(result.attempts) == 1
        assert result.attempts[0]["provider"] == "openroute"
        assert result.attempts[0]["success"] is True

    @pytest.mark.asyncio
    async def test_primary_failure_backup_success(self):
        op = make_op(
            fail_on={"openroute": RuntimeError("model_not_found")},
            return_value="backup_ok",
        )
        result = await self.executor.execute_with_resilience(op)
        assert result.success is True
        assert result.value == "backup_ok"
        assert result.provider_used == "doubao"
        assert result.fallback_used is True
        assert len(result.attempts) == 2
        assert result.attempts[0]["provider"] == "openroute"
        assert result.attempts[0]["success"] is False
        assert result.attempts[0]["error_type"] == "RuntimeError"
        assert result.attempts[1]["provider"] == "doubao"
        assert result.attempts[1]["success"] is True

    @pytest.mark.asyncio
    async def test_permanent_error_switches_immediately(self):
        """永久错误不重试，直接切换下一 provider。"""
        op = make_op(
            fail_on={"openroute": RuntimeError("model_not_found")},
            return_value="ok",
        )
        result = await self.executor.execute_with_resilience(op)
        assert result.success is True
        # primary 不重试，只调用一次
        assert op.call_counts["openroute"] == 1
        # 切换到 doubao 成功
        assert result.provider_used == "doubao"

    @pytest.mark.asyncio
    async def test_temporary_error_retries_then_succeeds(self):
        """临时错误按指数退避重试，最终成功。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=3,
            base_retry_delay=0,
        )
        op = make_op(
            succeed_after={"openroute": 2},  # 第 2 次成功
            return_value="recovered",
        )
        result = await executor.execute_with_resilience(op)
        assert result.success is True
        assert result.value == "recovered"
        assert result.provider_used == "openroute"
        assert result.fallback_used is False
        assert op.call_counts["openroute"] == 2

    @pytest.mark.asyncio
    async def test_temporary_error_retries_exhausted_switches(self):
        """临时错误重试耗尽后切换到 backup。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=2,
            base_retry_delay=0,
        )
        op = make_op(
            fail_on={"openroute": ConnectionError("timeout")},  # openroute 永远失败
            return_value="backup_ok",
        )
        result = await executor.execute_with_resilience(op)
        assert result.success is True
        assert result.provider_used == "doubao"
        assert result.fallback_used is True
        # primary 重试 2 次
        assert op.call_counts["openroute"] == 2
        # backup 一次成功
        assert op.call_counts["doubao"] == 1

    @pytest.mark.asyncio
    async def test_silent_failure_in_result_switches(self):
        """检测到 openroute 静默失败后切换到 backup。"""
        def op(*args, provider: str = None, **kwargs):
            if provider == "openroute":
                return {"content": "当前不可用，请稍后重试"}
            return "real_response"

        result = await self.executor.execute_with_resilience(op)
        assert result.success is True
        assert result.value == "real_response"
        assert result.provider_used == "doubao"
        assert result.fallback_used is True
        assert result.attempts[0]["silent_failure"] is True
        assert result.attempts[0]["error_type"] == "silent_failure"

    @pytest.mark.asyncio
    async def test_all_fail_raise(self):
        op = make_op(
            fail_on={
                "openroute": RuntimeError("model_not_found"),
                "doubao": RuntimeError("model_not_found"),
                "glm": RuntimeError("model_not_found"),
            },
        )
        with pytest.raises(AllProvidersFailedError) as exc_info:
            await self.executor.execute_with_resilience(op)
        assert "3 providers failed" in str(exc_info.value)
        assert len(exc_info.value.attempts) == 3
        providers = [a.provider for a in exc_info.value.attempts]
        assert providers == ["openroute", "doubao", "glm"]

    @pytest.mark.asyncio
    async def test_all_fail_return_default(self):
        op = make_op(
            fail_on={
                "openroute": RuntimeError("model_not_found"),
                "doubao": RuntimeError("model_not_found"),
                "glm": RuntimeError("model_not_found"),
            },
        )
        result = await self.executor.execute_with_resilience(
            op, on_all_fail="return_default", default_value="fallback_value"
        )
        assert result.success is False
        assert result.value == "fallback_value"
        assert result.fallback_used is True
        assert result.degradation_action == "return_default"
        assert len(result.attempts) == 3

    @pytest.mark.asyncio
    async def test_all_fail_degrade_to_human(self):
        op = make_op(
            fail_on={
                "openroute": RuntimeError("model_not_found"),
                "doubao": RuntimeError("model_not_found"),
                "glm": RuntimeError("model_not_found"),
            },
        )
        result = await self.executor.execute_with_resilience(
            op, on_all_fail="degrade_to_human"
        )
        assert result.success is False
        assert result.fallback_used is True
        # DegradationDecisionTree 应给出 DEGRADE_TO_HUMAN 动作
        assert result.degradation_action == DegradationActionType.DEGRADE_TO_HUMAN.value

    @pytest.mark.asyncio
    async def test_quality_check_failure_switches(self):
        """质量门禁失败后切换到下一 provider。"""
        call_count = {"n": 0}

        def op(*args, provider: str = None, **kwargs):
            call_count["n"] += 1
            if provider == "openroute":
                return {"score": 0.3, "content": "low quality"}
            return {"score": 0.9, "content": "high quality"}

        def quality_check(value):
            if isinstance(value, dict):
                return value.get("score", 0) >= 0.85
            return True

        result = await self.executor.execute_with_resilience(
            op, quality_check_fn=quality_check
        )
        assert result.success is True
        assert result.provider_used == "doubao"
        assert result.fallback_used is True
        assert result.value == {"score": 0.9, "content": "high quality"}

    @pytest.mark.asyncio
    async def test_quality_check_success_no_switch(self):
        """质量门禁通过时不切换 provider。"""
        def op(*args, provider: str = None, **kwargs):
            return {"score": 0.95, "content": "great"}

        def quality_check(value):
            if isinstance(value, dict):
                return value.get("score", 0) >= 0.85
            return True

        result = await self.executor.execute_with_resilience(
            op, quality_check_fn=quality_check
        )
        assert result.success is True
        assert result.provider_used == "openroute"
        assert result.fallback_used is False

    @pytest.mark.asyncio
    async def test_quota_exceeded_skips_provider(self):
        """配额超限时跳过该 provider。"""
        quota_mgr = FakeQuotaManager(allowed={"openroute": False, "doubao": True})
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            provider_quota_manager=quota_mgr,
            max_retries=2,
            base_retry_delay=0,
        )
        op = make_op(return_value="ok")
        result = await executor.execute_with_resilience(op)
        assert result.success is True
        assert result.provider_used == "doubao"
        assert result.fallback_used is True
        assert "openroute" in quota_mgr.check_calls
        assert "doubao" in quota_mgr.check_calls
        # openroute 因配额超限被跳过，未真正调用 op
        assert "openroute" not in op.call_counts

    @pytest.mark.asyncio
    async def test_no_quota_manager_skips_check(self):
        """未注入 quota_manager 时跳过配额检查。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=[],
            provider_quota_manager=None,
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(return_value="ok")
        result = await executor.execute_with_resilience(op)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_quota_check_error_does_not_block(self):
        """配额检查抛异常时不阻断执行。"""
        quota_mgr = FakeQuotaManager(raise_on="openroute")
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            provider_quota_manager=quota_mgr,
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(return_value="ok")
        result = await executor.execute_with_resilience(op)
        # openroute 配额检查抛异常，但容错通过；op 调用成功
        assert result.success is True
        assert result.provider_used == "openroute"

    @pytest.mark.asyncio
    async def test_async_operation_supported(self):
        """operation 为 async 函数时正常工作。"""
        op = make_async_op(return_value="async_ok")
        result = await self.executor.execute_with_resilience(op)
        assert result.success is True
        assert result.value == "async_ok"
        assert result.provider_used == "openroute"

    @pytest.mark.asyncio
    async def test_kwargs_passed_to_operation(self):
        """kwargs 正常传递给 operation（除 resilience 专用参数外）。"""
        captured = {}

        def op(*args, provider: str = None, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs
            captured["provider"] = provider
            return "ok"

        result = await self.executor.execute_with_resilience(
            op, "arg1", "arg2", custom_kw="custom_value"
        )
        assert result.success is True
        assert captured["args"] == ("arg1", "arg2")
        assert captured["kwargs"]["custom_kw"] == "custom_value"
        assert captured["provider"] == "openroute"

    @pytest.mark.asyncio
    async def test_default_on_all_fail_is_raise(self):
        """on_all_fail 默认为 raise。"""
        op = make_op(
            fail_on={
                "openroute": RuntimeError("model_not_found"),
                "doubao": RuntimeError("model_not_found"),
                "glm": RuntimeError("model_not_found"),
            },
        )
        with pytest.raises(AllProvidersFailedError):
            await self.executor.execute_with_resilience(op)


# ---------------------------------------------------------------------------
# metrics 集成
# ---------------------------------------------------------------------------


class TestMetricsIntegration:
    """metrics_collector 集成测试。"""

    @pytest.mark.asyncio
    async def test_record_degradation_called_on_success(self):
        metrics = FakeMetrics()
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            metrics_collector=metrics,
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(return_value="ok")
        await executor.execute_with_resilience(op)
        assert len(metrics.degradation_calls) == 1
        assert metrics.degradation_calls[0]["provider"] == "openroute"
        assert metrics.degradation_calls[0]["success"] is True

    @pytest.mark.asyncio
    async def test_record_degradation_called_on_failure_and_success(self):
        metrics = FakeMetrics()
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            metrics_collector=metrics,
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(
            fail_on={"openroute": RuntimeError("model_not_found")},
            return_value="ok",
        )
        await executor.execute_with_resilience(op)
        assert len(metrics.degradation_calls) == 2
        # primary 失败
        assert metrics.degradation_calls[0]["provider"] == "openroute"
        assert metrics.degradation_calls[0]["success"] is False
        assert "model_not_found" in metrics.degradation_calls[0]["reason"]
        # backup 成功
        assert metrics.degradation_calls[1]["provider"] == "doubao"
        assert metrics.degradation_calls[1]["success"] is True

    @pytest.mark.asyncio
    async def test_inc_counter_fallback_when_no_record_degradation(self):
        """metrics_collector 不支持 record_degradation 时回退到 inc_counter。"""
        metrics = FakeMetricsCounterOnly()
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=[],
            metrics_collector=metrics,
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(return_value="ok")
        await executor.execute_with_resilience(op)
        assert len(metrics.counter_calls) == 1
        assert metrics.counter_calls[0]["name"] == "resilience_success_total"
        assert metrics.counter_calls[0]["labels"]["provider"] == "openroute"

    @pytest.mark.asyncio
    async def test_metrics_called_on_quota_exceeded(self):
        metrics = FakeMetrics()
        quota_mgr = FakeQuotaManager(allowed={"openroute": False})
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=[],
            metrics_collector=metrics,
            provider_quota_manager=quota_mgr,
            max_retries=1,
            base_retry_delay=0,
        )
        with pytest.raises(AllProvidersFailedError):
            await executor.execute_with_resilience(make_op())
        assert any(
            c["provider"] == "openroute" and "quota_exceeded" in c["reason"]
            for c in metrics.degradation_calls
        )


# ---------------------------------------------------------------------------
# get_resilience_status
# ---------------------------------------------------------------------------


class TestGetResilienceStatus:
    """get_resilience_status 统计测试。"""

    @pytest.mark.asyncio
    async def test_initial_status(self):
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
        )
        status = executor.get_resilience_status()
        assert status["total_executions"] == 0
        assert status["total_successes"] == 0
        assert status["total_failures"] == 0
        assert status["success_rate"] == 0.0
        assert status["degradation_count"] == 0
        assert status["primary_provider"] == "openroute"
        assert status["backup_providers"] == ["doubao"]
        assert status["per_provider_stats"] == {}

    @pytest.mark.asyncio
    async def test_status_after_primary_success(self):
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=1,
            base_retry_delay=0,
        )
        await executor.execute_with_resilience(make_op(return_value="ok"))
        status = executor.get_resilience_status()
        assert status["total_executions"] == 1
        assert status["total_successes"] == 1
        assert status["total_failures"] == 0
        assert status["success_rate"] == 1.0
        assert status["degradation_count"] == 0
        assert status["per_provider_stats"]["openroute"]["success"] == 1

    @pytest.mark.asyncio
    async def test_status_after_fallback_to_backup(self):
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(
            fail_on={"openroute": RuntimeError("model_not_found")},
            return_value="ok",
        )
        await executor.execute_with_resilience(op)
        status = executor.get_resilience_status()
        assert status["total_successes"] == 1
        # fallback_used=True 但仍算成功，不算 degradation
        assert status["degradation_count"] == 0
        assert status["per_provider_stats"]["openroute"]["failure"] == 1
        assert status["per_provider_stats"]["doubao"]["success"] == 1

    @pytest.mark.asyncio
    async def test_status_after_all_fail(self):
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(
            fail_on={
                "openroute": RuntimeError("model_not_found"),
                "doubao": RuntimeError("model_not_found"),
            },
        )
        with pytest.raises(AllProvidersFailedError):
            await executor.execute_with_resilience(op)
        status = executor.get_resilience_status()
        assert status["total_executions"] == 1
        assert status["total_successes"] == 0
        assert status["total_failures"] == 1
        assert status["success_rate"] == 0.0
        assert status["degradation_count"] == 1


# ---------------------------------------------------------------------------
# 构造函数校验
# ---------------------------------------------------------------------------


class TestConstructorValidation:
    """构造函数参数校验。"""

    def test_empty_primary_raises(self):
        with pytest.raises(ValueError, match="primary_provider"):
            ResilienceExecutor(primary_provider="", backup_providers=["doubao"])

    def test_max_retries_zero_raises(self):
        with pytest.raises(ValueError, match="max_retries"):
            ResilienceExecutor(
                primary_provider="openroute",
                backup_providers=[],
                max_retries=0,
            )

    def test_negative_base_retry_delay_raises(self):
        with pytest.raises(ValueError, match="base_retry_delay"):
            ResilienceExecutor(
                primary_provider="openroute",
                backup_providers=[],
                base_retry_delay=-1.0,
            )

    def test_backup_providers_copied(self):
        backups = ["doubao", "glm"]
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=backups,
        )
        backups.append("qwen")  # 外部修改不影响
        assert executor.backup_providers == ["doubao", "glm"]


# ---------------------------------------------------------------------------
# 100% 成功场景
# ---------------------------------------------------------------------------


class TestHundredPercentSuccess:
    """100% 成功场景验证。"""

    @pytest.mark.asyncio
    async def test_three_layer_fallback_chain(self):
        """三层 fallback：主→backup1→backup2，最后一层成功。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao", "glm", "qwen"],
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(
            fail_on={
                "openroute": RuntimeError("model_not_found"),
                "doubao": RuntimeError("model disabled"),
                "glm": RuntimeError("无权访问"),
            },
            return_value="qwen_saved_the_day",
        )
        result = await executor.execute_with_resilience(op)
        assert result.success is True
        assert result.value == "qwen_saved_the_day"
        assert result.provider_used == "qwen"
        assert result.fallback_used is True
        assert len(result.attempts) == 4

    @pytest.mark.asyncio
    async def test_mixed_temporary_and_permanent_errors(self):
        """混合错误：主临时错误重试耗尽→backup 永久错误→backup2 成功。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao", "glm"],
            max_retries=2,
            base_retry_delay=0,
        )
        op = make_op(
            fail_on={
                "openroute": ConnectionError("timeout"),  # 临时，重试 2 次
                "doubao": RuntimeError("model_not_found"),  # 永久，不重试
            },
            return_value="glm_ok",
        )
        result = await executor.execute_with_resilience(op)
        assert result.success is True
        assert result.provider_used == "glm"
        assert op.call_counts["openroute"] == 2  # 重试 2 次
        assert op.call_counts["doubao"] == 1  # 永久错误只调 1 次
        assert op.call_counts["glm"] == 1

    @pytest.mark.asyncio
    async def test_silent_failure_recovery_with_backup(self):
        """静默失败后切换到 backup 成功恢复。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=2,
            base_retry_delay=0,
        )
        call_count = {"n": 0}

        def op(*args, provider: str = None, **kwargs):
            call_count["n"] += 1
            if provider == "openroute":
                # openroute 静默失败（HTTP 200 但内容不可用）
                return "服务当前不可用，请稍后重试"
            return "doubao_real_response"

        result = await executor.execute_with_resilience(op)
        assert result.success is True
        assert result.value == "doubao_real_response"
        assert result.provider_used == "doubao"
        # openroute 静默失败不重试
        assert call_count["n"] == 2  # openroute 1 次 + doubao 1 次

    @pytest.mark.asyncio
    async def test_quality_recovery_with_backup(self):
        """质量门禁失败后切换到 backup，质量通过。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=2,
            base_retry_delay=0,
        )

        def op(*args, provider: str = None, **kwargs):
            if provider == "openroute":
                return {"score": 0.5, "content": "low"}  # 质量低
            return {"score": 0.95, "content": "high"}  # 质量高

        def quality_check(value):
            if isinstance(value, dict):
                return value.get("score", 0) >= 0.85
            return True

        result = await executor.execute_with_resilience(
            op, quality_check_fn=quality_check
        )
        assert result.success is True
        assert result.value["score"] == 0.95
        assert result.provider_used == "doubao"

    @pytest.mark.asyncio
    async def test_100_runs_all_succeed(self):
        """压力测试：100 次执行全部成功（轮询 backup）。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=2,
            base_retry_delay=0,
        )
        # openroute 50% 概率失败，但 doubao 100% 成功
        import random
        rng = random.Random(42)

        def op(*args, provider: str = None, **kwargs):
            if provider == "openroute" and rng.random() < 0.5:
                raise ConnectionError("timeout")
            return "ok"

        for i in range(100):
            result = await executor.execute_with_resilience(op)
            assert result.success is True, f"iter {i} failed"
            assert result.value == "ok"

        status = executor.get_resilience_status()
        assert status["total_executions"] == 100
        assert status["total_successes"] == 100
        assert status["total_failures"] == 0
        # success_rate 应为 1.0（100%）
        assert status["success_rate"] == 1.0


# ---------------------------------------------------------------------------
# 与 DegradationDecisionTree 协作
# ---------------------------------------------------------------------------


class TestDegradationDecisionTreeIntegration:
    """degrade_to_human 时与 DegradationDecisionTree 协作测试。"""

    @pytest.mark.asyncio
    async def test_degrade_to_human_returns_decision(self):
        """degrade_to_human 返回 DegradationDecisionTree 的决策。"""
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=1,
            base_retry_delay=0,
        )
        op = make_op(
            fail_on={
                "openroute": RuntimeError("model_not_found"),
                "doubao": RuntimeError("model_not_found"),
            },
        )
        result = await executor.execute_with_resilience(
            op, on_all_fail="degrade_to_human"
        )
        # DegradationDecisionTree 识别为 LLM 不可用，DEGRADE_TO_HUMAN
        assert result.degradation_action == DegradationActionType.DEGRADE_TO_HUMAN.value

    @pytest.mark.asyncio
    async def test_degrade_to_human_with_event_bus(self):
        """注入 event_bus 时降级事件被发出。"""
        from flowforge.events.event_bus import EventBus

        bus = EventBus()
        received_events = []

        async def handler(event_type, event_data):
            received_events.append((event_type, event_data))

        bus.subscribe("task.degrade_to_human", handler)

        tree = DegradationDecisionTree(event_bus=bus)
        executor = ResilienceExecutor(
            primary_provider="openroute",
            backup_providers=["doubao"],
            max_retries=1,
            base_retry_delay=0,
        )
        # 手动调用 _degrade_to_human 验证事件链路
        attempts = [
            AttemptRecord(
                provider="openroute",
                success=False,
                error_type="RuntimeError",
                error_msg="model_not_found",
            )
        ]
        action_str = await executor._degrade_to_human(attempts, {})
        assert action_str == DegradationActionType.DEGRADE_TO_HUMAN.value
