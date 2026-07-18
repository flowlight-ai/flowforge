"""CollaborationCoordinator — 三方 Agent 协作协调器（EAC v1 契约 5 Collaboration）。

协作模式编排：同步 / 异步 / 群体 swarm，与 forgemind Mind Council 互补。
本类为最小骨架实现，仅维护协作句柄，不实际调度三方 Agent。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-010 三方 Agent 与灵智体能力融合
    - [doc:review/review.md#14.3] CL-032 Agent Swarm（群体协作）
    - [doc:design.md v7.1-§D6.2] EAC v1 七契约 #5 Collaboration

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（无外部依赖时构造函数留空）
    - 编程红线 9：组合优于继承（协作模式以 Enum + 字段表达，不继承基类）
    - 编程红线 12：禁止绕过 DI 容器直接实例化
    - coordinate() 为 async（I/O 调度语义，骨架实现立即返回）

License: MIT
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.collaboration_coordinator")


class CollaborationMode(str, Enum):
    """协作模式枚举。

    Attributes:
        SYNC: 同步协作（串行调用，前者输出作为后者输入）。
        ASYNC: 异步协作（并行调用，结果聚合）。
        SWARM: 群体协作（CL-032 Agent Swarm，多 Agent 自组织）。
    """

    SYNC = "sync"
    ASYNC = "async"
    SWARM = "swarm"


class CollaborationResult(BaseModel):
    """协作结果（coordinate 完成后返回）。

    Attributes:
        handle_id: 协作句柄 ID（与 CollaborationHandle 对应）。
        task: 任务描述。
        participants: 参与方 Provider 名称列表。
        mode: 协作模式。
        status: 完成状态（"completed" / "cancelled" / "failed"）。
        artifacts: 产出物列表（各 Provider 的贡献）。
        started_at: 开始时间（UTC）。
        completed_at: 完成时间（UTC）。
    """

    handle_id: str = Field(..., description="协作句柄 ID")
    task: str = Field(..., description="任务描述")
    participants: list[str] = Field(
        default_factory=list, description="参与方 Provider 列表"
    )
    mode: CollaborationMode = Field(..., description="协作模式")
    status: str = Field(default="completed", description="完成状态")
    artifacts: list[dict[str, Any]] = Field(
        default_factory=list, description="产出物列表"
    )
    started_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="开始时间（UTC）",
    )
    completed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="完成时间（UTC）",
    )


class CollaborationHandle(BaseModel):
    """协作句柄（运行中的协作引用）。

    Attributes:
        handle_id: 句柄唯一标识（collab-{uuid8}）。
        task: 任务描述。
        mode: 协作模式。
        participants: 参与方 Provider 名称列表。
        status: 当前状态（"running" / "completed" / "cancelled"）。
    """

    handle_id: str = Field(..., description="句柄唯一标识")
    task: str = Field(..., description="任务描述")
    mode: CollaborationMode = Field(..., description="协作模式")
    participants: list[str] = Field(
        default_factory=list, description="参与方 Provider 列表"
    )
    status: str = Field(default="running", description="当前状态")


class CollaborationCoordinator:
    """三方 Agent 协作协调器（EAC v1 契约 5 Collaboration）。

    协作模式编排：同步 / 异步 / 群体 swarm，与 forgemind Mind Council 互补。

    详见 [doc:review/review.md#第九章§9.2] EX-010 + [doc:review/review.md#14.3] CL-032

    设计要点：
        - 仅维护协作句柄（dict[handle_id, handle]）
        - coordinate() 为骨架实现：直接返回成功结果，不实际调度
        - cancel() 标记状态为 cancelled（不主动中断运行中的调用）
    """

    def __init__(self) -> None:
        """初始化空协作表。

        数据通过 coordinate() 填充，由 DI 容器管理生命周期。
        """
        self._active: dict[str, CollaborationHandle] = {}
        self._supported_modes: set[CollaborationMode] = {
            CollaborationMode.SYNC,
            CollaborationMode.ASYNC,
            CollaborationMode.SWARM,
        }

    def register_collaboration_mode(
        self, mode: CollaborationMode
    ) -> None:
        """注册支持的协作模式（默认三种均已注册，本方法用于扩展）。

        Args:
            mode: 协作模式枚举值。
        """
        self._supported_modes.add(mode)
        logger.info(
            "collaboration.register_mode mode=%s total=%d",
            mode.value,
            len(self._supported_modes),
        )

    async def coordinate(
        self,
        task: str,
        participants: list[str],
        mode: CollaborationMode,
    ) -> CollaborationResult:
        """协调一次协作（骨架实现：直接返回成功）。

        实际实现应按 mode 分派：
            - SYNC: 串行调用 participants，前者输出作为后者输入
            - ASYNC: 并行调用，聚合结果
            - SWARM: 群体自组织（CL-032）

        Args:
            task: 任务描述（自然语言）。
            participants: 参与方 Provider 名称列表。
            mode: 协作模式。

        Returns:
            CollaborationResult 协作结果。
        """
        if mode not in self._supported_modes:
            raise ValueError(f"Unsupported collaboration mode: {mode}")
        handle_id = self._gen_handle_id()
        now = datetime.now(timezone.utc)
        # 注册运行中句柄
        handle = CollaborationHandle(
            handle_id=handle_id,
            task=task,
            mode=mode,
            participants=participants,
            status="running",
        )
        self._active[handle_id] = handle
        # 骨架实现：立即标记完成并返回成功
        handle.status = "completed"
        logger.info(
            "collaboration.coordinate handle=%s mode=%s participants=%d",
            handle_id,
            mode.value,
            len(participants),
        )
        return CollaborationResult(
            handle_id=handle_id,
            task=task,
            participants=participants,
            mode=mode,
            status="completed",
            artifacts=[],
            started_at=now,
            completed_at=datetime.now(timezone.utc),
        )

    def list_active_collaborations(
        self,
    ) -> list[CollaborationHandle]:
        """列出所有协作句柄（含已完成，便于审计）。

        Returns:
            CollaborationHandle 列表。
        """
        return list(self._active.values())

    def cancel(self, handle_id: str) -> bool:
        """取消协作（标记状态为 cancelled）。

        骨架实现：仅修改状态，不主动中断运行中的调用。

        Args:
            handle_id: 协作句柄 ID。

        Returns:
            是否成功取消（不存在返回 False）。
        """
        handle = self._active.get(handle_id)
        if handle is None:
            return False
        handle.status = "cancelled"
        logger.info(
            "collaboration.cancel handle=%s previous_status=running",
            handle_id,
        )
        return True

    @staticmethod
    def _gen_handle_id() -> str:
        """生成协作句柄 ID：collab-{uuid8}。"""
        return f"collab-{uuid.uuid4().hex[:8]}"
