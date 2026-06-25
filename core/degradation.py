"""DegradationDecisionTree — 通用降级决策树

设计文档参考：spec.md v2.2 第三章, S3.0-22, LP3.0-22
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

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
