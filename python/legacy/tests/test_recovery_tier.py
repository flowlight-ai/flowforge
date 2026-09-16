"""P3-007 Tier 1-4 恢复分级 — RecoveryTierManager 单元测试

覆盖：
- 数据结构（RecoveryTier / RecoveryAction / RecoveryContext / RecoveryResult）
- DEFAULT_STRATEGIES 完整性
- classify_error 错误分类（参数化 12 场景）
- get_strategy 策略查询
- should_escalate 升级判断
- escalate 升级路径（T1→T2→T3→T4，T4 不再升级）
- execute_recovery 各 tier 执行（retry/switch_provider/use_memory_fallback/switch_region）
- execute_recovery 自动升级链路（T1 重试失败 → 升级 T2）
- metrics_collector 集成（record_recovery / inc_counter 回退）
- event_bus 事件发出（started/succeeded/failed/escalated）
- recovery_history 历史记录
- get_status 统计聚合

不使用 Mock LLM，仅用桩件隔离可控行为（与 T1 红线一致）。
"""
from __future__ import annotations

from typing import Any, Dict, List

import pytest

from flowforge.core.recovery_tier import (
    DEFAULT_STRATEGIES,
    RecoveryAction,
    RecoveryContext,
    RecoveryResult,
    RecoveryTier,
    RecoveryTierManager,
)


# ---------------------------------------------------------------------------
# 测试桩件
# ---------------------------------------------------------------------------


class FakeMetrics:
    """可控的指标采集器桩件（支持 record_recovery + inc_counter）。"""

    def __init__(self) -> None:
        self.recovery_calls: List[Dict[str, Any]] = []
        self.counter_calls: List[Dict[str, Any]] = []

    def record_recovery(
        self,
        component: str,
        duration_seconds: float,
        success: bool,
    ) -> None:
        self.recovery_calls.append(
            {
                "component": component,
                "duration_seconds": duration_seconds,
                "success": success,
            }
        )

    def inc_counter(
        self,
        name: str,
        value: float = 1.0,
        labels: Dict[str, str] = None,
    ) -> None:
        self.counter_calls.append(
            {"name": name, "value": value, "labels": labels or {}}
        )


class FakeMetricsCounterOnly:
    """仅支持 inc_counter 的指标采集器（用于回退路径测试）。"""

    def __init__(self) -> None:
        self.counter_calls: List[Dict[str, Any]] = []

    def inc_counter(
        self,
        name: str,
        value: float = 1.0,
        labels: Dict[str, str] = None,
    ) -> None:
        self.counter_calls.append(
            {"name": name, "value": value, "labels": labels or {}}
        )


class FakeEventBus:
    """可控的事件总线桩件（支持 EventBus 标准签名 emit(task_id, event_type, payload)）。"""

    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    def emit(self, task_id: str, event_type: str, payload: dict) -> None:
        self.events.append(
            {
                "task_id": task_id,
                "event_type": event_type,
                "payload": payload,
            }
        )


def make_fast_strategies(
    fallback_value: Any = None,
    backup_providers: List[str] = None,
) -> Dict[RecoveryTier, RecoveryAction]:
    """构造无延迟的策略表（用于加速测试）。

    默认表 retry_delay_seconds=1.0 会导致 T1 重试耗时 3s+，测试中改为 0。
    """
    return {
        RecoveryTier.TIER_1_SOFT: RecoveryAction(
            tier=RecoveryTier.TIER_1_SOFT,
            strategy="retry",
            max_retries=3,
            retry_delay_seconds=0,
            timeout_seconds=30.0,
        ),
        RecoveryTier.TIER_2_COMPONENT: RecoveryAction(
            tier=RecoveryTier.TIER_2_COMPONENT,
            strategy="switch_provider",
            max_retries=2,
            retry_delay_seconds=0,
            timeout_seconds=60.0,
            escalate_after_seconds=120.0,
            metadata={"backup_providers": backup_providers or ["backup"]},
        ),
        RecoveryTier.TIER_3_SYSTEM: RecoveryAction(
            tier=RecoveryTier.TIER_3_SYSTEM,
            strategy="use_memory_fallback",
            timeout_seconds=120.0,
            notify_human=True,
            escalate_after_seconds=600.0,
            fallback_value=fallback_value if fallback_value is not None else {"cached": "data"},
        ),
        RecoveryTier.TIER_4_DISASTER: RecoveryAction(
            tier=RecoveryTier.TIER_4_DISASTER,
            strategy="switch_region",
            timeout_seconds=300.0,
            notify_human=True,
            escalate_after_seconds=0.0,
            fallback_value=fallback_value,
        ),
    }


def make_context(
    component: str = "llm_client",
    error: str = "request timed out",
    error_type: str = "TimeoutError",
    retry_count: int = 0,
    total_downtime_seconds: float = 0.0,
    previous_tier: RecoveryTier | None = None,
) -> RecoveryContext:
    """构造恢复上下文（默认为 llm_client 超时场景）。"""
    return RecoveryContext(
        component=component,
        error=error,
        error_type=error_type,
        occurred_at=1784640000.0,
        retry_count=retry_count,
        total_downtime_seconds=total_downtime_seconds,
        previous_tier=previous_tier,
    )


# ---------------------------------------------------------------------------
# RecoveryTier 枚举
# ---------------------------------------------------------------------------


class TestRecoveryTier:
    """RecoveryTier 枚举值与比较。"""

    def test_tier_1_value(self):
        assert RecoveryTier.TIER_1_SOFT == 1
        assert RecoveryTier.TIER_1_SOFT.name == "TIER_1_SOFT"

    def test_tier_2_value(self):
        assert RecoveryTier.TIER_2_COMPONENT == 2
        assert RecoveryTier.TIER_2_COMPONENT.name == "TIER_2_COMPONENT"

    def test_tier_3_value(self):
        assert RecoveryTier.TIER_3_SYSTEM == 3
        assert RecoveryTier.TIER_3_SYSTEM.name == "TIER_3_SYSTEM"

    def test_tier_4_value(self):
        assert RecoveryTier.TIER_4_DISASTER == 4
        assert RecoveryTier.TIER_4_DISASTER.name == "TIER_4_DISASTER"

    def test_tier_ordering(self):
        """严重程度递增：T1 < T2 < T3 < T4。"""
        assert RecoveryTier.TIER_1_SOFT < RecoveryTier.TIER_2_COMPONENT
        assert RecoveryTier.TIER_2_COMPONENT < RecoveryTier.TIER_3_SYSTEM
        assert RecoveryTier.TIER_3_SYSTEM < RecoveryTier.TIER_4_DISASTER

    def test_tier_int_compatible(self):
        """IntEnum 可与 int 比较。"""
        assert RecoveryTier.TIER_1_SOFT == 1
        assert int(RecoveryTier.TIER_4_DISASTER) == 4


# ---------------------------------------------------------------------------
# RecoveryAction 数据模型
# ---------------------------------------------------------------------------


class TestRecoveryAction:
    """RecoveryAction 字段。"""

    def test_default_values(self):
        action = RecoveryAction(
            tier=RecoveryTier.TIER_1_SOFT,
            strategy="retry",
        )
        assert action.tier == RecoveryTier.TIER_1_SOFT
        assert action.strategy == "retry"
        assert action.max_retries == 3
        assert action.retry_delay_seconds == 1.0
        assert action.timeout_seconds == 30.0
        assert action.fallback_value is None
        assert action.notify_human is False
        assert action.escalate_after_seconds == 0.0
        assert action.metadata == {}

    def test_with_all_fields(self):
        action = RecoveryAction(
            tier=RecoveryTier.TIER_3_SYSTEM,
            strategy="use_memory_fallback",
            max_retries=5,
            retry_delay_seconds=2.5,
            timeout_seconds=90.0,
            fallback_value={"cached": "response"},
            notify_human=True,
            escalate_after_seconds=300.0,
            metadata={"source": "cache"},
        )
        assert action.tier == RecoveryTier.TIER_3_SYSTEM
        assert action.strategy == "use_memory_fallback"
        assert action.max_retries == 5
        assert action.retry_delay_seconds == 2.5
        assert action.timeout_seconds == 90.0
        assert action.fallback_value == {"cached": "response"}
        assert action.notify_human is True
        assert action.escalate_after_seconds == 300.0
        assert action.metadata == {"source": "cache"}

    def test_invalid_strategy_raises(self):
        """strategy 必须是 Literal 中的合法值。"""
        with pytest.raises(Exception):
            RecoveryAction(
                tier=RecoveryTier.TIER_1_SOFT,
                strategy="invalid_strategy",
            )


# ---------------------------------------------------------------------------
# DEFAULT_STRATEGIES 完整性
# ---------------------------------------------------------------------------


class TestDefaultStrategies:
    """DEFAULT_STRATEGIES 完整性。"""

    def test_covers_all_4_tiers(self):
        """默认策略表必须覆盖全部 4 个 tier。"""
        assert set(DEFAULT_STRATEGIES.keys()) == {
            RecoveryTier.TIER_1_SOFT,
            RecoveryTier.TIER_2_COMPONENT,
            RecoveryTier.TIER_3_SYSTEM,
            RecoveryTier.TIER_4_DISASTER,
        }

    def test_tier_1_is_retry(self):
        action = DEFAULT_STRATEGIES[RecoveryTier.TIER_1_SOFT]
        assert action.strategy == "retry"
        assert action.max_retries == 3
        assert action.retry_delay_seconds == 1.0

    def test_tier_2_is_switch_provider(self):
        action = DEFAULT_STRATEGIES[RecoveryTier.TIER_2_COMPONENT]
        assert action.strategy == "switch_provider"
        assert action.escalate_after_seconds == 120.0

    def test_tier_3_is_memory_fallback(self):
        action = DEFAULT_STRATEGIES[RecoveryTier.TIER_3_SYSTEM]
        assert action.strategy == "use_memory_fallback"
        assert action.notify_human is True
        assert action.escalate_after_seconds == 600.0

    def test_tier_4_is_switch_region(self):
        action = DEFAULT_STRATEGIES[RecoveryTier.TIER_4_DISASTER]
        assert action.strategy == "switch_region"
        assert action.notify_human is True
        assert action.escalate_after_seconds == 0.0


# ---------------------------------------------------------------------------
# RecoveryContext 数据模型
# ---------------------------------------------------------------------------


class TestRecoveryContext:
    """RecoveryContext 字段。"""

    def test_default_values(self):
        ctx = RecoveryContext(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
            occurred_at=1784640000.0,
        )
        assert ctx.component == "llm_client"
        assert ctx.error == "request timed out"
        assert ctx.error_type == "TimeoutError"
        assert ctx.occurred_at == 1784640000.0
        assert ctx.retry_count == 0
        assert ctx.total_downtime_seconds == 0.0
        assert ctx.previous_tier is None
        assert ctx.metadata == {}

    def test_with_all_fields(self):
        ctx = RecoveryContext(
            component="database",
            error="connection refused",
            error_type="DatabaseError",
            occurred_at=1784640500.0,
            retry_count=5,
            total_downtime_seconds=180.0,
            previous_tier=RecoveryTier.TIER_2_COMPONENT,
            metadata={"host": "db-primary"},
        )
        assert ctx.component == "database"
        assert ctx.retry_count == 5
        assert ctx.total_downtime_seconds == 180.0
        assert ctx.previous_tier == RecoveryTier.TIER_2_COMPONENT
        assert ctx.metadata == {"host": "db-primary"}

    def test_previous_tier_optional(self):
        """previous_tier 可为 None 或 RecoveryTier。"""
        ctx1 = RecoveryContext(
            component="c", error="e", error_type="T", occurred_at=0.0
        )
        assert ctx1.previous_tier is None
        ctx2 = RecoveryContext(
            component="c",
            error="e",
            error_type="T",
            occurred_at=0.0,
            previous_tier=RecoveryTier.TIER_3_SYSTEM,
        )
        assert ctx2.previous_tier == RecoveryTier.TIER_3_SYSTEM


# ---------------------------------------------------------------------------
# classify_error 错误分类（参数化）
# ---------------------------------------------------------------------------


class TestClassifyError:
    """classify_error 各种错误类型 → 对应 tier。"""

    @pytest.mark.parametrize(
        "error, expected_tier, description",
        [
            (TimeoutError("request timed out after 30s"),
             RecoveryTier.TIER_1_SOFT, "TimeoutError → T1"),
            (ConnectionError("connection refused by openroute"),
             RecoveryTier.TIER_1_SOFT, "ConnectionError → T1"),
            (ConnectionResetError("connection reset by peer"),
             RecoveryTier.TIER_1_SOFT, "ConnectionResetError → T1"),
            (RuntimeError("HTTP 429: rate limit exceeded"),
             RecoveryTier.TIER_1_SOFT, "429 keyword → T1"),
            (RuntimeError("model_not_found: gpt-5 unavailable"),
             RecoveryTier.TIER_2_COMPONENT, "model_not_found → T2"),
            (RuntimeError("tool execution failed: web_search timeout"),
             RecoveryTier.TIER_2_COMPONENT, "tool execution → T2"),
            (RuntimeError("database connection refused: postgres down"),
             RecoveryTier.TIER_3_SYSTEM, "database → T3"),
            (RuntimeError("event_bus publish failed: redis unavailable"),
             RecoveryTier.TIER_3_SYSTEM, "event_bus → T3"),
            (RuntimeError("all providers failed: openroute and doubao down"),
             RecoveryTier.TIER_4_DISASTER, "all providers failed → T4"),
            (RuntimeError("data corruption detected in sqlite wal"),
             RecoveryTier.TIER_4_DISASTER, "data corruption → T4"),
            (RuntimeError("region unreachable: cn-beijing offline"),
             RecoveryTier.TIER_4_DISASTER, "region unreachable → T4"),
            (ValueError("unknown error occurred"),
             RecoveryTier.TIER_1_SOFT, "unknown → T1 (default)"),
        ],
    )
    def test_classify_various_errors(self, error, expected_tier, description):
        """参数化测试：各种错误类型 → 对应 tier。"""
        manager = RecoveryTierManager()
        ctx = make_context(
            component="test_component",
            error=str(error),
            error_type=type(error).__name__,
        )
        tier = manager.classify_error(error, ctx)
        assert tier == expected_tier, f"{description}: expected {expected_tier.name}, got {tier.name}"

    def test_classify_priority_t4_over_t1(self):
        """T4 关键词优先于 T1（避免灾难被误判为软故障）。"""
        manager = RecoveryTierManager()
        # "all providers failed" 同时含 "failed" 但 T4 优先
        error = RuntimeError("all providers failed after timeout")
        ctx = make_context(error=str(error), error_type="RuntimeError")
        assert manager.classify_error(error, ctx) == RecoveryTier.TIER_4_DISASTER

    def test_classify_priority_t3_over_t2(self):
        """T3 关键词优先于 T2。"""
        manager = RecoveryTierManager()
        # "database" 同时含 "tool" 但 T3 优先
        error = RuntimeError("database tool execution failed")
        ctx = make_context(
            component="database",
            error=str(error),
            error_type="RuntimeError",
        )
        assert manager.classify_error(error, ctx) == RecoveryTier.TIER_3_SYSTEM


# ---------------------------------------------------------------------------
# get_strategy 策略查询
# ---------------------------------------------------------------------------


class TestGetStrategy:
    """get_strategy 返回正确策略。"""

    def test_get_tier_1_strategy(self):
        manager = RecoveryTierManager()
        action = manager.get_strategy(RecoveryTier.TIER_1_SOFT)
        assert action.tier == RecoveryTier.TIER_1_SOFT
        assert action.strategy == "retry"

    def test_get_tier_4_strategy(self):
        manager = RecoveryTierManager()
        action = manager.get_strategy(RecoveryTier.TIER_4_DISASTER)
        assert action.tier == RecoveryTier.TIER_4_DISASTER
        assert action.strategy == "switch_region"

    def test_custom_strategies_override(self):
        """自定义策略覆盖默认表。"""
        custom = RecoveryAction(
            tier=RecoveryTier.TIER_1_SOFT,
            strategy="abort",
            max_retries=0,
        )
        manager = RecoveryTierManager(strategies={RecoveryTier.TIER_1_SOFT: custom})
        action = manager.get_strategy(RecoveryTier.TIER_1_SOFT)
        assert action.strategy == "abort"
        assert action.max_retries == 0

    def test_get_strategy_fallback_to_default(self):
        """自定义表缺少某 tier 时回落到默认表。"""
        # 只提供 T1，其他回落到默认
        custom = {RecoveryTier.TIER_1_SOFT: RecoveryAction(
            tier=RecoveryTier.TIER_1_SOFT,
            strategy="retry",
            max_retries=10,
        )}
        manager = RecoveryTierManager(strategies=custom)
        # T2 不在自定义表，应回落到默认
        action = manager.get_strategy(RecoveryTier.TIER_2_COMPONENT)
        assert action.strategy == "switch_provider"


# ---------------------------------------------------------------------------
# should_escalate 升级判断
# ---------------------------------------------------------------------------


class TestShouldEscalate:
    """should_escalate 判断逻辑。"""

    def test_retry_count_exceeds_max(self):
        """retry_count > max_retries → 升级。"""
        manager = RecoveryTierManager()
        ctx = make_context(
            retry_count=5,  # T1 默认 max_retries=3
            previous_tier=RecoveryTier.TIER_1_SOFT,
        )
        assert manager.should_escalate(ctx) is True

    def test_retry_count_within_max(self):
        """retry_count <= max_retries → 不升级。"""
        manager = RecoveryTierManager()
        ctx = make_context(
            retry_count=2,  # T1 默认 max_retries=3
            previous_tier=RecoveryTier.TIER_1_SOFT,
        )
        assert manager.should_escalate(ctx) is False

    def test_downtime_exceeds_threshold(self):
        """total_downtime > escalate_after_seconds → 升级。"""
        manager = RecoveryTierManager()
        # T2 默认 escalate_after_seconds=120
        ctx = make_context(
            retry_count=0,
            total_downtime_seconds=180.0,
            previous_tier=RecoveryTier.TIER_2_COMPONENT,
        )
        assert manager.should_escalate(ctx) is True

    def test_downtime_within_threshold(self):
        """total_downtime <= escalate_after_seconds → 不升级。"""
        manager = RecoveryTierManager()
        ctx = make_context(
            retry_count=0,
            total_downtime_seconds=60.0,
            previous_tier=RecoveryTier.TIER_2_COMPONENT,
        )
        assert manager.should_escalate(ctx) is False

    def test_tier_4_no_time_based_escalation(self):
        """T4 escalate_after_seconds=0 → 不基于时间升级。"""
        manager = RecoveryTierManager()
        ctx = make_context(
            retry_count=0,
            total_downtime_seconds=99999.0,  # 巨大停机时间
            previous_tier=RecoveryTier.TIER_4_DISASTER,
        )
        # T4 max_retries 默认 3，retry_count=0 不超限
        # T4 escalate_after_seconds=0，不基于时间升级
        assert manager.should_escalate(ctx) is False


# ---------------------------------------------------------------------------
# escalate 升级路径
# ---------------------------------------------------------------------------


class TestEscalate:
    """escalate 升级路径。"""

    def test_t1_to_t2(self):
        manager = RecoveryTierManager()
        ctx = make_context(previous_tier=RecoveryTier.TIER_1_SOFT)
        assert manager.escalate(ctx) == RecoveryTier.TIER_2_COMPONENT

    def test_t2_to_t3(self):
        manager = RecoveryTierManager()
        ctx = make_context(previous_tier=RecoveryTier.TIER_2_COMPONENT)
        assert manager.escalate(ctx) == RecoveryTier.TIER_3_SYSTEM

    def test_t3_to_t4(self):
        manager = RecoveryTierManager()
        ctx = make_context(previous_tier=RecoveryTier.TIER_3_SYSTEM)
        assert manager.escalate(ctx) == RecoveryTier.TIER_4_DISASTER

    def test_t4_stays_t4(self):
        """T4 不再升级（返回自身）。"""
        manager = RecoveryTierManager()
        ctx = make_context(previous_tier=RecoveryTier.TIER_4_DISASTER)
        assert manager.escalate(ctx) == RecoveryTier.TIER_4_DISASTER

    def test_escalate_no_previous_tier_defaults_to_t1(self):
        """无 previous_tier 时视作 T1，升级到 T2。"""
        manager = RecoveryTierManager()
        ctx = make_context(previous_tier=None)
        assert manager.escalate(ctx) == RecoveryTier.TIER_2_COMPONENT


# ---------------------------------------------------------------------------
# execute_recovery 各 tier 执行
# ---------------------------------------------------------------------------


class TestExecuteRecovery:
    """execute_recovery 各 tier 执行。"""

    @pytest.mark.asyncio
    async def test_tier_1_retry_success(self):
        """Tier 1 软故障：重试后成功。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())
        call_count = 0

        def op(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise TimeoutError("request timed out")
            return "success after retry"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is True
        assert result.value == "success after retry"
        assert result.tier_used == RecoveryTier.TIER_1_SOFT
        assert result.strategy_used == "retry"
        assert result.attempts == 2
        assert result.escalated is False

    @pytest.mark.asyncio
    async def test_tier_2_switch_provider_success(self):
        """Tier 2 组件故障：切换 provider 成功。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, provider=None, **kwargs):
            if provider is None or provider == "primary":
                raise RuntimeError("model_not_found: gpt-5 unavailable")
            if provider == "backup":
                return "success from backup"
            raise RuntimeError(f"unknown provider: {provider}")

        ctx = make_context(
            component="llm_client",
            error="model_not_found: gpt-5 unavailable",
            error_type="RuntimeError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is True
        assert result.value == "success from backup"
        assert result.tier_used == RecoveryTier.TIER_2_COMPONENT
        assert result.strategy_used == "switch_provider"
        assert result.escalated is False

    @pytest.mark.asyncio
    async def test_tier_3_memory_fallback(self):
        """Tier 3 系统故障：内存模式降级（返回 fallback_value）。"""
        fallback = {"cached": "response", "stale": True}
        manager = RecoveryTierManager(
            strategies=make_fast_strategies(fallback_value=fallback)
        )

        # operation 不应被调用（use_memory_fallback 直接返回 fallback）
        def op(*args, **kwargs):
            raise AssertionError("operation should not be called in use_memory_fallback")

        ctx = make_context(
            component="database",
            error="database connection refused: postgres down",
            error_type="RuntimeError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is True
        assert result.value == fallback
        assert result.tier_used == RecoveryTier.TIER_3_SYSTEM
        assert result.strategy_used == "use_memory_fallback"
        assert result.escalated is False

    @pytest.mark.asyncio
    async def test_tier_4_abort(self):
        """Tier 4 灾难故障：switch_region 失败 → abort。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            raise AssertionError("operation should not be called in switch_region")

        ctx = make_context(
            component="region",
            error="all providers failed: openroute and doubao down",
            error_type="RuntimeError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is False
        assert result.tier_used == RecoveryTier.TIER_4_DISASTER
        assert result.strategy_used == "switch_region"
        assert result.escalated is False  # T4 不再升级
        assert "switch_region" in result.error or "not available" in result.error

    @pytest.mark.asyncio
    async def test_auto_escalate_t1_to_t2(self):
        """T1 重试 3 次失败 → 自动升级 T2 → switch_provider 成功。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, provider=None, **kwargs):
            if provider is None:
                # T1 retry 不传 provider → 始终失败
                raise TimeoutError("request timed out")
            if provider == "backup":
                # T2 switch_provider → 成功
                return "success from backup"
            raise RuntimeError(f"unknown provider: {provider}")

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is True
        assert result.tier_used == RecoveryTier.TIER_2_COMPONENT
        assert result.strategy_used == "switch_provider"
        assert result.escalated is True
        # T1 重试 3 次 + T2 切换 1 次 = 4 次
        assert result.attempts == 4

    @pytest.mark.asyncio
    async def test_tier_4_no_further_escalation(self):
        """T4 失败后不再升级（escalated=False）。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            raise AssertionError("operation should not be called")

        ctx = make_context(
            component="region",
            error="region unreachable: cn-beijing offline",
            error_type="RuntimeError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is False
        assert result.tier_used == RecoveryTier.TIER_4_DISASTER
        assert result.escalated is False
        assert result.attempts == 1

    @pytest.mark.asyncio
    async def test_execute_recovery_async_operation(self):
        """operation 为 async 函数时正常工作。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        async def op(*args, **kwargs):
            return "async_success"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is True
        assert result.value == "async_success"
        assert result.tier_used == RecoveryTier.TIER_1_SOFT

    @pytest.mark.asyncio
    async def test_full_escalation_chain_t1_to_t4(self):
        """T1→T2→T3→T4 全链路升级：所有 tier 都失败时最终 abort。"""
        # 自定义策略：T3 也失败（不返回 fallback）
        strategies = make_fast_strategies(fallback_value=None)
        # 覆盖 T3 为 retry 策略（保证失败）
        strategies[RecoveryTier.TIER_3_SYSTEM] = RecoveryAction(
            tier=RecoveryTier.TIER_3_SYSTEM,
            strategy="retry",
            max_retries=1,
            retry_delay_seconds=0,
            timeout_seconds=10.0,
        )
        manager = RecoveryTierManager(strategies=strategies)

        def op(*args, provider=None, **kwargs):
            # 始终失败
            raise RuntimeError("persistent failure")

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        result = await manager.execute_recovery(ctx, op)

        assert result.success is False
        assert result.tier_used == RecoveryTier.TIER_4_DISASTER
        assert result.strategy_used == "switch_region"
        assert result.escalated is True
        # T1(3) + T2(1, backup) + T3(1) + T4(1) = 6
        assert result.attempts >= 4


# ---------------------------------------------------------------------------
# metrics_collector 集成
# ---------------------------------------------------------------------------


class TestMetricsIntegration:
    """metrics_collector 集成。"""

    @pytest.mark.asyncio
    async def test_record_recovery_called_on_success(self):
        """成功时调用 record_recovery。"""
        metrics = FakeMetrics()
        manager = RecoveryTierManager(
            strategies=make_fast_strategies(),
            metrics_collector=metrics,
        )

        def op(*args, **kwargs):
            return "ok"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        await manager.execute_recovery(ctx, op)

        assert len(metrics.recovery_calls) == 1
        assert metrics.recovery_calls[0]["component"] == "llm_client"
        assert metrics.recovery_calls[0]["success"] is True
        assert metrics.recovery_calls[0]["duration_seconds"] >= 0.0

    @pytest.mark.asyncio
    async def test_record_recovery_called_on_failure(self):
        """失败时也调用 record_recovery。"""
        metrics = FakeMetrics()
        manager = RecoveryTierManager(
            strategies=make_fast_strategies(),
            metrics_collector=metrics,
        )

        def op(*args, **kwargs):
            raise RuntimeError("all providers failed")

        ctx = make_context(
            component="region",
            error="all providers failed",
            error_type="RuntimeError",
        )
        await manager.execute_recovery(ctx, op)

        assert len(metrics.recovery_calls) == 1
        assert metrics.recovery_calls[0]["success"] is False

    @pytest.mark.asyncio
    async def test_inc_counter_fallback(self):
        """metrics_collector 不支持 record_recovery 时回退到 inc_counter。"""
        metrics = FakeMetricsCounterOnly()
        manager = RecoveryTierManager(
            strategies=make_fast_strategies(),
            metrics_collector=metrics,
        )

        def op(*args, **kwargs):
            return "ok"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        await manager.execute_recovery(ctx, op)

        assert len(metrics.counter_calls) == 1
        assert metrics.counter_calls[0]["name"] == "flowforge_recovery_success_total"
        assert metrics.counter_calls[0]["labels"]["component"] == "llm_client"
        assert metrics.counter_calls[0]["labels"]["tier"] == "TIER_1_SOFT"

    @pytest.mark.asyncio
    async def test_no_metrics_no_error(self):
        """未注入 metrics_collector 时不报错。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            return "ok"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        result = await manager.execute_recovery(ctx, op)
        assert result.success is True


# ---------------------------------------------------------------------------
# event_bus 事件发出
# ---------------------------------------------------------------------------


class TestEventBusIntegration:
    """event_bus 事件发出。"""

    @pytest.mark.asyncio
    async def test_events_emitted_on_success(self):
        """成功时发出 recovery.started + recovery.succeeded。"""
        bus = FakeEventBus()
        manager = RecoveryTierManager(
            strategies=make_fast_strategies(),
            event_bus=bus,
        )

        def op(*args, **kwargs):
            return "ok"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        await manager.execute_recovery(ctx, op)

        event_types = [e["event_type"] for e in bus.events]
        assert "recovery.started" in event_types
        assert "recovery.succeeded" in event_types

        # 验证 started 事件 payload
        started = next(e for e in bus.events if e["event_type"] == "recovery.started")
        assert started["payload"]["component"] == "llm_client"
        assert started["payload"]["tier"] == 1
        assert started["payload"]["strategy"] == "retry"

        # 验证 succeeded 事件 payload
        succeeded = next(e for e in bus.events if e["event_type"] == "recovery.succeeded")
        assert succeeded["payload"]["success"] is True
        assert succeeded["payload"]["tier"] == 1

    @pytest.mark.asyncio
    async def test_events_emitted_on_failure(self):
        """失败时发出 recovery.started + recovery.failed。"""
        bus = FakeEventBus()
        manager = RecoveryTierManager(
            strategies=make_fast_strategies(),
            event_bus=bus,
        )

        def op(*args, **kwargs):
            raise RuntimeError("all providers failed")

        ctx = make_context(
            component="region",
            error="all providers failed",
            error_type="RuntimeError",
        )
        await manager.execute_recovery(ctx, op)

        event_types = [e["event_type"] for e in bus.events]
        assert "recovery.started" in event_types
        assert "recovery.failed" in event_types

        failed = next(e for e in bus.events if e["event_type"] == "recovery.failed")
        assert failed["payload"]["success"] is False
        assert failed["payload"]["tier"] == 4

    @pytest.mark.asyncio
    async def test_escalated_event_emitted(self):
        """升级时发出 recovery.escalated 事件。"""
        bus = FakeEventBus()
        manager = RecoveryTierManager(
            strategies=make_fast_strategies(),
            event_bus=bus,
        )

        def op(*args, provider=None, **kwargs):
            if provider is None:
                raise TimeoutError("timed out")
            if provider == "backup":
                return "success from backup"
            raise RuntimeError("unknown provider")

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        await manager.execute_recovery(ctx, op)

        event_types = [e["event_type"] for e in bus.events]
        assert "recovery.escalated" in event_types

        escalated = next(e for e in bus.events if e["event_type"] == "recovery.escalated")
        assert escalated["payload"]["from_tier"] == 1
        assert escalated["payload"]["to_tier"] == 2
        assert escalated["payload"]["component"] == "llm_client"

    @pytest.mark.asyncio
    async def test_no_event_bus_no_error(self):
        """未注入 event_bus 时不报错。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            return "ok"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        result = await manager.execute_recovery(ctx, op)
        assert result.success is True


# ---------------------------------------------------------------------------
# recovery_history 历史记录
# ---------------------------------------------------------------------------


class TestRecoveryHistory:
    """recovery_history 记录。"""

    @pytest.mark.asyncio
    async def test_history_recorded_after_recovery(self):
        """恢复后历史记录被追加。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            return "ok"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        await manager.execute_recovery(ctx, op)

        history = manager.get_recovery_history()
        assert len(history) == 1
        assert history[0]["component"] == "llm_client"
        assert history[0]["tier_used"] == 1
        assert history[0]["strategy_used"] == "retry"
        assert history[0]["success"] is True

    @pytest.mark.asyncio
    async def test_history_filtered_by_component(self):
        """按组件过滤历史记录。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            return "ok"

        # 执行两次不同组件的恢复
        ctx1 = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        ctx2 = make_context(
            component="database",
            error="database connection refused",
            error_type="RuntimeError",
        )
        await manager.execute_recovery(ctx1, op)
        await manager.execute_recovery(ctx2, op)

        # 过滤 llm_client
        llm_history = manager.get_recovery_history(component="llm_client")
        assert len(llm_history) == 1
        assert llm_history[0]["component"] == "llm_client"

        # 过滤 database
        db_history = manager.get_recovery_history(component="database")
        assert len(db_history) == 1
        assert db_history[0]["component"] == "database"

        # 全部
        all_history = manager.get_recovery_history()
        assert len(all_history) == 2

    @pytest.mark.asyncio
    async def test_history_limit(self):
        """limit 参数限制返回数量。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            return "ok"

        # 执行 5 次恢复
        for i in range(5):
            ctx = make_context(
                component=f"comp_{i}",
                error="request timed out",
                error_type="TimeoutError",
            )
            await manager.execute_recovery(ctx, op)

        history = manager.get_recovery_history(limit=3)
        assert len(history) == 3

    @pytest.mark.asyncio
    async def test_history_ordered_by_time_desc(self):
        """历史记录按时间倒序（最新的在前）。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            return "ok"

        ctx1 = make_context(component="first", error="e", error_type="TimeoutError")
        await manager.execute_recovery(ctx1, op)

        ctx2 = make_context(component="second", error="e", error_type="TimeoutError")
        await manager.execute_recovery(ctx2, op)

        history = manager.get_recovery_history()
        assert len(history) == 2
        # 最新的在前
        assert history[0]["component"] == "second"
        assert history[1]["component"] == "first"


# ---------------------------------------------------------------------------
# get_status 统计
# ---------------------------------------------------------------------------


class TestGetStatus:
    """get_status 统计信息。"""

    def test_initial_status(self):
        """初始状态：所有计数为 0。"""
        manager = RecoveryTierManager()
        status = manager.get_status()

        assert status["total_recoveries"] == 0
        assert status["total_successes"] == 0
        assert status["total_failures"] == 0
        assert status["total_escalations"] == 0
        assert status["success_rate"] == 0.0
        assert status["history_size"] == 0
        # 4 个 tier 的统计
        assert set(status["per_tier_stats"].keys()) == {
            "TIER_1_SOFT", "TIER_2_COMPONENT",
            "TIER_3_SYSTEM", "TIER_4_DISASTER",
        }
        for tier_stats in status["per_tier_stats"].values():
            assert tier_stats == {"attempts": 0, "successes": 0, "failures": 0, "escalations": 0}

    @pytest.mark.asyncio
    async def test_status_after_successful_recovery(self):
        """成功恢复后统计正确。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            return "ok"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        await manager.execute_recovery(ctx, op)

        status = manager.get_status()
        assert status["total_recoveries"] == 1
        assert status["total_successes"] == 1
        assert status["total_failures"] == 0
        assert status["success_rate"] == 1.0
        assert status["history_size"] == 1
        assert status["per_tier_stats"]["TIER_1_SOFT"]["attempts"] == 1
        assert status["per_tier_stats"]["TIER_1_SOFT"]["successes"] == 1

    @pytest.mark.asyncio
    async def test_status_after_escalation(self):
        """升级后统计正确（含 escalation 计数）。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, provider=None, **kwargs):
            if provider is None:
                raise TimeoutError("timed out")
            return "success from backup"

        ctx = make_context(
            component="llm_client",
            error="request timed out",
            error_type="TimeoutError",
        )
        await manager.execute_recovery(ctx, op)

        status = manager.get_status()
        assert status["total_recoveries"] == 1
        assert status["total_successes"] == 1
        assert status["total_escalations"] == 1
        # T1 有 1 次升级
        assert status["per_tier_stats"]["TIER_1_SOFT"]["escalations"] == 1
        # T2 有 1 次成功
        assert status["per_tier_stats"]["TIER_2_COMPONENT"]["successes"] == 1

    @pytest.mark.asyncio
    async def test_status_after_tier4_failure(self):
        """T4 失败后统计正确。"""
        manager = RecoveryTierManager(strategies=make_fast_strategies())

        def op(*args, **kwargs):
            raise AssertionError("should not be called")

        ctx = make_context(
            component="region",
            error="all providers failed",
            error_type="RuntimeError",
        )
        await manager.execute_recovery(ctx, op)

        status = manager.get_status()
        assert status["total_recoveries"] == 1
        assert status["total_successes"] == 0
        assert status["total_failures"] == 1
        assert status["success_rate"] == 0.0
        assert status["per_tier_stats"]["TIER_4_DISASTER"]["failures"] == 1


# ---------------------------------------------------------------------------
# RecoveryResult 数据模型
# ---------------------------------------------------------------------------


class TestRecoveryResult:
    """RecoveryResult 字段。"""

    def test_default_values(self):
        result = RecoveryResult(
            success=True,
            tier_used=RecoveryTier.TIER_1_SOFT,
            strategy_used="retry",
        )
        assert result.success is True
        assert result.value is None
        assert result.tier_used == RecoveryTier.TIER_1_SOFT
        assert result.strategy_used == "retry"
        assert result.attempts == 0
        assert result.duration_seconds == 0.0
        assert result.escalated is False
        assert result.error == ""

    def test_with_all_fields(self):
        result = RecoveryResult(
            success=False,
            value={"partial": "data"},
            tier_used=RecoveryTier.TIER_4_DISASTER,
            strategy_used="switch_region",
            attempts=5,
            duration_seconds=12.5,
            escalated=True,
            error="all providers failed",
        )
        assert result.success is False
        assert result.value == {"partial": "data"}
        assert result.tier_used == RecoveryTier.TIER_4_DISASTER
        assert result.strategy_used == "switch_region"
        assert result.attempts == 5
        assert result.duration_seconds == 12.5
        assert result.escalated is True
        assert result.error == "all providers failed"
