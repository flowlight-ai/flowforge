"""DegradationDecisionTree — 通用降级决策树

设计文档参考：
- spec.md v2.2 第三章: 灾备与降级设计
- S3.0-22: 灾备降级设计里程碑
- LP3.0-22: DISASTER-RECOVERY
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class DegradationActionType(str, Enum):
    """降级动作类型"""
    SWITCH_PROVIDER = "switch_provider"
    DEGRADE_TO_HUMAN = "degrade_to_human"
    USE_MEMORY_FALLBACK = "use_memory_fallback"
    USE_HARDCODED_SOP = "use_hardcoded_sop"
    USE_ALTERNATIVE_TOOL = "use_alternative_tool"
    SKIP_AND_LOG = "skip_and_log"
    ABORT = "abort"


@dataclass
class DegradationAction:
    """降级动作"""
    action_type: DegradationActionType
    target: Optional[str] = None
    reason: str = ""
    urgency: str = "medium"


class DegradeToHumanEvent(BaseModel):
    """降级到人工事件"""
    task_id: str
    component: str
    original_error: str
    degradation_reason: str
    context_snapshot: Dict[str, Any] = {}
    suggested_action: str = ""
    urgency: str = "medium"

    def to_event_data(self) -> Dict[str, Any]:
        return {
            "event_type": "task.degrade_to_human",
            "data": self.model_dump(),
            "metadata": {"requires_notification": True},
        }


class DegradationDecisionTree:
    """通用降级决策树

    根据错误类型自动选择降级策略：
    - LLM不可用 → 切换备选Provider 或 降级到人工
    - 存储不可用 → 降级到内存模式
    - Workflow编译失败 → 使用硬编码SOP
    - 工具执行失败 → 使用替代工具 或 跳过
    - 其他 → 中止
    """

    def __init__(
        self,
        llm_router: Any = None,
        tool_registry: Any = None,
        event_bus: Any = None,
    ):
        self._llm_router = llm_router
        self._tool_registry = tool_registry
        self._event_bus = event_bus
        self._degradation_history: List[Dict[str, Any]] = []

    async def decide(self, component: str, error: Exception, context: Optional[Dict[str, Any]] = None) -> DegradationAction:
        """根据错误类型决定降级策略"""
        error_type = type(error).__name__
        error_msg = str(error)

        action = await self._evaluate(component, error, error_type, error_msg, context)

        self._degradation_history.append({
            "component": component,
            "error_type": error_type,
            "error_msg": error_msg[:200],
            "action": action.action_type.value,
            "target": action.target,
            "reason": action.reason,
        })

        if action.action_type == DegradationActionType.DEGRADE_TO_HUMAN:
            await self._emit_degrade_to_human(component, error, action, context)

        logger.warning(
            f"Degradation decision: component={component}, "
            f"error={error_type}, action={action.action_type.value}, "
            f"target={action.target}, reason={action.reason}"
        )

        return action

    async def _evaluate(
        self,
        component: str,
        error: Exception,
        error_type: str,
        error_msg: str,
        context: Optional[Dict[str, Any]],
    ) -> DegradationAction:
        """评估降级策略"""
        if self._is_llm_error(error_type, error_msg):
            if self._llm_router and await self._has_fallback_provider(component):
                return DegradationAction(
                    action_type=DegradationActionType.SWITCH_PROVIDER,
                    target=await self._get_fallback_provider(component),
                    reason=f"LLM error: {error_type}",
                    urgency="high",
                )
            return DegradationAction(
                action_type=DegradationActionType.DEGRADE_TO_HUMAN,
                reason=f"LLM unavailable and no fallback: {error_type}",
                urgency="critical",
            )

        if self._is_storage_error(error_type, error_msg):
            return DegradationAction(
                action_type=DegradationActionType.USE_MEMORY_FALLBACK,
                reason=f"Storage error: {error_type}",
                urgency="high",
            )

        if self._is_workflow_error(error_type, error_msg):
            return DegradationAction(
                action_type=DegradationActionType.USE_HARDCODED_SOP,
                reason=f"Workflow compilation failed: {error_type}",
                urgency="medium",
            )

        if self._is_tool_error(error_type, error_msg):
            if self._tool_registry and await self._has_alternative_tool(component):
                return DegradationAction(
                    action_type=DegradationActionType.USE_ALTERNATIVE_TOOL,
                    target=await self._get_alternative_tool(component),
                    reason=f"Tool execution failed: {error_type}",
                    urgency="medium",
                )
            return DegradationAction(
                action_type=DegradationActionType.SKIP_AND_LOG,
                reason=f"Tool failed and no alternative: {error_type}",
                urgency="low",
            )

        return DegradationAction(
            action_type=DegradationActionType.ABORT,
            reason=f"Unrecoverable error: {error_type}",
            urgency="critical",
        )

    def _is_llm_error(self, error_type: str, error_msg: str) -> bool:
        """判断是否为LLM错误"""
        llm_errors = {
            "LLMTimeoutError", "LLMRateLimitError", "LLMAuthError",
            "LLMConnectionError", "LLMResponseError", "ModelNotAvailableError",
            "APITimeoutError", "RateLimitError",
        }
        return error_type in llm_errors or "timeout" in error_msg.lower() or "429" in error_msg

    def _is_storage_error(self, error_type: str, error_msg: str) -> bool:
        """判断是否为存储错误"""
        storage_errors = {
            "StorageError", "DatabaseCorruptError", "DatabaseError",
            "SQLiteError", "OperationalError",
        }
        return error_type in storage_errors or "database" in error_msg.lower()

    def _is_workflow_error(self, error_type: str, error_msg: str) -> bool:
        """判断是否为Workflow错误"""
        workflow_errors = {
            "WorkflowCompileError", "WorkflowValidationError",
            "WorkflowExecutionError", "YAMLParseError",
        }
        return error_type in workflow_errors or "workflow" in error_msg.lower() or "yaml" in error_msg.lower()

    def _is_tool_error(self, error_type: str, error_msg: str) -> bool:
        """判断是否为工具错误"""
        tool_errors = {
            "ToolExecutionError", "ToolTimeoutError", "ToolNotFoundError",
        }
        return error_type in tool_errors or "tool" in error_msg.lower()

    async def _has_fallback_provider(self, component: str) -> bool:
        """检查是否有备选Provider"""
        if self._llm_router:
            try:
                return hasattr(self._llm_router, 'has_fallback') and await self._llm_router.has_fallback(component)
            except Exception:
                return False
        return False

    async def _get_fallback_provider(self, component: str) -> Optional[str]:
        """获取备选Provider"""
        if self._llm_router:
            try:
                return await self._llm_router.get_fallback_provider(component)
            except Exception:
                return None
        return None

    async def _has_alternative_tool(self, component: str) -> bool:
        """检查是否有替代工具"""
        if self._tool_registry:
            try:
                return hasattr(self._tool_registry, 'has_alternative') and self._tool_registry.has_alternative(component)
            except Exception:
                return False
        return False

    async def _get_alternative_tool(self, component: str) -> Optional[str]:
        """获取替代工具"""
        if self._tool_registry:
            try:
                return self._tool_registry.get_alternative(component)
            except Exception:
                return None
        return None

    async def _emit_degrade_to_human(
        self,
        component: str,
        error: Exception,
        action: DegradationAction,
        context: Optional[Dict[str, Any]],
    ) -> None:
        """触发降级到人工事件"""
        event = DegradeToHumanEvent(
            task_id=context.get("task_id", "") if context else "",
            component=component,
            original_error=str(error)[:500],
            degradation_reason=action.reason,
            context_snapshot=context or {},
            suggested_action=f"Please review and handle the {component} failure manually",
            urgency=action.urgency,
        )

        if self._event_bus:
            try:
                await self._event_bus.emit("task.degrade_to_human", event.to_event_data())
            except Exception as e:
                logger.error(f"Failed to emit degrade_to_human event: {e}")

    def get_history(self, component: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """获取降级历史"""
        history = self._degradation_history
        if component:
            history = [h for h in history if h["component"] == component]
        return history[-limit:]
