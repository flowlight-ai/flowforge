"""世界驱动器（World Driver）— 世界自转。

F093 Bridge Layer 的第三协议。World Driver 让世界**自己随时间演化**——
NPC 角色自己成长、关系自己变化、场景自己推进。世界不是被动等待 agent
交互，而是有自己的"时间流"。

核心机制:
    - :meth:`tick` — 世界自转一个 tick，返回本 tick 产生的事件列表。
    - :meth:`get_world_state` — 获取当前世界状态快照。
    - :meth:`can_write_canon` — 判断 actor 是否有 Canon 写入权限。

Canon 写入权限（铁律 CL-010 / CL-021）:
    只有 ``operator`` / ``canon_driver`` / ``council`` 有权限通过
    World Driver 写入 Canon。World Driver 自身产生的"世界事件"若要入典，
    也必须经过
    :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
    显式确认。

修复的问题:
    - CL-013：v7.0 虚拟世界是"agent 触发才有反应"，无世界自转。本类提供
      tick 机制，让世界自己演化。
    - CL-021：v7.0 无 World Driver 概念，多个虚拟角色Forgekin在同一世界中
      无统一世界状态。本类是每个虚拟世界的 Driver 单例。

详见:
    - [doc:review/review.md#13.2] CL-013（世界自转未实现）
    - [doc:review/review.md#13.4] CL-021（World Driver 概念缺失）
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from flowforge.core.world_engine.canon_memory import CanonMemory

if TYPE_CHECKING:
    from flowforge.core.world_engine.world import WorldLayer


# 铁律 CL-010/CL-021：只有以下 actor 有 Canon 写入权限
_CANON_WRITERS: frozenset[str] = frozenset(
    {"operator", "canon_driver", "council"}
)


class WorldDriver:
    """世界驱动器（World Driver）— 世界自转。

    世界不是被动等待 agent 交互，而是自己随时间演化——NPC 角色自己成长、
    关系自己变化、场景自己推进。

    使用模式:
        >>> driver = WorldDriver(world=world_layer, canon_memory=canon_mem)
        >>> events = await driver.tick()  # 世界自转一个 tick
        >>> state = await driver.get_world_state()

    Canon 写入权限:
        World Driver 自身产生的"世界事件"若要入典，仍需经过
        :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`。
        本类的 :meth:`can_write_canon` 仅做权限判断，不直接写入。

    线程安全:
        非线程安全。多Forgekin共享一个 WorldDriver 时，应通过
        :class:`~flowforge.core.world_engine.coordinator.RuntimeCoordinator`
        串行化 tick。

    详见:
        - [doc:review/review.md#13.2] CL-013
        - [doc:review/review.md#13.4] CL-021
    """

    def __init__(
        self,
        world: WorldLayer,
        canon_memory: CanonMemory,
    ) -> None:
        if world is None:
            raise ValueError("world 不能为 None。")
        if canon_memory is None:
            raise ValueError("canon_memory 不能为 None。")
        self._world: WorldLayer = world
        self._canon_memory: CanonMemory = canon_memory
        self._tick_count: int = 0
        self._last_tick_at: datetime | None = None
        # 待入典的世界事件队列（等待 CanonSyncProtocol 确认）
        self._pending_events: list[dict[str, Any]] = []

    @property
    def world(self) -> WorldLayer:
        """返回驱动的世界层。"""
        return self._world

    @property
    def tick_count(self) -> int:
        """返回累计 tick 次数。"""
        return self._tick_count

    async def tick(self) -> list[dict[str, Any]]:
        """世界自转一个 tick。返回本 tick 产生的事件列表。

        骨架实现：生成一个"世界自转"事件并追加到 pending 队列。
        生产实现应:
            1. 推进世界时间（NPC 成长、关系演化、场景推进）。
            2. 产生事件列表（如"孙悟空练成了新法术"）。
            3. 高价值事件提交到 CanonSyncProtocol 提议入典。

        Returns:
            本 tick 产生的事件列表（每个事件是一个 dict）。
        """
        self._tick_count += 1
        self._last_tick_at = datetime.now(UTC)
        # 骨架：产生一个占位事件
        event: dict[str, Any] = {
            "tick": self._tick_count,
            "world_id": self._world.world_id,
            "timestamp": self._last_tick_at.isoformat(),
            "type": "world_rotation",
            "summary": f"世界 {self._world.world_id} 自转第 {self._tick_count} tick",
        }
        self._pending_events.append(event)
        return [event]

    async def get_world_state(self) -> dict[str, Any]:
        """获取当前世界状态快照。

        Returns:
            世界状态字典（包含世界设定 + 实体计数 + tick 信息）。
        """
        return {
            "world": self._world.world.model_dump(),
            "tick_count": self._tick_count,
            "last_tick_at": self._last_tick_at.isoformat()
            if self._last_tick_at
            else None,
            "pending_events": len(self._pending_events),
            "canon_writers": list(_CANON_WRITERS),
            "state": self._world.describe(),
        }

    def can_write_canon(self, actor: str) -> bool:
        """判断 actor 是否有 Canon 写入权限。

        铁律（CL-010 / CL-021）：只有 ``operator`` / ``canon_driver`` /
        ``council`` 有权限写入 Canon。其他Forgekin（包括 World Driver 自身
        产生的事件）若要入典，必须经过
        :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
        由有权限的 confirmer 确认。

        Args:
            actor: 待检查的 actor（如 ``"operator"`` / ``"forgekin:xxx"``）。

        Returns:
            ``True`` 表示有 Canon 写入权限。
        """
        return actor in _CANON_WRITERS

    def get_pending_events(self) -> list[dict[str, Any]]:
        """获取待入典的世界事件列表（用于诊断）。

        Returns:
            待入典事件列表的拷贝。
        """
        return list(self._pending_events)

    def clear_pending_events(self) -> None:
        """清空待入典事件队列（在事件被 CanonSyncProtocol 处理后调用）。"""
        self._pending_events.clear()


__all__ = ["WorldDriver"]
