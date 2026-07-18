"""ExternalAgentSharedState — 三方 Agent 状态共享机制。

按 EX-004 实现跨三方 Agent 的状态共享：
灵智体调用 claude code 修改代码后，codex 接手 review 时应能看到
claude code 的修改历史和决策上下文。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-004 三方 Agent 状态共享缺失
    - [doc:decisions/006-external-agent-integration.md] §5 调用流程第 5 步
    - roleagent.md 第 2 章 Shared State 是多 agent 协作基础

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（state_store 由 host 注入）
    - 铁律 4：所有持久化操作通过 Repository 层（state_store 抽象）
    - 所有 I/O 操作使用 async/await

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional, Protocol

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.shared_state")


class SharedStateStore(Protocol):
    """共享状态存储后端协议（DI 注入点）。

    实现方可以是 SQLite / Redis / 内存字典，由 host 在 DI 容器中决定。
    本模块只定义协议，不绑定具体存储——遵循"配置驱动 > 代码实现"。
    """

    async def read(self, forgekin_id: str, key: str) -> Optional[Any]:
        """读取共享状态。"""
        ...

    async def write(self, forgekin_id: str, key: str, value: Any) -> None:
        """写入共享状态。"""
        ...

    async def list_keys(self, forgekin_id: str) -> list[str]:
        """列出某灵智体下所有共享状态键。"""
        ...


class SharedStateEntry(BaseModel):
    """共享状态条目（单条历史记录）。"""

    forgekin_id: str = Field(..., description="灵智体 ID")
    provider_name: str = Field(..., description="写入该条目的三方 Agent")
    key: str = Field(..., description="状态键")
    value: Any = Field(..., description="状态值")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="写入时间（UTC）",
    )
    decision_context: dict[str, Any] = Field(
        default_factory=dict, description="决策上下文（如 task / 工具调用链）"
    )


class ExternalAgentSharedState:
    """三方 Agent 状态共享（EX-004）。

    灵智体调用 claude code 修改代码后，codex 接手 review 时应能看到
    claude code 的修改历史和决策上下文。

    详见 [doc:review/review.md#第九章§9.2] EX-004

    典型连续协作流：
        灵智体 → claude code 写代码 → codex review → trae 部署
        ↑ 每一步的修改历史和决策上下文都通过 SharedState 共享 ↓
    """

    def __init__(self, state_store: SharedStateStore) -> None:
        """注入共享状态存储后端。

        Args:
            state_store: 共享状态存储后端（SQLite / Redis / 内存字典）。
                必须由 host 在 DI 容器中注入，本类不自己实例化存储。
        """
        self._store = state_store

    async def write(
        self,
        forgekin_id: str,
        key: str,
        value: Any,
        provider_name: str = "",
        decision_context: Optional[dict[str, Any]] = None,
    ) -> None:
        """写入共享状态条目。

        Args:
            forgekin_id: 灵智体 ID（命名空间隔离）。
            key: 状态键（如 "code_changes/main.py"）。
            value: 状态值（任意可序列化对象）。
            provider_name: 写入该条目的三方 Agent（用于审计追踪）。
            decision_context: 决策上下文（task / 工具调用链 / 提示词摘要）。
        """
        entry = SharedStateEntry(
            forgekin_id=forgekin_id,
            provider_name=provider_name,
            key=key,
            value=value,
            decision_context=decision_context or {},
        )
        await self._store.write(forgekin_id, key, entry.model_dump())
        logger.debug(
            "shared_state.write forgekin=%s key=%s provider=%s",
            forgekin_id,
            key,
            provider_name,
        )

    async def read(self, forgekin_id: str, key: str) -> Optional[Any]:
        """读取共享状态条目。"""
        return await self._store.read(forgekin_id, key)

    async def list_history(self, forgekin_id: str) -> list[dict[str, Any]]:
        """列出某灵智体的全部共享状态历史（按时间顺序）。

        用于跨厂商协作场景：codex 接手 review 前先 list_history 查看
        claude code 的修改历史和决策上下文。
        """
        keys = await self._store.list_keys(forgekin_id)
        history: list[dict[str, Any]] = []
        for k in keys:
            entry = await self._store.read(forgekin_id, k)
            if entry is not None:
                history.append(entry if isinstance(entry, dict) else {"key": k, "value": entry})
        history.sort(key=lambda e: e.get("timestamp", ""))
        return history

    async def clear(self, forgekin_id: str) -> None:
        """清空某灵智体的共享状态（任务完成后清理）。

        注意：此方法不会自动调用，需 host 显式触发——避免误删历史。
        """
        keys = await self._store.list_keys(forgekin_id)
        for k in keys:
            await self._store.write(forgekin_id, k, None)
        logger.info("shared_state.clear forgekin=%s cleared=%d", forgekin_id, len(keys))
