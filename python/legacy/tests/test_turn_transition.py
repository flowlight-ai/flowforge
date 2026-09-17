"""FWK-06 统一状态机验收测试 — TurnTransitionEngine

验证 9 状态统一状态机的转换合法性、非法拒绝、历史记录等功能。
"""

import pytest

from flowforge.loop.turn_transition import (
    TurnState,
    TurnTransition,
    TurnTransitionEngine,
    VALID_TRANSITIONS,
)


class TestTurnStateEnum:
    """TurnState 枚举测试"""

    def test_all_nine_states_exist(self):
        expected = {
            "idle", "executing", "evaluating", "reflecting",
            "compacting", "agent_switching", "completed", "failed", "looping",
        }
        actual = {s.value for s in TurnState}
        assert actual == expected

    def test_state_is_string_enum(self):
        assert isinstance(TurnState.IDLE, str)
        assert TurnState.IDLE == "idle"


class TestValidTransitions:
    """合法状态转换表测试"""

    def test_idle_can_only_go_to_executing(self):
        assert VALID_TRANSITIONS[TurnState.IDLE] == [TurnState.EXECUTING]

    def test_executing_can_go_to_evaluating_failed_compacting(self):
        allowed = VALID_TRANSITIONS[TurnState.EXECUTING]
        assert TurnState.EVALUATING in allowed
        assert TurnState.FAILED in allowed
        assert TurnState.COMPACTING in allowed

    def test_evaluating_can_go_to_reflecting_completed_agent_switching_looping(self):
        allowed = VALID_TRANSITIONS[TurnState.EVALUATING]
        assert TurnState.REFLECTING in allowed
        assert TurnState.COMPLETED in allowed
        assert TurnState.AGENT_SWITCHING in allowed
        assert TurnState.LOOPING in allowed

    def test_completed_is_terminal(self):
        assert VALID_TRANSITIONS[TurnState.COMPLETED] == []

    def test_failed_can_retry_to_idle(self):
        assert TurnState.IDLE in VALID_TRANSITIONS[TurnState.FAILED]

    def test_looping_can_go_to_executing_or_failed(self):
        allowed = VALID_TRANSITIONS[TurnState.LOOPING]
        assert TurnState.EXECUTING in allowed
        assert TurnState.FAILED in allowed


class TestTurnTransitionEngine:
    """TurnTransitionEngine 核心功能测试"""

    def test_initial_state_is_idle(self):
        engine = TurnTransitionEngine()
        assert engine.state == TurnState.IDLE

    def test_can_transition_valid(self):
        engine = TurnTransitionEngine()
        assert engine.can_transition(TurnState.EXECUTING) is True

    def test_cannot_transition_invalid(self):
        engine = TurnTransitionEngine()
        # IDLE 不能直接跳到 COMPLETED
        assert engine.can_transition(TurnState.COMPLETED) is False

    def test_transition_success(self):
        engine = TurnTransitionEngine()
        t = engine.transition(TurnState.EXECUTING, reason="start task")
        assert t.from_state == TurnState.IDLE
        assert t.to_state == TurnState.EXECUTING
        assert t.reason == "start task"
        assert t.timestamp > 0

    def test_transition_updates_state(self):
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING)
        assert engine.state == TurnState.EXECUTING

    def test_transition_invalid_raises(self):
        engine = TurnTransitionEngine()
        with pytest.raises(ValueError, match="Invalid transition"):
            engine.transition(TurnState.COMPLETED)

    def test_try_transition_valid(self):
        engine = TurnTransitionEngine()
        result = engine.try_transition(TurnState.EXECUTING, reason="start")
        assert result is not None
        assert result.to_state == TurnState.EXECUTING

    def test_try_transition_invalid_returns_none(self):
        engine = TurnTransitionEngine()
        result = engine.try_transition(TurnState.COMPLETED)
        assert result is None
        # 状态应保持不变
        assert engine.state == TurnState.IDLE

    def test_history_recorded(self):
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.EVALUATING, reason="done")
        assert len(engine.history) == 2
        assert engine.history[0].from_state == TurnState.IDLE
        assert engine.history[1].from_state == TurnState.EXECUTING

    def test_history_is_copy(self):
        """history 属性返回副本，外部修改不影响内部"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING)
        h = engine.history
        h.clear()
        assert len(engine.history) == 1

    def test_reset(self):
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING)
        engine.transition(TurnState.EVALUATING)
        engine.reset()
        assert engine.state == TurnState.IDLE
        assert len(engine.history) == 0

    def test_get_transition_count(self):
        engine = TurnTransitionEngine()
        assert engine.get_transition_count() == 0
        engine.transition(TurnState.EXECUTING)
        assert engine.get_transition_count() == 1

    def test_get_last_transition(self):
        engine = TurnTransitionEngine()
        assert engine.get_last_transition() is None
        engine.transition(TurnState.EXECUTING, reason="start")
        last = engine.get_last_transition()
        assert last is not None
        assert last.reason == "start"


class TestFullTransitionPaths:
    """完整状态转换路径测试"""

    def test_happy_path_idle_to_completed(self):
        """正常完成路径：IDLE → EXECUTING → EVALUATING → COMPLETED"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.EVALUATING, reason="execution done")
        engine.transition(TurnState.COMPLETED, reason="quality passed")
        assert engine.state == TurnState.COMPLETED
        assert engine.get_transition_count() == 3

    def test_reflect_and_retry_path(self):
        """复盘重试路径：IDLE → EXECUTING → EVALUATING → REFLECTING → EXECUTING"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.EVALUATING, reason="execution done")
        engine.transition(TurnState.REFLECTING, reason="quality failed")
        engine.transition(TurnState.EXECUTING, reason="retry after reflection")
        assert engine.state == TurnState.EXECUTING

    def test_compacting_path(self):
        """压缩路径：EXECUTING → COMPACTING → EXECUTING"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.COMPACTING, reason="context too long")
        engine.transition(TurnState.EXECUTING, reason="resumed after compacting")
        assert engine.state == TurnState.EXECUTING

    def test_agent_switching_path(self):
        """Agent切换路径：EVALUATING → AGENT_SWITCHING → EXECUTING"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.EVALUATING, reason="done")
        engine.transition(TurnState.AGENT_SWITCHING, reason="need different agent")
        engine.transition(TurnState.EXECUTING, reason="new agent executing")
        assert engine.state == TurnState.EXECUTING

    def test_looping_path(self):
        """循环路径：EVALUATING → LOOPING → EXECUTING"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.EVALUATING, reason="done")
        engine.transition(TurnState.LOOPING, reason="need another iteration")
        engine.transition(TurnState.EXECUTING, reason="loop iteration")
        assert engine.state == TurnState.EXECUTING

    def test_failure_and_retry_path(self):
        """失败重试路径：EXECUTING → FAILED → IDLE → EXECUTING"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.FAILED, reason="unrecoverable error")
        engine.transition(TurnState.IDLE, reason="retry from scratch")
        engine.transition(TurnState.EXECUTING, reason="restart")
        assert engine.state == TurnState.EXECUTING

    def test_reflect_to_compact_path(self):
        """复盘后压缩路径：REFLECTING → COMPACTING → AGENT_SWITCHING → EXECUTING"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING, reason="start")
        engine.transition(TurnState.EVALUATING, reason="done")
        engine.transition(TurnState.REFLECTING, reason="quality failed")
        engine.transition(TurnState.COMPACTING, reason="context overflow")
        engine.transition(TurnState.AGENT_SWITCHING, reason="switch agent")
        engine.transition(TurnState.EXECUTING, reason="new agent executing")
        assert engine.state == TurnState.EXECUTING


class TestInvalidTransitions:
    """非法状态转换拒绝测试"""

    def test_idle_to_completed_rejected(self):
        engine = TurnTransitionEngine()
        assert engine.can_transition(TurnState.COMPLETED) is False

    def test_idle_to_reflecting_rejected(self):
        engine = TurnTransitionEngine()
        assert engine.can_transition(TurnState.REFLECTING) is False

    def test_completed_to_any_rejected(self):
        """COMPLETED 是终态，不能转换到任何状态"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING)
        engine.transition(TurnState.EVALUATING)
        engine.transition(TurnState.COMPLETED)
        for state in TurnState:
            assert engine.can_transition(state) is False

    def test_failed_to_executing_rejected(self):
        """FAILED 不能直接到 EXECUTING，必须先回到 IDLE"""
        engine = TurnTransitionEngine()
        engine.transition(TurnState.EXECUTING)
        engine.transition(TurnState.FAILED)
        assert engine.can_transition(TurnState.EXECUTING) is False
        assert engine.can_transition(TurnState.IDLE) is True
