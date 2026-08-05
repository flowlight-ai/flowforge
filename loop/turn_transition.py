"""统一状态机 — TurnKind+LoopPhase 合并的 9 状态模型。

将 TurnKind（对话轮次类型）和 LoopPhase（循环阶段）合并为统一的 TurnState，
消除两套状态体系的歧义，提供单一状态转换引擎。

状态流转：
IDLE → EXECUTING → EVALUATING → REFLECTING → COMPACTING → AGENT_SWITCHING
     → COMPLETED / FAILED / LOOPING
"""

import time
from enum import Enum

from pydantic import BaseModel

from flowforge.core.tracing import get_logger

logger = get_logger("loop.turn_transition")


class TurnState(str, Enum):
    """统一状态枚举 — 9 状态模型"""

    IDLE = "idle"
    EXECUTING = "executing"
    EVALUATING = "evaluating"
    REFLECTING = "reflecting"
    COMPACTING = "compacting"
    AGENT_SWITCHING = "agent_switching"
    COMPLETED = "completed"
    FAILED = "failed"
    LOOPING = "looping"


class TurnTransition(BaseModel):
    """状态转换记录"""

    from_state: TurnState
    to_state: TurnState
    reason: str = ""
    timestamp: float = 0.0


# 合法状态转换表
VALID_TRANSITIONS: dict[TurnState, list[TurnState]] = {
    TurnState.IDLE: [TurnState.EXECUTING],
    TurnState.EXECUTING: [TurnState.EVALUATING, TurnState.FAILED, TurnState.COMPACTING],
    TurnState.EVALUATING: [
        TurnState.REFLECTING,
        TurnState.COMPLETED,
        TurnState.AGENT_SWITCHING,
        TurnState.LOOPING,
    ],
    TurnState.REFLECTING: [TurnState.EXECUTING, TurnState.COMPACTING, TurnState.FAILED],
    TurnState.COMPACTING: [TurnState.EXECUTING, TurnState.AGENT_SWITCHING],
    TurnState.AGENT_SWITCHING: [TurnState.EXECUTING],
    TurnState.LOOPING: [TurnState.EXECUTING, TurnState.FAILED],
    TurnState.COMPLETED: [],
    TurnState.FAILED: [TurnState.IDLE],  # 允许重试
}


class TurnTransitionEngine:
    """状态转换引擎 — 管理统一状态机的转换逻辑。

    用法：
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start task")
        engine.transition(TurnState.EVALUATING, reason="execution done")
    """

    def __init__(self) -> None:
        self._state = TurnState.IDLE
        self._history: list[TurnTransition] = []

    @property
    def state(self) -> TurnState:
        return self._state

    @property
    def history(self) -> list[TurnTransition]:
        return list(self._history)

    def can_transition(self, to_state: TurnState) -> bool:
        """检查当前状态是否可以转换到目标状态"""
        return to_state in VALID_TRANSITIONS.get(self._state, [])

    def transition(self, to_state: TurnState, reason: str = "") -> TurnTransition:
        """执行状态转换

        Args:
            to_state: 目标状态。
            reason: 转换原因。

        Returns:
            TurnTransition 转换记录。

        Raises:
            ValueError: 非法状态转换。
        """
        if not self.can_transition(to_state):
            raise ValueError(
                f"Invalid transition: {self._state.value} -> {to_state.value}"
            )
        transition = TurnTransition(
            from_state=self._state,
            to_state=to_state,
            reason=reason,
            timestamp=time.time(),
        )
        self._history.append(transition)
        logger.info(
            f"[turn] State transition: {self._state.value} -> {to_state.value}"
            f"{f' ({reason})' if reason else ''}"
        )
        self._state = to_state
        return transition

    def try_transition(self, to_state: TurnState, reason: str = "") -> TurnTransition | None:
        """尝试状态转换，如果非法则返回 None 而非抛异常

        Args:
            to_state: 目标状态。
            reason: 转换原因。

        Returns:
            TurnTransition 转换记录，非法转换时返回 None。
        """
        if not self.can_transition(to_state):
            logger.warning(
                f"[turn] Invalid transition attempt: {self._state.value} -> {to_state.value}"
            )
            return None
        return self.transition(to_state, reason=reason)

    def reset(self) -> None:
        """重置状态机到初始状态"""
        self._state = TurnState.IDLE
        self._history.clear()

    def get_transition_count(self) -> int:
        """获取已执行的转换次数"""
        return len(self._history)

    def get_last_transition(self) -> TurnTransition | None:
        """获取最后一次转换记录"""
        return self._history[-1] if self._history else None
