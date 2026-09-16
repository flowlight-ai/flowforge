"""会话记忆（Session Memory）— 临时，单次回合。

F093 三路记忆的第三路。Session Memory 存储单次会话（session）内的
:class:`~flowforge.core.world_engine.citizens.Turn` 列表。

铁律:
    - 会话结束后自动清理，**不会污染 Canon 或 Relational 记忆**。
    - 若要把 Session 中的某个 Turn 入典，必须经过
      :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
      显式确认（CL-010）。

与 Canon / Relational Memory 的区别:
    - Session Memory：临时，session 级，自动清理。
    - Canon Memory：永久，世界级，需显式确认。
    - Relational Memory：长期，角色间，可演化。

修复的问题:
    - CL-009：v7.0 EchoStore 是单一记忆库，临时会话记忆污染永久典藏。
      本类是 Session 路的独立存储，session 结束自动清理。

详见:
    - [doc:review/review.md#13.2] CL-009
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from flowforge.core.world_engine.citizens import Turn


class SessionMemoryBase(ABC):
    """会话记忆抽象基类。

    所有 Session Memory 实现必须继承本类并实现 ``add_turn`` /
    ``clear_session`` / ``get_turns`` 三个抽象方法。

    详见:
        - [doc:review/review.md#13.2] CL-009
    """

    @abstractmethod
    async def add_turn(self, turn: Turn) -> None:
        """添加一个 Turn 到当前 session。

        Args:
            turn: 待添加的 Turn。``turn.is_canon`` 应为 ``False``（铁律 CL-010）。
        """

    @abstractmethod
    async def clear_session(self, session_id: str) -> None:
        """清理一个 session 的所有 Turn。

        铁律：本方法**不影响** Canon Memory 和 Relational Memory。即使
        session 中的某个 Turn 已通过 CanonSyncProtocol 入典，其 Canon
        副本仍保留在 Canon Memory 中。

        Args:
            session_id: session ID。
        """

    @abstractmethod
    async def get_turns(self, session_id: str) -> list[Turn]:
        """获取一个 session 的所有 Turn。

        Args:
            session_id: session ID。

        Returns:
            Turn 列表（按添加顺序）。
        """


class SessionMemory(SessionMemoryBase):
    """会话记忆（Session Memory）— 临时，单次回合。

    内存实现（骨架）。生产环境应替换为带 TTL 的缓存实现（如 Redis），
    通过 DI 容器注入。

    铁律:
        会话结束后自动清理，不会污染 Canon 或 Relational 记忆。

    详见:
        - [doc:review/review.md#13.2] CL-009
    """

    def __init__(self) -> None:
        # session_id -> list[Turn]
        self._sessions: dict[str, list[Turn]] = {}

    async def add_turn(self, turn: Turn) -> None:
        """添加一个 Turn 到当前 session。

        Args:
            turn: 待添加的 Turn。``turn.is_canon`` 应为 ``False``（铁律 CL-010）。
        """
        # Turn 通过 round_id 关联到 session（骨架实现：用 round_id 作为 session key）
        session_id = turn.round_id
        self._sessions.setdefault(session_id, []).append(turn)

    async def clear_session(self, session_id: str) -> None:
        """清理一个 session 的所有 Turn。

        铁律：本方法**不影响** Canon Memory 和 Relational Memory。

        Args:
            session_id: session ID。
        """
        self._sessions.pop(session_id, None)

    async def get_turns(self, session_id: str) -> list[Turn]:
        """获取一个 session 的所有 Turn。

        Args:
            session_id: session ID。

        Returns:
            Turn 列表的拷贝（按添加顺序）。
        """
        return list(self._sessions.get(session_id, []))

    async def get_session_ids(self) -> list[str]:
        """获取当前所有活跃 session ID（用于诊断 / 清理）。

        Returns:
            session ID 列表。
        """
        return list(self._sessions.keys())

    async def mark_turn_canon(self, turn_id: str) -> bool:
        """标记一个 Turn 为已入典（仅更新 Session 内副本的状态标记）。

        注意：本方法**不写入 Canon Memory**。Canon 写入必须通过
        :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`。
        本方法仅用于在 Session 内标记"此 Turn 已被确认入典"，避免重复提议。

        Args:
            turn_id: Turn ID。

        Returns:
            ``True`` 表示标记成功；``False`` 表示 Turn 不在当前 session 中。
        """
        for turns in self._sessions.values():
            for t in turns:
                if t.turn_id == turn_id:
                    # 重建 Turn 以更新 is_canon（Pydantic 模型默认可变）
                    idx = turns.index(t)
                    turns[idx] = t.model_copy(update={"is_canon": True})
                    return True
        return False

    async def dump_session(self, session_id: str) -> dict[str, Any]:
        """导出一个 session 的完整快照（用于诊断 / 日志）。

        Args:
            session_id: session ID。

        Returns:
            session 快照字典。
        """
        turns = self._sessions.get(session_id, [])
        return {
            "session_id": session_id,
            "turn_count": len(turns),
            "canon_count": sum(1 for t in turns if t.is_canon),
            "turns": [t.model_dump() for t in turns],
        }


__all__ = ["SessionMemoryBase", "SessionMemory"]
