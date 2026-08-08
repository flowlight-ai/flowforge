"""DegradationDecisionTree — 通用降级决策树

设计文档参考：spec.md v2.2 第三章, S3.0-22, LP3.0-22

本模块同时提供 ResilienceExecutor（P3-005 灾备降级 100% 成功保障），
通过主备 provider 链路 + 指数退避 + 永久错误快速切换 + 静默失败检测 +
质量门禁 + 配额检查，确保在合理配置 backup 后总有一个 provider 能成功。
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class DegradationActionType(str, Enum):
    SWITCH_PROVIDER = "switch_provider"
    DEGRADE_TO_HUMAN = "degrade_to_human"
    USE_MEMORY_FALLBACK = "use_memory_fallback"
    USE_HARDCODED_SOP = "use_hardcoded_sop"
    USE_ALTERNATIVE_TOOL = "use_alternative_tool"
    SKIP_AND_LOG = "skip_and_log"
    ABORT = "abort"


@dataclass
class DegradationAction:
    action_type: DegradationActionType
    target: Optional[str] = None
    reason: str = ""
    urgency: str = "medium"


class DegradeToHumanEvent(BaseModel):
    task_id: str = ""
    component: str = ""
    original_error: str = ""
    degradation_reason: str = ""
    context_snapshot: Dict[str, Any] = {}
    suggested_action: str = ""
    urgency: str = "medium"

    def to_event_data(self) -> Dict[str, Any]:
        return {"event_type": "task.degrade_to_human", "data": self.model_dump(), "metadata": {"requires_notification": True}}


class DegradationDecisionTree:
    """通用降级决策树

    根据错误类型自动选择降级策略：
    LLM不可用→切换Provider/降级人工
    存储不可用→内存模式
    Workflow编译失败→硬编码SOP
    工具执行失败→替代工具/跳过
    其他→中止
    """

    def __init__(self, llm_router: Any = None, tool_registry: Any = None, event_bus: Any = None):
        self._llm_router = llm_router
        self._tool_registry = tool_registry
        self._event_bus = event_bus
        self._degradation_history: List[Dict[str, Any]] = []

    async def decide(self, component: str, error: Exception, context: Optional[Dict[str, Any]] = None) -> DegradationAction:
        error_type = type(error).__name__
        error_msg = str(error)
        logger.info(f"DegradationDecision decide: component={component}, error_type={error_type}, error_msg={error_msg[:100]}")
        action = await self._evaluate(component, error, error_type, error_msg, context)
        self._degradation_history.append({
            "component": component, "error_type": error_type,
            "error_msg": error_msg[:200], "action": action.action_type.value,
            "target": action.target, "reason": action.reason,
        })
        if action.action_type == DegradationActionType.DEGRADE_TO_HUMAN:
            await self._emit_degrade_to_human(component, error, action, context)
        logger.warning(f"Degradation: component={component}, error={error_type}, action={action.action_type.value}, target={action.target}")
        return action

    async def _evaluate(self, component: str, error: Exception, error_type: str, error_msg: str, context: Optional[Dict[str, Any]]) -> DegradationAction:
        if self._is_llm_error(error_type, error_msg):
            logger.debug(f"DegradationDecision _evaluate: LLM error matched, has_router={self._llm_router is not None}, component={component}")
            if self._llm_router:
                try:
                    fallback = await self._llm_router.get_fallback_provider(component) if hasattr(self._llm_router, 'get_fallback_provider') else None
                    if fallback:
                        logger.debug(f"DegradationDecision _evaluate: LLM fallback found, target={fallback}, component={component}")
                        return DegradationAction(action_type=DegradationActionType.SWITCH_PROVIDER, target=fallback, reason=f"LLM error: {error_type}", urgency="high")
                except Exception as e:
                    logger.warning(f"DegradationDecision _evaluate: LLM fallback lookup failed, error={e}, component={component}")
            logger.warning(f"DegradationDecision _evaluate: LLM unavailable, degrading to human, component={component}")
            return DegradationAction(action_type=DegradationActionType.DEGRADE_TO_HUMAN, reason=f"LLM unavailable: {error_type}", urgency="critical")

        if self._is_storage_error(error_type, error_msg):
            logger.debug(f"DegradationDecision _evaluate: storage error matched, falling back to memory, component={component}")
            return DegradationAction(action_type=DegradationActionType.USE_MEMORY_FALLBACK, reason=f"Storage error: {error_type}", urgency="high")

        if self._is_workflow_error(error_type, error_msg):
            logger.debug(f"DegradationDecision _evaluate: workflow error matched, using hardcoded SOP, component={component}")
            return DegradationAction(action_type=DegradationActionType.USE_HARDCODED_SOP, reason=f"Workflow failed: {error_type}", urgency="medium")

        if self._is_tool_error(error_type, error_msg):
            logger.debug(f"DegradationDecision _evaluate: tool error matched, has_registry={self._tool_registry is not None}, component={component}")
            if self._tool_registry:
                try:
                    alt = self._tool_registry.get_alternative(component) if hasattr(self._tool_registry, 'get_alternative') else None
                    if alt:
                        logger.debug(f"DegradationDecision _evaluate: tool alternative found, target={alt}, component={component}")
                        return DegradationAction(action_type=DegradationActionType.USE_ALTERNATIVE_TOOL, target=alt, reason=f"Tool failed: {error_type}", urgency="medium")
                except Exception as e:
                    logger.warning(f"DegradationDecision _evaluate: tool alternative lookup failed, error={e}, component={component}")
            logger.warning(f"DegradationDecision _evaluate: tool failed, no alternative, skipping, component={component}")
            return DegradationAction(action_type=DegradationActionType.SKIP_AND_LOG, reason=f"Tool failed, no alternative: {error_type}", urgency="low")

        logger.error(f"DegradationDecision _evaluate: unrecoverable error, aborting, component={component}, error_type={error_type}")
        return DegradationAction(action_type=DegradationActionType.ABORT, reason=f"Unrecoverable: {error_type}", urgency="critical")

    def _is_llm_error(self, error_type: str, error_msg: str) -> bool:
        llm_errors = {"LLMTimeoutError", "LLMRateLimitError", "LLMAuthError", "LLMConnectionError", "ModelNotAvailableError", "APITimeoutError", "RateLimitError"}
        matched = error_type in llm_errors or "timeout" in error_msg.lower() or "429" in error_msg
        logger.debug(f"DegradationDecision _is_llm_error: error_type={error_type}, matched={matched}")
        return matched

    def _is_storage_error(self, error_type: str, error_msg: str) -> bool:
        matched = error_type in {"StorageError", "DatabaseCorruptError", "DatabaseError", "SQLiteError", "OperationalError"} or "database" in error_msg.lower()
        logger.debug(f"DegradationDecision _is_storage_error: error_type={error_type}, matched={matched}")
        return matched

    def _is_workflow_error(self, error_type: str, error_msg: str) -> bool:
        matched = error_type in {"WorkflowCompileError", "WorkflowValidationError", "YAMLParseError"} or "workflow" in error_msg.lower() or "yaml" in error_msg.lower()
        logger.debug(f"DegradationDecision _is_workflow_error: error_type={error_type}, matched={matched}")
        return matched

    def _is_tool_error(self, error_type: str, error_msg: str) -> bool:
        matched = error_type in {"ToolExecutionError", "ToolTimeoutError", "ToolNotFoundError"} or "tool" in error_msg.lower()
        logger.debug(f"DegradationDecision _is_tool_error: error_type={error_type}, matched={matched}")
        return matched

    async def _emit_degrade_to_human(self, component: str, error: Exception, action: DegradationAction, context: Optional[Dict[str, Any]]) -> None:
        event = DegradeToHumanEvent(
            task_id=context.get("task_id", "") if context else "",
            component=component, original_error=str(error)[:500],
            degradation_reason=action.reason, context_snapshot=context or {},
            suggested_action=f"Please review and handle the {component} failure manually",
            urgency=action.urgency,
        )
        if self._event_bus:
            try:
                await self._event_bus.emit("task.degrade_to_human", event.to_event_data())
                logger.info(f"DegradationDecision _emit_degrade_to_human: event emitted, component={component}, task_id={event.task_id}")
            except Exception as e:
                logger.error(f"DegradationDecision _emit_degrade_to_human: emit failed, component={component}, error={e}", exc_info=True)
        else:
            logger.warning(f"DegradationDecision _emit_degrade_to_human: no event_bus configured, event not emitted, component={component}")

    def get_history(self, component: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        logger.debug(f"DegradationDecision get_history: component={component}, limit={limit}")
        history = self._degradation_history
        if component:
            history = [h for h in history if h["component"] == component]
        result = history[-limit:]
        logger.debug(f"DegradationDecision get_history: result_count={len(result)}")
        return result


# ===========================================================================
# P3-005 灾备降级 100% 成功保障 — ResilienceExecutor
# ===========================================================================


@dataclass
class AttemptRecord:
    """单 provider 尝试记录。

    记录一次 provider 调用（含重试）的完整结果。
    """

    provider: str
    success: bool = False
    error_type: str = ""
    error_msg: str = ""
    attempts_count: int = 0
    duration_seconds: float = 0.0
    silent_failure: bool = False
    value: Any = None


class ResilienceResult(BaseModel):
    """ResilienceExecutor 执行结果。"""

    success: bool
    value: Any = None
    provider_used: str = ""
    attempts: List[Dict[str, Any]] = Field(default_factory=list)
    total_duration_seconds: float = 0.0
    fallback_used: bool = False
    degradation_action: Optional[str] = None


class AllProvidersFailedError(Exception):
    """所有 provider 均失败的异常。

    携带 ``attempts`` 属性（list[AttemptRecord]），用于诊断每个 provider 的失败原因。
    """

    def __init__(
        self,
        message: str,
        attempts: Optional[List[AttemptRecord]] = None,
    ) -> None:
        super().__init__(message)
        self.attempts: List[AttemptRecord] = attempts or []


class ResilienceExecutor:
    """灾备执行器 — 100% 成功保障。

    通过 [primary] + backup_providers 顺序尝试，配合指数退避重试、
    永久错误快速切换、临时错误重试、静默失败检测、配额检查、质量门禁，
    保证在合理配置 backup 后总有一个 provider 能成功。

    三层 fallback 策略：
        1. 主 provider → backup provider（同步切换）
        2. backup provider 全部失败 → 使用 ``default_value``（如果提供）
        3. 无 default_value → degrade_to_human（人工兜底）

    依赖通过构造函数注入（铁律12 不绕过 DI）：
        - provider_quota_manager: 可选，配额管理器
        - metrics_collector: 可选，指标采集器（支持 record_degradation 或 inc_counter）
    """

    # 永久错误关键词（不重试，直接切换下一 provider）
    PERMANENT_ERROR_KEYWORDS: tuple = (
        "model_not_found",
        "no_permission",
        "model disabled",
        "all_backends_failed",
        "无权访问",
        "当前不可用",
        "empty_response",
        "无法回答",
    )

    # 临时错误关键词（指数退避重试）
    TEMPORARY_ERROR_KEYWORDS: tuple = (
        "timeout",
        "rate_limit",
        "429",
        "connection",
        "503",
        "502",
    )

    # 静默失败关键词（openroute HTTP 200 但内容不可用）
    SILENT_FAILURE_KEYWORDS: tuple = (
        "当前不可用，请稍后重试",
        "当前不可用,请稍后重试",
        "服务暂时不可用",
    )

    def __init__(
        self,
        primary_provider: str,
        backup_providers: List[str],
        provider_quota_manager: Any = None,
        metrics_collector: Any = None,
        max_retries: int = 3,
        base_retry_delay: float = 1.0,
    ) -> None:
        if not primary_provider:
            raise ValueError("primary_provider must not be empty")
        if max_retries < 1:
            raise ValueError("max_retries must be >= 1")
        if base_retry_delay < 0:
            raise ValueError("base_retry_delay must be >= 0")

        self.primary_provider: str = primary_provider
        self.backup_providers: List[str] = list(backup_providers)
        self._quota_manager: Any = provider_quota_manager
        self._metrics: Any = metrics_collector
        self.max_retries: int = max_retries
        self.base_retry_delay: float = base_retry_delay

        # 统计
        self._total_executions: int = 0
        self._total_successes: int = 0
        self._total_failures: int = 0
        self._degradation_count: int = 0
        self._per_provider_stats: Dict[str, Dict[str, int]] = {}

    # ------------------------------------------------------------------
    # 主入口
    # ------------------------------------------------------------------

    async def execute_with_resilience(
        self,
        operation: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> ResilienceResult:
        """按 [primary] + backup_providers 顺序尝试，保障 100% 成功。

        kwargs 支持的 resilience 专用参数（不传递给 operation）：
            - on_all_fail: "raise" | "return_default" | "degrade_to_human"
              全部 provider 失败时的处理策略，默认 "raise"。
            - default_value: Any
              当 on_all_fail="return_default" 时返回的兜底值。
            - quality_check_fn: Callable[[Any], bool]
              质量门禁函数，返回 False 视为失败继续尝试下一 provider。

        operation 调用时会被注入 ``provider=<current_provider>`` 关键字参数，
        以便其根据 provider 切换具体实现。

        Returns:
            ResilienceResult: 执行结果，含成功标志、值、provider、尝试记录等。
        """
        start_time: float = time.time()
        self._total_executions += 1

        # 提取 resilience 专用参数（不传递给 operation）
        on_all_fail: str = kwargs.pop("on_all_fail", "raise")
        default_value: Any = kwargs.pop("default_value", None)
        quality_check_fn: Optional[Callable[[Any], bool]] = kwargs.pop(
            "quality_check_fn", None
        )

        all_attempts: List[AttemptRecord] = []
        providers: List[str] = [self.primary_provider] + list(self.backup_providers)

        for provider in providers:
            # 配额检查：超限则直接跳过该 provider
            if self._quota_manager is not None:
                try:
                    quota_ok = await self._quota_manager.check_quota(provider)
                except Exception as e:
                    logger.warning(
                        f"ResilienceExecutor: quota check error for "
                        f"provider={provider}: {e}"
                    )
                    quota_ok = True  # 容错：检查失败不阻断
                if not quota_ok:
                    record = AttemptRecord(
                        provider=provider,
                        success=False,
                        error_type="quota_exceeded",
                        error_msg=f"Provider {provider} quota exceeded",
                        attempts_count=0,
                        duration_seconds=0.0,
                    )
                    all_attempts.append(record)
                    self._record_provider_failure(provider)
                    self._record_metrics(
                        provider, success=False, reason="quota_exceeded"
                    )
                    logger.info(
                        f"ResilienceExecutor: skip provider={provider} "
                        f"(quota exceeded)"
                    )
                    continue

            # 尝试该 provider（带指数退避重试）
            record = await self._try_provider(
                provider, operation, args, kwargs, quality_check_fn
            )
            all_attempts.append(record)

            if record.success:
                self._total_successes += 1
                self._record_provider_success(provider)
                self._record_metrics(provider, success=True)
                duration = time.time() - start_time
                logger.info(
                    f"ResilienceExecutor: success provider={provider}, "
                    f"fallback_used={provider != self.primary_provider}, "
                    f"duration={duration:.3f}s"
                )
                return ResilienceResult(
                    success=True,
                    value=record.value,
                    provider_used=provider,
                    attempts=[
                        self._attempt_to_dict(a) for a in all_attempts
                    ],
                    total_duration_seconds=duration,
                    fallback_used=(provider != self.primary_provider),
                )

            self._record_provider_failure(provider)
            self._record_metrics(
                provider,
                success=False,
                reason=f"{record.error_type}: {record.error_msg}",
            )
            logger.info(
                f"ResilienceExecutor: provider={provider} failed, "
                f"error_type={record.error_type}, silent={record.silent_failure}, "
                f"attempts={record.attempts_count}"
            )

        # 所有 provider 都失败
        duration = time.time() - start_time
        self._total_failures += 1
        self._degradation_count += 1

        if on_all_fail == "return_default":
            logger.warning(
                f"ResilienceExecutor: all providers failed, "
                f"returning default_value, duration={duration:.3f}s"
            )
            return ResilienceResult(
                success=False,
                value=default_value,
                provider_used="",
                attempts=[self._attempt_to_dict(a) for a in all_attempts],
                total_duration_seconds=duration,
                fallback_used=True,
                degradation_action="return_default",
            )

        if on_all_fail == "degrade_to_human":
            action_str = await self._degrade_to_human(all_attempts, kwargs)
            logger.warning(
                f"ResilienceExecutor: all providers failed, "
                f"degrade_to_human action={action_str}, duration={duration:.3f}s"
            )
            return ResilienceResult(
                success=False,
                value=default_value,
                provider_used="",
                attempts=[self._attempt_to_dict(a) for a in all_attempts],
                total_duration_seconds=duration,
                fallback_used=True,
                degradation_action=action_str,
            )

        # 默认 "raise"
        logger.error(
            f"ResilienceExecutor: all {len(providers)} providers failed, "
            f"raising AllProvidersFailedError, duration={duration:.3f}s"
        )
        raise AllProvidersFailedError(
            f"All {len(providers)} providers failed "
            f"(primary={self.primary_provider})",
            attempts=all_attempts,
        )

    # ------------------------------------------------------------------
    # 单 provider 尝试（含指数退避重试）
    # ------------------------------------------------------------------

    async def _try_provider(
        self,
        provider: str,
        operation: Callable[..., Any],
        args: tuple,
        kwargs: dict,
        quality_check_fn: Optional[Callable[[Any], bool]] = None,
    ) -> AttemptRecord:
        """单 provider 尝试，包含指数退避重试。

        - 永久错误：不重试，直接返回失败
        - 临时错误：按 base_retry_delay * 2^attempt 指数退避重试
        - 静默失败：不重试，直接返回失败
        - 质量门禁不过：不重试，直接返回失败
        """
        start: float = time.time()
        attempts_count: int = 0
        last_error_type: str = ""
        last_error_msg: str = ""
        silent_failure: bool = False
        value: Any = None
        success: bool = False

        # 注入 provider 关键字参数
        op_kwargs: Dict[str, Any] = dict(kwargs)
        op_kwargs["provider"] = provider

        for attempt in range(self.max_retries):
            attempts_count = attempt + 1
            try:
                result = operation(*args, **op_kwargs)
                if inspect.isawaitable(result):
                    result = await result

                # 检查静默失败（HTTP 200 + 内容含 "当前不可用，请稍后重试"）
                if self._is_silent_failure_result(result):
                    silent_failure = True
                    last_error_type = "silent_failure"
                    last_error_msg = (
                        "openroute silent failure detected: "
                        "HTTP 200 with unavailable content"
                    )
                    logger.warning(
                        f"ResilienceExecutor: silent failure provider={provider}"
                    )
                    break  # 静默失败不重试，直接切换

                # 质量门禁
                if quality_check_fn is not None:
                    try:
                        quality_ok = quality_check_fn(result)
                    except Exception as qe:
                        logger.warning(
                            f"ResilienceExecutor: quality check error "
                            f"provider={provider}: {qe}"
                        )
                        quality_ok = True  # 容错：检查失败不阻断
                    if not quality_ok:
                        last_error_type = "quality_check_failed"
                        last_error_msg = "Quality check failed"
                        logger.info(
                            f"ResilienceExecutor: quality check failed "
                            f"provider={provider}"
                        )
                        break  # 质量不过关：不重试，直接切换

                value = result
                success = True
                break  # 成功

            except Exception as e:
                last_error_type = type(e).__name__
                last_error_msg = str(e)
                error_class = self._classify_error(e)

                if error_class == "silent_failure":
                    silent_failure = True
                    last_error_type = "silent_failure"
                    break  # 静默失败不重试

                if error_class == "permanent":
                    logger.info(
                        f"ResilienceExecutor: permanent error "
                        f"provider={provider}, error={last_error_type}: "
                        f"{last_error_msg[:100]}"
                    )
                    break  # 永久错误：不重试

                # temporary：指数退避重试
                if attempt < self.max_retries - 1:
                    delay = self.base_retry_delay * (2 ** attempt)
                    logger.info(
                        f"ResilienceExecutor: retry provider={provider} "
                        f"after {delay:.3f}s (attempt {attempt + 1}/"
                        f"{self.max_retries}), error={last_error_type}"
                    )
                    if delay > 0:
                        await asyncio.sleep(delay)
                # 最后一次重试后退出循环

        duration: float = time.time() - start
        return AttemptRecord(
            provider=provider,
            success=success,
            error_type=last_error_type if not success else "",
            error_msg=last_error_msg if not success else "",
            attempts_count=attempts_count,
            duration_seconds=duration,
            silent_failure=silent_failure,
            value=value if success else None,
        )

    # ------------------------------------------------------------------
    # 错误分类
    # ------------------------------------------------------------------

    def _classify_error(self, error: Exception) -> str:
        """分类错误：permanent / temporary / silent_failure。

        - permanent: model_not_found/no_permission/model disabled/
                     all_backends_failed/无权访问/当前不可用/empty_response/无法回答
        - temporary: timeout/rate_limit/429/connection/503/502
        - silent_failure: 内容含 "当前不可用，请稍后重试" 等
        """
        msg = str(error)
        error_type = type(error).__name__
        combined = (msg + " " + error_type).lower()

        # 检查静默失败
        if self._is_silent_failure(msg):
            return "silent_failure"

        # 检查永久错误
        for kw in self.PERMANENT_ERROR_KEYWORDS:
            if kw in combined:
                return "permanent"

        # 检查临时错误
        for kw in self.TEMPORARY_ERROR_KEYWORDS:
            if kw in combined:
                return "temporary"

        # 默认视为临时错误（可重试）
        return "temporary"

    def _is_silent_failure(self, content: str) -> bool:
        """检测 openroute 静默失败内容。

        openroute 偶发返回 HTTP 200 但内容包含 "当前不可用，请稍后重试"，
        需识别为永久错误并切换 provider。
        """
        if not content:
            return False
        text = content if isinstance(content, str) else str(content)
        for kw in self.SILENT_FAILURE_KEYWORDS:
            if kw in text:
                return True
        return False

    def _is_silent_failure_result(self, result: Any) -> bool:
        """检查操作返回值是否为静默失败。

        支持以下结果形态：
            - str: 直接检查
            - dict: 检查常见字段（content/text/response/output/message/result）
            - 对象: 检查常见属性（content/text/response/output/message）
        """
        if isinstance(result, str):
            return self._is_silent_failure(result)
        if isinstance(result, dict):
            for key in (
                "content", "text", "response", "output", "message", "result",
            ):
                val = result.get(key)
                if isinstance(val, str) and self._is_silent_failure(val):
                    return True
            return False
        # 对象：尝试访问常见属性
        for attr in ("content", "text", "response", "output", "message"):
            val = getattr(result, attr, None)
            if isinstance(val, str) and self._is_silent_failure(val):
                return True
        return False

    # ------------------------------------------------------------------
    # 降级到人工兜底
    # ------------------------------------------------------------------

    async def _degrade_to_human(
        self,
        attempts: List[AttemptRecord],
        context: dict,
    ) -> str:
        """调用 DegradationDecisionTree 决定降级动作。

        构造合成异常时显式标注 LLM 上下文（"LLM providers exhausted (timeout-like
        condition)"），以便 DegradationDecisionTree._is_llm_error 能识别为 LLM
        故障并返回 DEGRADE_TO_HUMAN 动作。
        """
        tree = DegradationDecisionTree(
            llm_router=None,
            tool_registry=None,
            event_bus=None,
        )
        last = attempts[-1] if attempts else None
        synth_error = RuntimeError(
            f"LLM providers exhausted (timeout-like condition). "
            f"All providers failed. Last error: "
            f"{last.error_type if last else 'unknown'}: "
            f"{last.error_msg if last else ''}"
        )
        try:
            action = await tree.decide(
                component="resilience_executor",
                error=synth_error,
                context={
                    "attempts": [self._attempt_to_dict(a) for a in attempts],
                    **context,
                },
            )
            return action.action_type.value
        except Exception as e:
            logger.error(
                f"ResilienceExecutor: degrade_to_human failed: {e}",
                exc_info=True,
            )
            return DegradationActionType.DEGRADE_TO_HUMAN.value

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------

    def _attempt_to_dict(self, record: AttemptRecord) -> Dict[str, Any]:
        """AttemptRecord 序列化为 dict。"""
        return {
            "provider": record.provider,
            "success": record.success,
            "error_type": record.error_type,
            "error_msg": record.error_msg,
            "attempts_count": record.attempts_count,
            "duration_seconds": record.duration_seconds,
            "silent_failure": record.silent_failure,
            "value": record.value,
        }

    def _record_provider_success(self, provider: str) -> None:
        if provider not in self._per_provider_stats:
            self._per_provider_stats[provider] = {"success": 0, "failure": 0}
        self._per_provider_stats[provider]["success"] += 1

    def _record_provider_failure(self, provider: str) -> None:
        if provider not in self._per_provider_stats:
            self._per_provider_stats[provider] = {"success": 0, "failure": 0}
        self._per_provider_stats[provider]["failure"] += 1

    def _record_metrics(
        self, provider: str, success: bool, reason: str = ""
    ) -> None:
        """采集指标：优先调用 record_degradation，否则回退到 inc_counter。"""
        if self._metrics is None:
            return
        try:
            if hasattr(self._metrics, "record_degradation"):
                self._metrics.record_degradation(
                    provider=provider, success=success, reason=reason
                )
            elif hasattr(self._metrics, "inc_counter"):
                metric_name = (
                    "resilience_success_total"
                    if success
                    else "resilience_failure_total"
                )
                self._metrics.inc_counter(
                    metric_name, labels={"provider": provider}
                )
        except Exception as e:
            logger.warning(
                f"ResilienceExecutor: metrics record error: {e}"
            )

    def get_resilience_status(self) -> Dict[str, Any]:
        """返回成功率、降级次数等统计。

        Returns:
            dict: 含 total_executions/total_successes/total_failures/
                  success_rate/degradation_count/primary_provider/
                  backup_providers/per_provider_stats 等字段。
        """
        success_rate = (
            self._total_successes / self._total_executions
            if self._total_executions > 0
            else 0.0
        )
        return {
            "total_executions": self._total_executions,
            "total_successes": self._total_successes,
            "total_failures": self._total_failures,
            "success_rate": success_rate,
            "degradation_count": self._degradation_count,
            "primary_provider": self.primary_provider,
            "backup_providers": list(self.backup_providers),
            "per_provider_stats": {
                p: dict(stats) for p, stats in self._per_provider_stats.items()
            },
        }
