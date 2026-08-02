"""HookSystem — Agent 行为事件钩子系统.

对标 Claude Code 的 Hook 系统，将 Agent 行为从黑盒变成事件流。
支持审计、限流、成本控制、自动测试等扩展。

Hook 事件类型（对标 Claude Code）：
- pre_tool_use: 工具执行前（可拦截、改写）
- post_tool_use: 工具执行后
- post_tool_use_failure: 工具执行失败后
- pre_agent_step: Agent 步骤前
- post_agent_step: Agent 步骤后
- agent_stop: Agent 完成时
- agent_stop_failure: Agent 失败时
- session_start: 会话开始
- pre_compact: 上下文压缩前
- notification: 通知事件

Usage:
    from flowforge.core.hooks import HookSystem, HookEvent, HookContext

    hooks = HookSystem()

    async def block_dangerous_tools(ctx: HookContext) -> HookResult:
        if ctx.tool_name == "shell_exec" and "rm -rf" in ctx.tool_params.get("command", ""):
            return HookResult(action=HookAction.BLOCK, message="Dangerous command blocked")
        return HookResult(action=HookAction.CONTINUE)

    hooks.register(HookEvent.PRE_TOOL_USE, block_dangerous_tools)

    # Before tool execution:
    result = await hooks.emit(HookContext(event=HookEvent.PRE_TOOL_USE, tool_name="shell_exec", ...))
    if result.action == HookAction.BLOCK:
        raise RuntimeError(result.message)
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("hooks")


class HookEvent(str, Enum):
    """Hook 事件类型，对标 Claude Code 的 10 个 Hook 事件."""

    PRE_TOOL_USE = "pre_tool_use"
    POST_TOOL_USE = "post_tool_use"
    POST_TOOL_USE_FAILURE = "post_tool_use_failure"
    PRE_AGENT_STEP = "pre_agent_step"
    POST_AGENT_STEP = "post_agent_step"
    AGENT_STOP = "agent_stop"
    AGENT_STOP_FAILURE = "agent_stop_failure"
    SESSION_START = "session_start"
    PRE_COMPACT = "pre_compact"
    NOTIFICATION = "notification"


class HookAction(str, Enum):
    """Hook 处理动作."""

    CONTINUE = "continue"   # 允许继续
    BLOCK = "block"         # 阻止执行
    MODIFY = "modify"       # 修改参数后继续


@dataclass
class HookContext:
    """Hook 上下文信息."""

    event: HookEvent
    agent_name: str = ""
    tool_name: str = ""
    tool_params: dict = field(default_factory=dict)
    result: Any = None
    error: Optional[str] = None
    timestamp: float = field(default_factory=time.time)
    metadata: dict = field(default_factory=dict)


@dataclass
class HookResult:
    """Hook 处理结果."""

    action: HookAction = HookAction.CONTINUE
    modified_params: Optional[dict] = None
    message: str = ""


HookHandler = Callable[[HookContext], HookResult]


class HookSystem:
    """事件钩子系统.

    支持：
    - 按 HookEvent 注册处理器，支持优先级排序
    - 同步/异步处理器自动适配
    - BLOCK 动作立即中断，MODIFY 动作可改写参数
    - 内置审计日志记录
    """

    def __init__(self) -> None:
        self._handlers: dict[HookEvent, list[tuple[int, HookHandler]]] = {}
        self._audit_log: list[dict] = []

    def register(self, event: HookEvent, handler: HookHandler, priority: int = 0) -> None:
        """注册 Hook 处理器.

        Args:
            event: 监听的事件类型.
            handler: 处理函数，接收 HookContext 返回 HookResult.
            priority: 优先级，数值越小越先执行.
        """
        if event not in self._handlers:
            self._handlers[event] = []
        self._handlers[event].append((priority, handler))
        self._handlers[event].sort(key=lambda x: x[0])

    def unregister(self, event: HookEvent, handler: HookHandler) -> None:
        """取消注册指定处理器."""
        if event in self._handlers:
            self._handlers[event] = [
                (p, h) for p, h in self._handlers[event] if h != handler
            ]

    async def emit(self, context: HookContext) -> HookResult:
        """触发 Hook 事件，按优先级执行处理器，返回最终决策.

        规则：
        - BLOCK 动作立即中断后续处理器
        - MODIFY 动作覆盖 CONTINUE，并更新 context.tool_params
        - 处理器异常不中断流程，仅记录警告
        """
        handlers = self._handlers.get(context.event, [])
        result = HookResult(action=HookAction.CONTINUE)

        for priority, handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    r = await handler(context)
                else:
                    r = handler(context)

                # Record audit
                self._audit_log.append({
                    "event": context.event.value,
                    "handler": handler.__name__,
                    "action": r.action.value,
                    "timestamp": context.timestamp,
                })

                # BLOCK overrides CONTINUE / MODIFY
                if r.action == HookAction.BLOCK:
                    result = r
                    break
                # MODIFY overrides CONTINUE
                if r.action == HookAction.MODIFY:
                    result = r
                    if r.modified_params:
                        context.tool_params.update(r.modified_params)
            except Exception as e:
                logger.warning(f"Hook handler {handler.__name__} failed: {e}")

        return result

    def get_audit_log(self, event: Optional[HookEvent] = None) -> list[dict]:
        """获取审计日志，可按事件类型过滤."""
        if event:
            return [l for l in self._audit_log if l["event"] == event.value]
        return self._audit_log

    def clear_audit_log(self) -> None:
        """清空审计日志."""
        self._audit_log.clear()
