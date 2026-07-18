"""典藏同步协议（Canon Sync Protocol）— 铁律："RP 台词不自动入典"。

F093 Bridge Layer 的第二协议。Canon Sync Protocol 是 Core Identity 与
World 之间的"宪法闸门"——所有试图进入 Canon Memory 的内容必须经过本
协议显式确认。

铁律（CL-010）:
    "Role Play 中灵智体说的话、做的事**不能自动进入 Canon 记忆**，必须
    经过 Canon Sync Protocol 显式确认（operator 或 Canon Driver 批准）。"

    这是 F093 最重要的铁律。违反此铁律会导致：
        ① 灵智体在扮演孙悟空时说的"我是齐天大圣"会自动进入记忆
        ② 下次任务可能真的认为自己是孙悟空（身份漂移，CL-007）
        ③ RP 错误污染世界级真相（Canon 污染，CL-009）

协议流程:
    1. ``propose_canon(turn, proposer)`` — 提议将 Turn 入典，返回 proposal_id
    2. ``confirm_canon(proposal_id, confirmer)`` — 确认入典（仅 operator /
       canon_driver 有权限），写入 CanonMemory
    3. ``reject_canon(proposal_id, rejecter, reason)`` — 拒绝入典（任何人
       可拒绝，记录拒绝原因）

修复的问题:
    - CL-010：v7.0 灵忆记录所有任务轨迹，所有内容自动进入记忆。本协议
      强制显式确认，违反铁律的入典会被拒绝。

详见:
    - [doc:review/review.md#13.2] CL-010（"RP 台词不自动入典"铁律未实现）
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from flowforge.core.world_engine.canon_memory import CanonMemory
from flowforge.core.world_engine.citizens import CanonDecision, Turn
from flowforge.core.world_engine.session_memory import SessionMemory


# 铁律 CL-010：只有以下角色有权限确认入典
_CANON_CONFIRMERS: frozenset[str] = frozenset({"operator", "canon_driver"})


class CanonProposal:
    """典藏提案（Canon Proposal）— 协议内部数据结构。

    使用普通类（不强制 Pydantic），用于在协议内部跟踪提案状态：
    ``pending`` → ``confirmed`` / ``rejected``。
    """

    def __init__(
        self,
        proposal_id: str,
        turn: Turn,
        proposer: str,
        created_at: datetime,
        status: str = "pending",  # pending / confirmed / rejected
        confirmer: str | None = None,
        rejecter: str | None = None,
        reject_reason: str | None = None,
    ) -> None:
        self.proposal_id: str = proposal_id
        self.turn: Turn = turn
        self.proposer: str = proposer
        self.created_at: datetime = created_at
        self.status: str = status
        self.confirmer: str | None = confirmer
        self.rejecter: str | None = rejecter
        self.reject_reason: str | None = reject_reason


class CanonSyncProtocolBase(ABC):
    """典藏同步协议抽象基类。

    所有 Canon Sync Protocol 实现必须继承本类并实现 ``propose_canon`` /
    ``confirm_canon`` / ``reject_canon`` 三个抽象方法。

    详见:
        - [doc:review/review.md#13.2] CL-010
    """

    @abstractmethod
    async def propose_canon(self, turn: Turn, proposer: str) -> str:
        """提议将 Turn 内容入典。返回 proposal_id。"""

    @abstractmethod
    async def confirm_canon(self, proposal_id: str, confirmer: str) -> bool:
        """确认入典。只有 operator 或 Canon Driver 有权限。"""

    @abstractmethod
    async def reject_canon(
        self,
        proposal_id: str,
        rejecter: str,
        reason: str,
    ) -> bool:
        """拒绝入典。"""


class CanonSyncProtocol(CanonSyncProtocolBase):
    """典藏同步协议（Canon Sync Protocol）— 铁律："RP 台词不自动入典"。

    Role Play 中灵智体说的话、做的事不能自动进入 Canon 记忆，必须经过
    本协议显式确认（operator 或 Canon Driver 批准）。

    实现要点:
        - ``propose_canon`` 创建 pending 提案，**不写入 CanonMemory**。
        - ``confirm_canon`` 校验 confirmer 权限（``_CANON_CONFIRMERS``），
          通过后构造 :class:`CanonDecision` 写入 CanonMemory，并标记
          SessionMemory 中 Turn 的 ``is_canon=True``。
        - ``reject_canon`` 任何人可拒绝，记录拒绝原因。
        - 重复确认 / 拒绝不存在的 proposal_id 返回 ``False``。

    详见:
        - [doc:review/review.md#13.2] CL-010
    """

    def __init__(
        self,
        canon_memory: CanonMemory,
        session_memory: SessionMemory | None = None,
        world_id: str | None = None,
    ) -> None:
        self._canon_memory: CanonMemory = canon_memory
        self._session_memory: SessionMemory | None = session_memory
        # 世界 ID（用于构造 CanonDecision；生产实现应通过 WorldLayer 查询）
        self._world_id: str | None = world_id
        # proposal_id -> CanonProposal
        self._proposals: dict[str, CanonProposal] = {}

    async def propose_canon(self, turn: Turn, proposer: str) -> str:
        """提议将 Turn 内容入典。返回 proposal_id。

        本方法**不写入 CanonMemory**——仅创建一个 pending 提案。必须再
        调用 :meth:`confirm_canon` 由 operator / canon_driver 确认后才会
        写入 CanonMemory。

        Args:
            turn: 待入典的 Turn。``turn.is_canon`` 应为 ``False``。
            proposer: 提议者（任何角色可提议，包括灵智体自身）。

        Returns:
            proposal_id（UUID 字符串）。

        Raises:
            ValueError: 当 Turn 已经是 Canon（``is_canon=True``）时。
        """
        if turn.is_canon:
            raise ValueError(
                f"Turn {turn.turn_id!r} 已经是 Canon，无需重复提议。"
                "详见 [doc:review/review.md#13.2] CL-010"
            )
        if not proposer or not proposer.strip():
            raise ValueError("proposer 不能为空。")
        proposal_id = uuid.uuid4().hex
        self._proposals[proposal_id] = CanonProposal(
            proposal_id=proposal_id,
            turn=turn,
            proposer=proposer.strip(),
            created_at=datetime.now(timezone.utc),
        )
        return proposal_id

    async def confirm_canon(self, proposal_id: str, confirmer: str) -> bool:
        """确认入典。只有 operator 或 Canon Driver 有权限。

        铁律（CL-010）：``confirmer`` 必须在 ``_CANON_CONFIRMERS`` 白名单
        中（``"operator"`` / ``"canon_driver"``）。否则拒绝确认，返回
        ``False``。

        确认成功后:
            1. 构造 :class:`CanonDecision` 写入 :class:`CanonMemory`。
            2. 若提供了 :class:`SessionMemory`，标记 Turn 的 ``is_canon=True``。
            3. 更新提案状态为 ``confirmed``。

        Args:
            proposal_id: :meth:`propose_canon` 返回的提案 ID。
            confirmer: 确认者（必须是 ``"operator"`` / ``"canon_driver"``）。

        Returns:
            ``True`` 表示确认成功；``False`` 表示权限不足或提案不存在 / 已闭环。
        """
        if confirmer not in _CANON_CONFIRMERS:
            return False
        proposal = self._proposals.get(proposal_id)
        if proposal is None or proposal.status != "pending":
            return False
        turn = proposal.turn
        decision = CanonDecision(
            decision_id=f"canon-{turn.turn_id}",
            world_id=self._resolve_world_id(turn),
            decision=turn.content,
            decided_by=confirmer,
            timestamp=datetime.now(timezone.utc),
        )
        ok = await self._canon_memory.write(decision, confirmed_by=confirmer)
        if not ok:
            return False
        if self._session_memory is not None:
            await self._session_memory.mark_turn_canon(turn.turn_id)
        proposal.status = "confirmed"
        proposal.confirmer = confirmer
        return True

    async def reject_canon(
        self,
        proposal_id: str,
        rejecter: str,
        reason: str,
    ) -> bool:
        """拒绝入典。

        任何人都可以拒绝入典（包括提议者自己撤回）。拒绝原因必填。

        Args:
            proposal_id: 提案 ID。
            rejecter: 拒绝者。
            reason: 拒绝原因（必填）。

        Returns:
            ``True`` 表示拒绝成功；``False`` 表示提案不存在 / 已闭环。
        """
        if not reason or not reason.strip():
            raise ValueError("reject reason 不能为空。")
        if not rejecter or not rejecter.strip():
            raise ValueError("rejecter 不能为空。")
        proposal = self._proposals.get(proposal_id)
        if proposal is None or proposal.status != "pending":
            return False
        proposal.status = "rejected"
        proposal.rejecter = rejecter.strip()
        proposal.reject_reason = reason.strip()
        return True

    async def get_proposal(self, proposal_id: str) -> dict[str, Any] | None:
        """获取提案状态（用于诊断 / 审计）。

        Args:
            proposal_id: 提案 ID。

        Returns:
            提案状态字典；``None`` 表示提案不存在。
        """
        p = self._proposals.get(proposal_id)
        if p is None:
            return None
        return {
            "proposal_id": p.proposal_id,
            "turn_id": p.turn.turn_id,
            "proposer": p.proposer,
            "created_at": p.created_at.isoformat(),
            "status": p.status,
            "confirmer": p.confirmer,
            "rejecter": p.rejecter,
            "reject_reason": p.reject_reason,
        }

    @staticmethod
    def get_canon_confirmers() -> frozenset[str]:
        """返回 Canon 确认权限白名单（铁律 CL-010）。

        Returns:
            ``{"operator", "canon_driver"}`` 的不可变集合。
        """
        return _CANON_CONFIRMERS

    def _resolve_world_id(self, turn: Turn) -> str:
        """解析 world_id：优先使用构造时显式传入值，否则回退到占位符推断。

        Args:
            turn: Turn 实例。

        Returns:
            world_id 字符串。
        """
        return _resolve_world_id(turn, self._world_id)


def _extract_world_id(turn: Turn) -> str:
    """从 Turn 推断 world_id（占位符实现）。

    骨架实现：Turn 本身不直接持有 world_id（通过 round → scene → world
    关联）。生产实现应通过 WorldLayer 查询。这里返回占位符，由
    :class:`CanonSyncProtocol` 的调用方在构造 decision 时覆写。

    Args:
        turn: Turn 实例。

    Returns:
        world_id 占位符。
    """
    # 骨架：返回 round_id 作为命名空间占位，避免空字符串
    return f"world-of-{turn.round_id}"


def _resolve_world_id(turn: Turn, explicit: str | None) -> str:
    """解析 world_id：优先使用显式传入值，否则回退到占位符推断。

    Args:
        turn: Turn 实例。
        explicit: 显式传入的 world_id（来自 CanonSyncProtocol 构造函数）。

    Returns:
        world_id 字符串。
    """
    if explicit and explicit.strip():
        return explicit.strip()
    return _extract_world_id(turn)


__all__ = [
    "CanonSyncProtocolBase",
    "CanonSyncProtocol",
    "CanonProposal",
]
