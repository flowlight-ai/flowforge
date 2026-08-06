"""关系记忆（Relational Memory）— 长期，角色间互动。

F093 三路记忆的第二路。Relational Memory 存储世界中角色之间的长期关系
及互动历史。

与 Canon Memory 的区别:
    - Canon Memory：世界级真相，永久，需显式确认入典。
    - Relational Memory：角色间关系，长期，可演化（如"朋友 → 师徒"），
      不需要 Canon 级确认，但也不会污染 Canon。

与 Session Memory 的区别:
    - Relational Memory：长期存储，跨 session 保留。
    - Session Memory：临时存储，session 结束自动清理。

修复的问题:
    - CL-009：v7.0 EchoStore 是单一记忆库，关系记忆无独立存储。本类是
      Relational 路的独立存储。

详见:
    - [doc:review/review.md#13.2] CL-009
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any

from flowforge.core.world_engine.citizens import Relationship


class RelationalMemoryBase(ABC):
    """关系记忆抽象基类。

    所有 Relational Memory 实现必须继承本类并实现 ``record_interaction``
    / ``query_relationships`` / ``update_relationship`` 三个抽象方法。

    详见:
        - [doc:review/review.md#13.2] CL-009
    """

    @abstractmethod
    async def record_interaction(
        self,
        rel: Relationship,
        interaction: dict[str, Any],
    ) -> None:
        """记录一次角色间互动。

        Args:
            rel: 互动涉及的关系。
            interaction: 互动详情（如 ``{"type": "对话", "summary": "..."}``）。
        """

    @abstractmethod
    async def query_relationships(
        self,
        character_id: str,
    ) -> list[Relationship]:
        """查询一个角色的所有关系。

        Args:
            character_id: 角色 ID。

        Returns:
            该角色参与的所有 Relationship 列表。
        """

    @abstractmethod
    async def update_relationship(
        self,
        relationship_id: str,
        new_type: str,
    ) -> bool:
        """更新关系类型（关系演化，如"朋友 → 师徒"）。

        Args:
            relationship_id: 关系 ID。
            new_type: 新关系类型。

        Returns:
            ``True`` 表示更新成功；``False`` 表示关系不存在。
        """


class RelationalMemory(RelationalMemoryBase):
    """关系记忆（Relational Memory）— 长期，角色间互动。

    内存实现（骨架）。生产环境应替换为持久化实现，通过 DI 容器注入。

    与 Canon Memory 的关键区别:
        - 关系记忆可自由演化，不需要 Canon 级确认。
        - 但关系演化不会自动入典——若要把"师徒关系"提升为世界级 Canon，
          仍需通过
          :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`。

    详见:
        - [doc:review/review.md#13.2] CL-009
    """

    def __init__(self) -> None:
        # relationship_id -> Relationship
        self._relationships: dict[str, Relationship] = {}
        # relationship_id -> list[interaction]
        self._interactions: dict[str, list[dict[str, Any]]] = {}

    async def record_interaction(
        self,
        rel: Relationship,
        interaction: dict[str, Any],
    ) -> None:
        """记录一次角色间互动。

        若关系不存在，自动注册。互动记录附带时间戳。

        Args:
            rel: 互动涉及的关系。
            interaction: 互动详情。
        """
        if rel.relationship_id not in self._relationships:
            self._relationships[rel.relationship_id] = rel
        entry = {
            **interaction,
            "timestamp": interaction.get(
                "timestamp", datetime.now(UTC).isoformat()
            ),
        }
        self._interactions.setdefault(rel.relationship_id, []).append(entry)

    async def query_relationships(
        self,
        character_id: str,
    ) -> list[Relationship]:
        """查询一个角色的所有关系。

        Args:
            character_id: 角色 ID。

        Returns:
            该角色参与的所有 Relationship 列表（作为 character_a 或 character_b）。
        """
        return [
            rel
            for rel in self._relationships.values()
            if rel.character_a == character_id or rel.character_b == character_id
        ]

    async def update_relationship(
        self,
        relationship_id: str,
        new_type: str,
    ) -> bool:
        """更新关系类型（关系演化）。

        注意：关系演化不会自动入典。若要把新关系提升为 Canon，仍需通过
        :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`。

        Args:
            relationship_id: 关系 ID。
            new_type: 新关系类型。

        Returns:
            ``True`` 表示更新成功；``False`` 表示关系不存在。
        """
        rel = self._relationships.get(relationship_id)
        if rel is None:
            return False
        # Relationship 是 Pydantic 模型，重建以更新 relation_type
        self._relationships[relationship_id] = rel.model_copy(
            update={"relation_type": new_type}
        )
        return True

    async def get_interaction_history(
        self,
        relationship_id: str,
    ) -> list[dict[str, Any]]:
        """获取一个关系的互动历史。

        Args:
            relationship_id: 关系 ID。

        Returns:
            互动记录列表（按时间升序）。
        """
        return list(self._interactions.get(relationship_id, []))


__all__ = ["RelationalMemoryBase", "RelationalMemory"]
