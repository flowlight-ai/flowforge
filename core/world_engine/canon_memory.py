"""典藏记忆（Canon Memory）— 永久，世界级真相。

F093 三路记忆的第一路。Canon Memory 存储
:class:`~flowforge.core.world_engine.citizens.CanonDecision`——世界级
不可推翻的决策。

铁律（CL-010）:
    "RP 台词不自动入典"——Role Play 中灵智体说的话、做的事**不能自动
    进入 Canon 记忆**，必须经过
    :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
    显式确认（operator 或 Canon Driver 批准）。

实现约束:
    - :meth:`CanonMemory.write` 必须校验 ``confirmed_by`` 参数，拒绝未
      确认的写入。
    - Canon Memory 是**永久存储**，写入后不可删除（只能追加新决策推翻
      旧决策，但旧决策仍保留为历史记录）。

修复的问题:
    - CL-009：v7.0 EchoStore 是单一记忆库，未区分 Canon/Relational/Session
      三路。本类是 Canon 路的独立存储。
    - CL-010：v7.0 魂忆记录所有任务轨迹，所有内容自动进入记忆。本类强制
      显式确认，违反铁律的写入会被拒绝。

详见:
    - [doc:review/review.md#13.2] CL-009 / CL-010
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from flowforge.core.world_engine.citizens import CanonDecision


class CanonMemoryBase(ABC):
    """典藏记忆抽象基类。

    所有 Canon Memory 实现必须继承本类并实现 ``write`` / ``read`` /
    ``query`` 三个抽象方法。这允许不同的后端（内存 / SQLite / PostgreSQL）
    通过 DI 容器注入。

    详见:
        - [doc:review/review.md#13.2] CL-009
    """

    @abstractmethod
    async def write(
        self,
        decision: CanonDecision,
        confirmed_by: str,
    ) -> bool:
        """写入典藏记忆（需显式确认）。

        铁律（CL-010）：``confirmed_by`` 必须是 ``"operator"`` /
        ``"canon_driver"`` / ``"council"`` 之一。否则拒绝写入。

        Args:
            decision: 待入典的决策。
            confirmed_by: 确认者（必须是 Canon 写入权限持有者）。

        Returns:
            ``True`` 表示写入成功；``False`` 表示被拒绝（权限不足）。

        Raises:
            PermissionError: 当 ``confirmed_by`` 无 Canon 写入权限时。
            ValueError: 当 ``decision`` 与已有 Canon 冲突时。
        """

    @abstractmethod
    async def read(self, world_id: str) -> list[CanonDecision]:
        """读取一个世界的所有 Canon 决策（按时间排序）。

        Args:
            world_id: 世界 ID。

        Returns:
            Canon 决策列表（按 ``timestamp`` 升序）。
        """

    @abstractmethod
    async def query(
        self,
        world_id: str,
        filter_: dict[str, Any] | None = None,
    ) -> list[CanonDecision]:
        """查询 Canon 决策（支持过滤）。

        Args:
            world_id: 世界 ID。
            filter_: 过滤条件（如 ``{"decided_by": "operator"}``）。

        Returns:
            匹配的 Canon 决策列表。
        """


class CanonMemory(CanonMemoryBase):
    """典藏记忆（Canon Memory）— 永久，世界级真相。

    内存实现（骨架）。生产环境应替换为基于 SQLite / PostgreSQL 的持久化
    实现，通过 DI 容器注入。

    铁律:
        "RP 台词不自动入典"（CL-010）。所有 Canon 写入必须经过
        :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
        显式确认（operator 或 Canon Driver 批准）。

    详见:
        - [doc:review/review.md#13.2] CL-009 / CL-010
    """

    def __init__(self) -> None:
        # world_id -> list[CanonDecision]，按 timestamp 升序
        self._store: dict[str, list[CanonDecision]] = {}
        # 决策者白名单（铁律 CL-010：只有这些角色可写入 Canon）
        self._canon_writers: frozenset[str] = frozenset(
            {"operator", "canon_driver", "council"}
        )

    async def write(
        self,
        decision: CanonDecision,
        confirmed_by: str,
    ) -> bool:
        """写入典藏记忆（需显式确认）。

        铁律（CL-010）：``confirmed_by`` 必须在 ``_canon_writers`` 白名单
        中。否则拒绝写入并返回 ``False``。

        Args:
            decision: 待入典的决策。
            confirmed_by: 确认者。

        Returns:
            ``True`` 表示写入成功；``False`` 表示被拒绝。
        """
        if confirmed_by not in self._canon_writers:
            return False
        # 决策者本身也必须合法（CanonDecision 已校验 decided_by）
        if decision.decided_by not in self._canon_writers:
            return False
        bucket = self._store.setdefault(decision.world_id, [])
        # 幂等：相同 decision_id 不重复写入
        if any(d.decision_id == decision.decision_id for d in bucket):
            return True
        bucket.append(decision)
        bucket.sort(key=lambda d: d.timestamp)
        return True

    async def read(self, world_id: str) -> list[CanonDecision]:
        """读取一个世界的所有 Canon 决策（按时间排序）。

        Args:
            world_id: 世界 ID。

        Returns:
            Canon 决策列表的拷贝（按 ``timestamp`` 升序）。
        """
        return list(self._store.get(world_id, []))

    async def query(
        self,
        world_id: str,
        filter_: dict[str, Any] | None = None,
    ) -> list[CanonDecision]:
        """查询 Canon 决策（支持过滤）。

        Args:
            world_id: 世界 ID。
            filter_: 过滤条件（键名对应 CanonDecision 字段）。

        Returns:
            匹配的 Canon 决策列表。
        """
        decisions = self._store.get(world_id, [])
        if not filter_:
            return list(decisions)
        result: list[CanonDecision] = []
        for d in decisions:
            if all(getattr(d, k, None) == v for k, v in filter_.items()):
                result.append(d)
        return result

    def can_write(self, actor: str) -> bool:
        """判断 actor 是否有 Canon 写入权限。

        Args:
            actor: 待检查的角色（如 ``"operator"`` / ``"forgekin:xxx"``）。

        Returns:
            ``True`` 表示有写入权限。
        """
        return actor in self._canon_writers


__all__ = ["CanonMemoryBase", "CanonMemory"]
