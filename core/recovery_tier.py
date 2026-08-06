"""P3-007 Tier 1-4 恢复分级 — 故障严重度分级与自动恢复策略

设计文档参考：docs/design/D022-tier-1-4-recovery.md, docs/features/F022-tier-1-4-recovery.md

本模块实现按故障严重度分级的恢复策略：
    Tier 1（软故障）   : 瞬时网络抖动/单次超时 → 自动重试
    Tier 2（组件故障） : 单 LLM provider 不可用/单工具失败 → 切换 backup
    Tier 3（系统故障） : 关键依赖（数据库/事件总线）不可用 → 降级模式运行
    Tier 4（灾难故障） : 整个 region 不可用/数据损坏 → 切换灾备机房

与 ``core/degradation.py`` 中的 ``DegradationDecisionTree`` / ``ResilienceExecutor``
协同工作：本模块聚焦"按严重度分级 + 升级链路"，``ResilienceExecutor`` 聚焦
"主备 provider 链路 + 指数退避"。两者均独立实现，互不破坏接口。

依赖通过构造函数注入（铁律12 不绕过 DI）：
    - strategies: 可选，自定义 tier → RecoveryAction 映射
    - degradation_tree: 可选，与 DegradationDecisionTree 协同
    - metrics_collector: 可选，支持 record_recovery 或 inc_counter
    - event_bus: 可选，支持 emit(task_id, event_type, payload)
    - logger: 可选，外部注入的 logger
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections.abc import Callable
from enum import IntEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ===========================================================================
# 枚举与数据模型
# ===========================================================================


class RecoveryTier(IntEnum):
    """恢复分级枚举（按严重程度递增）。

    Tier 1-4 严格按故障严重度递增；数字越大越严重。
    """

    TIER_1_SOFT = 1        # 软故障（瞬时网络抖动/单次超时）→ 自动重试
    TIER_2_COMPONENT = 2   # 组件故障（单 provider/单工具失败）→ 切换 backup
    TIER_3_SYSTEM = 3      # 系统故障（关键依赖不可用）→ 降级模式运行
    TIER_4_DISASTER = 4    # 灾难故障（region 不可用/数据损坏）→ 切换灾备机房


# 升级路径：T1 → T2 → T3 → T4（T4 不再升级）
_TIER_NEXT: dict[RecoveryTier, RecoveryTier] = {
    RecoveryTier.TIER_1_SOFT: RecoveryTier.TIER_2_COMPONENT,
    RecoveryTier.TIER_2_COMPONENT: RecoveryTier.TIER_3_SYSTEM,
    RecoveryTier.TIER_3_SYSTEM: RecoveryTier.TIER_4_DISASTER,
}


class RecoveryAction(BaseModel):
    """恢复动作策略。

    描述某个 Tier 对应的恢复行为：策略类型、重试次数、退避延迟、超时、
    兜底值、是否通知人工、多久后升级等。
    """

    tier: RecoveryTier
    strategy: Literal[
        "retry",
        "switch_provider",
        "use_memory_fallback",
        "use_hardcoded_sop",
        "degrade_to_human",
        "switch_region",
        "abort",
    ]
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    timeout_seconds: float = 30.0
    fallback_value: Any = None
    notify_human: bool = False
    escalate_after_seconds: float = 0.0  # 0 表示不升级
    metadata: dict[str, Any] = Field(default_factory=dict)


class RecoveryContext(BaseModel):
    """恢复上下文 — 描述一次故障的完整信息。

    由调用方在捕获异常后构造，传给 ``RecoveryTierManager.execute_recovery``。
    """

    component: str
    error: str
    error_type: str
    occurred_at: float
    retry_count: int = 0
    total_downtime_seconds: float = 0.0
    previous_tier: RecoveryTier | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RecoveryResult(BaseModel):
    """恢复执行结果。"""

    success: bool
    value: Any = None
    tier_used: RecoveryTier
    strategy_used: str
    attempts: int = 0
    duration_seconds: float = 0.0
    escalated: bool = False
    error: str = ""


# ===========================================================================
# 默认策略表
# ===========================================================================


DEFAULT_STRATEGIES: dict[RecoveryTier, RecoveryAction] = {
    RecoveryTier.TIER_1_SOFT: RecoveryAction(
        tier=RecoveryTier.TIER_1_SOFT,
        strategy="retry",
        max_retries=3,
        retry_delay_seconds=1.0,
        timeout_seconds=30.0,
    ),
    RecoveryTier.TIER_2_COMPONENT: RecoveryAction(
        tier=RecoveryTier.TIER_2_COMPONENT,
        strategy="switch_provider",
        max_retries=2,
        retry_delay_seconds=2.0,
        timeout_seconds=60.0,
        escalate_after_seconds=120.0,
    ),
    RecoveryTier.TIER_3_SYSTEM: RecoveryAction(
        tier=RecoveryTier.TIER_3_SYSTEM,
        strategy="use_memory_fallback",
        timeout_seconds=120.0,
        notify_human=True,
        escalate_after_seconds=600.0,
    ),
    RecoveryTier.TIER_4_DISASTER: RecoveryAction(
        tier=RecoveryTier.TIER_4_DISASTER,
        strategy="switch_region",
        timeout_seconds=300.0,
        notify_human=True,
        escalate_after_seconds=0.0,
    ),
}


# ===========================================================================
# 错误类型 → Tier 映射规则
# ===========================================================================
#
# 按错误类型名 / 错误消息关键词匹配。匹配优先级：T4 > T3 > T2 > T1
# （越严重的越优先匹配，避免灾难性故障被误判为软故障）。

_TIER_1_ERROR_TYPES: frozenset = frozenset({
    "TimeoutError",
    "asyncio.TimeoutError",
    "TimeoutException",
    "ConnectionError",
    "ConnectionResetError",
    "ConnectionAbortedError",
    "BrokenPipeError",
    "LLMRateLimitError",
    "RateLimitError",
    "LLMTimeoutError",
    "APITimeoutError",
})

_TIER_1_KEYWORDS: tuple = (
    "timeout", "timed out", "connection reset", "connection aborted",
    "broken pipe", "429", "rate_limit", "rate limit", "too many requests",
    "temporary", "transient",
)

_TIER_2_ERROR_TYPES: frozenset = frozenset({
    "ModelNotFoundError",
    "ModelNotAvailableError",
    "ProviderUnavailableError",
    "ToolExecutionError",
    "ToolTimeoutError",
    "ToolNotFoundError",
    "LLMAuthError",
    "LLMConnectionError",
})

_TIER_2_KEYWORDS: tuple = (
    "model_not_found", "model not found", "model disabled",
    "provider unavailable", "provider failed",
    "tool execution", "tool not found", "tool failed",
    "auth", "unauthorized", "no permission",
)

_TIER_3_ERROR_TYPES: frozenset = frozenset({
    "DatabaseError",
    "DatabaseCorruptError",
    "SQLiteError",
    "OperationalError",
    "StorageError",
    "EventBusError",
    "EventBusUnavailableError",
    "RedisError",
    "PostgresError",
})

_TIER_3_KEYWORDS: tuple = (
    "database", "sqlite", "postgres", "redis",
    "event_bus", "event bus", "event-bus",
    "storage error", "storage unavailable",
    "multiple providers failed", "all backups failed",
)

_TIER_4_ERROR_TYPES: frozenset = frozenset({
    "RegionUnreachableError",
    "DataCorruptionError",
    "DataLossError",
    "CatastrophicFailureError",
    "AllProvidersFailedError",
})

_TIER_4_KEYWORDS: tuple = (
    "region unreachable", "region unavailable", "region down",
    "data corruption", "data corrupt", "data loss",
    "all providers failed", "all backends failed",
    "catastrophic", "disaster",
)


# ===========================================================================
# RecoveryTierManager — 恢复分级管理器
# ===========================================================================


class RecoveryTierManager:
    """恢复分级管理器 — 故障分类 + 策略调度 + 升级链路 + 指标/事件上报。

    依赖通过构造函数注入（铁律12）：
        - strategies: 自定义 tier → RecoveryAction 映射；为 None 时用默认表
        - degradation_tree: 可选，与 DegradationDecisionTree 协同（本类不强依赖）
        - metrics_collector: 可选，支持 record_recovery 或 inc_counter
        - event_bus: 可选，支持 emit(task_id, event_type, payload)
        - logger: 可选，外部注入的 logger
    """

    def __init__(
        self,
        strategies: dict[RecoveryTier, RecoveryAction] | None = None,
        degradation_tree: Any = None,
        metrics_collector: Any = None,
        event_bus: Any = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self._strategies: dict[RecoveryTier, RecoveryAction] = (
            dict(strategies) if strategies is not None else dict(DEFAULT_STRATEGIES)
        )
        self._degradation_tree: Any = degradation_tree
        self._metrics: Any = metrics_collector
        self._event_bus: Any = event_bus
        self._logger: logging.Logger = logger or logging.getLogger(__name__)

        # 恢复历史记录（内存；持久化由 Repository 层负责，铁律 13）
        self._recovery_history: list[dict[str, Any]] = []

        # 各 tier 统计
        self._tier_stats: dict[RecoveryTier, dict[str, int]] = {
            tier: {"attempts": 0, "successes": 0, "failures": 0, "escalations": 0}
            for tier in RecoveryTier
        }
        self._total_recoveries: int = 0

    # ------------------------------------------------------------------
    # 错误分类
    # ------------------------------------------------------------------

    def classify_error(
        self,
        error: Exception,
        context: RecoveryContext,
    ) -> RecoveryTier:
        """根据错误类型和上下文判断 tier。

        匹配优先级：T4 > T3 > T2 > T1（严重优先）。
        默认回落到 Tier 1（视作瞬时软故障）。

        Args:
            error: 捕获的异常。
            context: 恢复上下文（含错误类型/消息）。

        Returns:
            RecoveryTier: 1-4 之一。
        """
        error_type = type(error).__name__
        error_msg = str(error)
        combined = f"{error_type} {error_msg}".lower()

        # 优先匹配 Tier 4（灾难）
        if error_type in _TIER_4_ERROR_TYPES or self._match_keywords(combined, _TIER_4_KEYWORDS):
            self._logger.debug(
                f"classify_error: tier=4 (disaster), type={error_type}, "
                f"component={context.component}"
            )
            return RecoveryTier.TIER_4_DISASTER

        # Tier 3（系统）
        if error_type in _TIER_3_ERROR_TYPES or self._match_keywords(combined, _TIER_3_KEYWORDS):
            self._logger.debug(
                f"classify_error: tier=3 (system), type={error_type}, "
                f"component={context.component}"
            )
            return RecoveryTier.TIER_3_SYSTEM

        # Tier 2（组件）
        if error_type in _TIER_2_ERROR_TYPES or self._match_keywords(combined, _TIER_2_KEYWORDS):
            self._logger.debug(
                f"classify_error: tier=2 (component), type={error_type}, "
                f"component={context.component}"
            )
            return RecoveryTier.TIER_2_COMPONENT

        # Tier 1（软故障）
        if error_type in _TIER_1_ERROR_TYPES or self._match_keywords(combined, _TIER_1_KEYWORDS):
            self._logger.debug(
                f"classify_error: tier=1 (soft), type={error_type}, "
                f"component={context.component}"
            )
            return RecoveryTier.TIER_1_SOFT

        # 默认 Tier 1（视作瞬时故障，先重试）
        self._logger.debug(
            f"classify_error: tier=1 (default), type={error_type}, "
            f"component={context.component}"
        )
        return RecoveryTier.TIER_1_SOFT

    @staticmethod
    def _match_keywords(text: str, keywords: tuple) -> bool:
        """关键词子串匹配（大小写不敏感）。"""
        return any(kw in text for kw in keywords)

    # ------------------------------------------------------------------
    # 策略查询
    # ------------------------------------------------------------------

    def get_strategy(self, tier: RecoveryTier) -> RecoveryAction:
        """获取指定 tier 的恢复策略。

        Args:
            tier: RecoveryTier 枚举值。

        Returns:
            RecoveryAction: 该 tier 对应的策略；未配置时回落到默认表。
        """
        if tier in self._strategies:
            return self._strategies[tier]
        # 回落到默认表
        if tier in DEFAULT_STRATEGIES:
            return DEFAULT_STRATEGIES[tier]
        # 兜底：返回 Tier 1 默认策略
        self._logger.warning(
            f"get_strategy: no strategy for tier={tier}, fallback to TIER_1_SOFT default"
        )
        return DEFAULT_STRATEGIES[RecoveryTier.TIER_1_SOFT]

    # ------------------------------------------------------------------
    # 升级判断
    # ------------------------------------------------------------------

    def should_escalate(self, context: RecoveryContext) -> bool:
        """判断是否需要升级 tier。

        升级条件（满足任一）：
            - retry_count > max_retries（当前 tier 策略的重试上限）
            - total_downtime_seconds > escalate_after_seconds（且 escalate_after_seconds > 0）

        Args:
            context: 恢复上下文。

        Returns:
            bool: True 表示需要升级。
        """
        # 如果没有 previous_tier，无法判断 max_retries（用 Tier 1 默认）
        tier = context.previous_tier or RecoveryTier.TIER_1_SOFT
        action = self.get_strategy(tier)

        # 重试次数超限 → 升级
        if context.retry_count > action.max_retries:
            self._logger.debug(
                f"should_escalate: True (retry_count={context.retry_count} "
                f"> max_retries={action.max_retries}), tier={tier.name}"
            )
            return True

        # 累计停机时间超阈值 → 升级（0 表示不基于时间升级）
        if action.escalate_after_seconds > 0:
            if context.total_downtime_seconds > action.escalate_after_seconds:
                self._logger.debug(
                    f"should_escalate: True (downtime={context.total_downtime_seconds}s "
                    f"> escalate_after={action.escalate_after_seconds}s), tier={tier.name}"
                )
                return True

        return False

    def escalate(self, context: RecoveryContext) -> RecoveryTier:
        """升级到下一 tier。

        Tier 4 不再升级（返回自身）。

        Args:
            context: 恢复上下文（使用 previous_tier 判断当前 tier）。

        Returns:
            RecoveryTier: 升级后的 tier。
        """
        current_tier = context.previous_tier or RecoveryTier.TIER_1_SOFT

        if current_tier == RecoveryTier.TIER_4_DISASTER:
            self._logger.warning(
                f"escalate: already at TIER_4_DISASTER, no further escalation, "
                f"component={context.component}"
            )
            return RecoveryTier.TIER_4_DISASTER

        next_tier = _TIER_NEXT.get(current_tier, RecoveryTier.TIER_4_DISASTER)
        self._logger.warning(
            f"escalate: {current_tier.name} → {next_tier.name}, "
            f"component={context.component}"
        )
        return next_tier

    # ------------------------------------------------------------------
    # 恢复执行主入口
    # ------------------------------------------------------------------

    async def execute_recovery(
        self,
        context: RecoveryContext,
        operation: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> RecoveryResult:
        """根据上下文分类故障并执行恢复策略。

        流程：
            1. classify_error 得到初始 tier
            2. 获取该 tier 的 RecoveryAction
            3. 发出 recovery.started 事件
            4. 按策略执行（retry/switch_provider/use_memory_fallback/...）
            5. 失败则 escalate 后重试（直到 Tier 4）
            6. Tier 4 仍失败则 abort
            7. 上报 metrics + 发出 recovery.succeeded/failed/escalated 事件
            8. 记录到 recovery_history

        Args:
            context: 恢复上下文。
            operation: 待执行的操作（同步或异步均可）。
            *args, **kwargs: 传递给 operation 的参数。

        Returns:
            RecoveryResult: 含 success/value/tier_used/strategy_used/attempts 等。
        """
        start_time: float = time.time()
        self._total_recoveries += 1

        # 1. 分类故障
        try:
            error_obj = self._reconstruct_error(context)
            current_tier = self.classify_error(error_obj, context)
        except Exception as e:
            self._logger.warning(
                f"execute_recovery: classify_error failed: {e}, default to TIER_1_SOFT"
            )
            current_tier = RecoveryTier.TIER_1_SOFT

        # 若上下文已有 previous_tier 且更高，沿用 previous_tier（避免降级）
        if context.previous_tier is not None and context.previous_tier > current_tier:
            current_tier = context.previous_tier

        # 2. 获取策略
        action = self.get_strategy(current_tier)

        # 3. 发出 started 事件
        await self._emit_event(
            "recovery.started",
            {
                "component": context.component,
                "tier": int(current_tier),
                "tier_name": current_tier.name,
                "strategy": action.strategy,
                "error_type": context.error_type,
            },
        )

        attempts: int = 0
        escalated: bool = False
        result_value: Any = None
        result_success: bool = False
        result_error: str = ""
        strategy_used: str = action.strategy
        tier_used: RecoveryTier = current_tier

        # 4. 按 tier 升级链路尝试
        max_chain_depth: int = 4  # T1→T2→T3→T4 最多 4 级
        chain_depth: int = 0

        while chain_depth < max_chain_depth:
            chain_depth += 1
            action = self.get_strategy(current_tier)
            strategy_used = action.strategy
            tier_used = current_tier

            self._tier_stats[current_tier]["attempts"] += 1

            # 执行策略
            try:
                success, value, attempts_in_strategy, err = await self._execute_strategy(
                    action, operation, args, kwargs
                )
                attempts += attempts_in_strategy

                if success:
                    result_success = True
                    result_value = value
                    result_error = ""
                    self._tier_stats[current_tier]["successes"] += 1
                    break

                # 失败
                result_error = err
                self._tier_stats[current_tier]["failures"] += 1

            except Exception as e:
                result_error = f"{type(e).__name__}: {e}"
                self._tier_stats[current_tier]["failures"] += 1

            # 5. 失败后判断是否升级
            if current_tier == RecoveryTier.TIER_4_DISASTER:
                # Tier 4 仍失败 → abort
                self._logger.error(
                    f"execute_recovery: TIER_4_DISASTER failed, aborting, "
                    f"component={context.component}"
                )
                break

            # 升级
            escalated = True
            self._tier_stats[current_tier]["escalations"] += 1
            next_tier = _TIER_NEXT.get(current_tier, RecoveryTier.TIER_4_DISASTER)

            await self._emit_event(
                "recovery.escalated",
                {
                    "component": context.component,
                    "from_tier": int(current_tier),
                    "from_tier_name": current_tier.name,
                    "to_tier": int(next_tier),
                    "to_tier_name": next_tier.name,
                    "reason": result_error[:200],
                },
            )

            self._logger.warning(
                f"execute_recovery: escalate {current_tier.name} → {next_tier.name}, "
                f"component={context.component}"
            )
            current_tier = next_tier

        duration: float = time.time() - start_time

        # 6. 构造结果
        result = RecoveryResult(
            success=result_success,
            value=result_value,
            tier_used=tier_used,
            strategy_used=strategy_used,
            attempts=attempts,
            duration_seconds=duration,
            escalated=escalated,
            error=result_error,
        )

        # 7. 上报 metrics
        self._record_metrics(
            component=context.component,
            tier=tier_used,
            duration_seconds=duration,
            success=result_success,
            strategy=strategy_used,
        )

        # 8. 发出 succeeded / failed 事件
        event_type = "recovery.succeeded" if result_success else "recovery.failed"
        await self._emit_event(
            event_type,
            {
                "component": context.component,
                "tier": int(tier_used),
                "tier_name": tier_used.name,
                "strategy": strategy_used,
                "success": result_success,
                "attempts": attempts,
                "duration_seconds": duration,
                "escalated": escalated,
                "error": result_error[:500],
            },
        )

        # 9. 记录历史
        history_record: dict[str, Any] = {
            "component": context.component,
            "error_type": context.error_type,
            "error": context.error[:200],
            "tier_used": int(tier_used),
            "tier_name": tier_used.name,
            "strategy_used": strategy_used,
            "success": result_success,
            "attempts": attempts,
            "duration_seconds": duration,
            "escalated": escalated,
            "timestamp": time.time(),
        }
        self._recovery_history.append(history_record)

        self._logger.info(
            f"execute_recovery: component={context.component}, "
            f"tier={tier_used.name}, strategy={strategy_used}, "
            f"success={result_success}, attempts={attempts}, "
            f"duration={duration:.3f}s, escalated={escalated}"
        )

        return result

    # ------------------------------------------------------------------
    # 策略执行
    # ------------------------------------------------------------------

    async def _execute_strategy(
        self,
        action: RecoveryAction,
        operation: Callable[..., Any],
        args: tuple,
        kwargs: dict,
    ) -> tuple:
        """按策略执行 operation。

        Returns:
            (success, value, attempts, error)
        """
        strategy = action.strategy

        if strategy == "retry":
            return await self._do_retry(action, operation, args, kwargs)

        if strategy == "switch_provider":
            return await self._do_switch_provider(action, operation, args, kwargs)

        if strategy == "use_memory_fallback":
            return await self._do_use_fallback(action, "memory_fallback")

        if strategy == "use_hardcoded_sop":
            return await self._do_use_fallback(action, "hardcoded_sop")

        if strategy == "degrade_to_human":
            return await self._do_degrade_to_human(action)

        if strategy == "switch_region":
            return await self._do_switch_region(action)

        if strategy == "abort":
            return False, None, 0, "abort: strategy=abort"

        # 未知策略
        return False, None, 0, f"unknown strategy: {strategy}"

    async def _do_retry(
        self,
        action: RecoveryAction,
        operation: Callable[..., Any],
        args: tuple,
        kwargs: dict,
    ) -> tuple:
        """重试策略：按 max_retries + retry_delay_seconds 指数退避。"""
        last_error: str = ""
        attempts: int = 0

        for attempt in range(action.max_retries):
            attempts += 1
            try:
                result = operation(*args, **kwargs)
                if inspect.isawaitable(result):
                    result = await result
                return True, result, attempts, ""
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                self._logger.debug(
                    f"_do_retry: attempt {attempt + 1}/{action.max_retries} "
                    f"failed: {last_error}"
                )
                # 最后一次不等待
                if attempt < action.max_retries - 1 and action.retry_delay_seconds > 0:
                    delay = action.retry_delay_seconds * (2 ** attempt)
                    await asyncio.sleep(delay)

        return False, None, attempts, last_error

    async def _do_switch_provider(
        self,
        action: RecoveryAction,
        operation: Callable[..., Any],
        args: tuple,
        kwargs: dict,
    ) -> tuple:
        """切换 provider 策略：注入 provider=backup 关键字参数后重试。"""
        last_error: str = ""
        attempts: int = 0

        # 备选 provider 列表（从 metadata 读取，或用默认）
        backup_providers: list[str] = list(
            action.metadata.get("backup_providers", ["backup"])
        )

        for provider in backup_providers:
            attempts += 1
            try:
                op_kwargs = dict(kwargs)
                op_kwargs["provider"] = provider
                result = operation(*args, **op_kwargs)
                if inspect.isawaitable(result):
                    result = await result
                return True, result, attempts, ""
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                self._logger.debug(
                    f"_do_switch_provider: provider={provider} failed: {last_error}"
                )
                # 短暂退避
                if action.retry_delay_seconds > 0:
                    await asyncio.sleep(action.retry_delay_seconds)

        # 所有 backup 都失败
        return False, None, attempts, last_error

    async def _do_use_fallback(
        self,
        action: RecoveryAction,
        mode: str,
    ) -> tuple:
        """使用兜底值（内存模式 / 硬编码 SOP）。"""
        # 立即返回 fallback_value，不计重试
        return True, action.fallback_value, 1, ""

    async def _do_degrade_to_human(self, action: RecoveryAction) -> tuple:
        """降级到人工：返回 fallback_value，标记 notify_human。"""
        # 人工降级视为"未自动恢复"，返回失败 + fallback_value
        return False, action.fallback_value, 1, "degraded to human"

    async def _do_switch_region(self, action: RecoveryAction) -> tuple:
        """切换灾备机房：返回 fallback_value（实际实现需调用灾备 SDK）。"""
        # 切换 region 通常无法在进程内完成，视为失败 + fallback
        return False, action.fallback_value, 1, "switch_region not available"

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------

    @staticmethod
    def _reconstruct_error(context: RecoveryContext) -> Exception:
        """从上下文重建异常对象（用于 classify_error）。"""
        error_type_name = context.error_type
        error_msg = context.error

        # 尝试用已知异常类构造
        known_types: dict[str, type] = {
            "TimeoutError": TimeoutError,
            "asyncio.TimeoutError": TimeoutError,
            "ConnectionError": ConnectionError,
            "ConnectionResetError": ConnectionResetError,
            "BrokenPipeError": BrokenPipeError,
            "RuntimeError": RuntimeError,
            "ValueError": ValueError,
            "DatabaseError": RuntimeError,
            "StorageError": RuntimeError,
        }
        exc_cls = known_types.get(error_type_name, RuntimeError)
        try:
            return exc_cls(error_msg)
        except Exception:
            return RuntimeError(error_msg)

    async def _emit_event(self, event_type: str, payload: dict[str, Any]) -> None:
        """发出事件到 event_bus（兼容 sync/async emit 与不同签名）。"""
        if self._event_bus is None:
            return
        try:
            # 优先匹配 EventBus 标准签名 emit(task_id, event_type, payload)
            if hasattr(self._event_bus, "emit"):
                result = self._event_bus.emit(
                    payload.get("component", ""),
                    event_type,
                    payload,
                )
                if inspect.isawaitable(result):
                    await result
            elif hasattr(self._event_bus, "publish"):
                # 备选 publish(topic, payload) 风格
                result = self._event_bus.publish(event_type, payload)
                if inspect.isawaitable(result):
                    await result
        except Exception as e:
            self._logger.warning(
                f"_emit_event: failed to emit {event_type}: {e}"
            )

    def _record_metrics(
        self,
        component: str,
        tier: RecoveryTier,
        duration_seconds: float,
        success: bool,
        strategy: str,
    ) -> None:
        """上报指标：优先 record_recovery，否则回退到 inc_counter。"""
        if self._metrics is None:
            return
        try:
            if hasattr(self._metrics, "record_recovery"):
                self._metrics.record_recovery(
                    component=component,
                    duration_seconds=duration_seconds,
                    success=success,
                )
            elif hasattr(self._metrics, "inc_counter"):
                metric_name = (
                    "flowforge_recovery_success_total"
                    if success
                    else "flowforge_recovery_failure_total"
                )
                self._metrics.inc_counter(
                    metric_name,
                    labels={
                        "component": component,
                        "tier": tier.name,
                        "strategy": strategy,
                    },
                )
        except Exception as e:
            self._logger.warning(f"_record_metrics: error: {e}")

    # ------------------------------------------------------------------
    # 历史与状态
    # ------------------------------------------------------------------

    def get_recovery_history(
        self,
        component: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """获取恢复历史记录。

        Args:
            component: 仅返回该组件的记录；None 表示全部。
            limit: 最多返回的记录数（按时间倒序）。

        Returns:
            list[dict]: 历史记录列表。
        """
        if component is not None:
            records = [h for h in self._recovery_history if h["component"] == component]
        else:
            records = list(self._recovery_history)
        # 按时间倒序（最新的在前）
        records_sorted = sorted(records, key=lambda h: h.get("timestamp", 0), reverse=True)
        return records_sorted[:limit]

    def get_status(self) -> dict[str, Any]:
        """返回各 tier 的统计信息。

        Returns:
            dict: 含 total_recoveries/per_tier_stats/history_size 等。
        """
        total_successes = sum(s["successes"] for s in self._tier_stats.values())
        total_failures = sum(s["failures"] for s in self._tier_stats.values())
        total_escalations = sum(s["escalations"] for s in self._tier_stats.values())
        success_rate = (
            total_successes / self._total_recoveries
            if self._total_recoveries > 0
            else 0.0
        )

        return {
            "total_recoveries": self._total_recoveries,
            "total_successes": total_successes,
            "total_failures": total_failures,
            "total_escalations": total_escalations,
            "success_rate": success_rate,
            "per_tier_stats": {
                tier.name: dict(stats) for tier, stats in self._tier_stats.items()
            },
            "history_size": len(self._recovery_history),
        }
