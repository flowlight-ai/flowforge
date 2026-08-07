"""Tests for the LoopExecutor — five-step closed loop."""

from __future__ import annotations

import pytest

from flowforge.loop.executor import LoopExecutor
from flowforge.loop.reflector import Reflector
from flowforge.loop.state import LoopState
from flowforge.loop.verifier import Verifier


def _state_with_criteria() -> LoopState:
    return LoopState(
        task_brief="test task",
        scope_baseline="test",
        acceptance_criteria=["criterion_1"],
        max_iterations=3,
    )


@pytest.mark.asyncio
async def test_loop_passes_on_first_verify() -> None:
    async def action(state: LoopState) -> str:
        return "good artifact"

    # Use a verifier that always passes
    def always_pass_reviewer(artifact: str, ctx: dict) -> dict:
        return {"reviewer": "stub", "pass": True, "score": 0.95}

    state = _state_with_criteria()
    state.cvo_vision_confirmed = True
    state.attach_evidence("criterion_1", "pre-seeded")

    executor = LoopExecutor(
        action_fn=action,
        verifier=Verifier(quality_threshold=0.85, reviewer=always_pass_reviewer),
        max_iterations=3,
    )
    result = await executor.run(state)
    assert result.passed is True
    assert result.iterations == 1


@pytest.mark.asyncio
async def test_loop_terminates_on_max_iterations() -> None:
    async def action(state: LoopState) -> str:
        return "still bad"

    def always_fail_reviewer(artifact: str, ctx: dict) -> dict:
        return {"reviewer": "stub", "pass": False, "score": 0.2}

    state = _state_with_criteria()
    executor = LoopExecutor(
        action_fn=action,
        verifier=Verifier(quality_threshold=0.85, reviewer=always_fail_reviewer),
        reflector=Reflector(max_reflections=3),  # matches max_iterations
        max_iterations=3,
    )
    result = await executor.run(state)
    assert result.passed is False
    assert "max_iterations" in result.termination_reason or "reflection" in result.termination_reason


@pytest.mark.asyncio
async def test_loop_reflects_then_passes() -> None:
    call_count = {"n": 0}

    async def action(state: LoopState) -> str:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return "bad artifact"
        return "good artifact after reflection"

    def reviewer(artifact: str, ctx: dict) -> dict:
        if "good" in artifact:
            return {"reviewer": "stub", "pass": True, "score": 0.95}
        return {"reviewer": "stub", "pass": False, "score": 0.3}

    def reflector_fn(artifact: str, failure: dict) -> str:
        return "good artifact after reflection"

    state = _state_with_criteria()
    state.cvo_vision_confirmed = True
    state.attach_evidence("criterion_1", "pre-seeded")

    executor = LoopExecutor(
        action_fn=action,
        verifier=Verifier(quality_threshold=0.85, reviewer=reviewer),
        reflector=Reflector(max_reflections=3, reflector_fn=reflector_fn),
        max_iterations=3,
    )
    result = await executor.run(state)
    assert result.passed is True
    assert result.iterations == 2  # one bad, one reflected-good


@pytest.mark.asyncio
async def test_loop_terminates_when_already_done() -> None:
    """If state is already terminated, loop should not call action_fn."""
    called = {"n": 0}

    async def action(state: LoopState) -> str:
        called["n"] += 1
        return "x"

    state = _state_with_criteria()
    state.cvo_vision_confirmed = True
    state.attach_evidence("criterion_1", "pre-seeded")
    state.quality_score = 0.95
    state.reviewer_notes = [{"reviewer": "x", "pass": True}]
    state.terminated = True
    state.termination_reason = "pre-terminated"

    executor = LoopExecutor(action_fn=action, max_iterations=3)
    result = await executor.run(state)
    assert called["n"] == 0


def test_loop_state_should_terminate_requires_all_conditions() -> None:
    state = _state_with_criteria()
    state.acceptance_criteria = ["a"]
    # No evidence → should not terminate
    stop, _ = state.should_terminate()
    assert stop is False

    state.attach_evidence("a", "anchor")
    state.quality_score = 0.9
    state.reviewer_notes = [{"reviewer": "x", "pass": True}]
    state.cvo_vision_confirmed = True
    stop, reason = state.should_terminate()
    assert stop is True
    assert "all termination conditions met" in reason


def test_handoff_capsule_increments_iteration() -> None:
    from flowforge.loop.state import HandoffCapsule

    state = _state_with_criteria()
    assert state.iteration == 0
    state.push_handoff(HandoffCapsule(from_owner="a", to_owner="b"))
    assert state.iteration == 1
    assert len(state.handoff_log) == 1


# ── 快速失败机制测试 ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_loop_fast_fail_on_consecutive_refusals() -> None:
    """LLM 连续返回"无法回答"时，Loop 应提前终止，不跑完 max_iterations。"""

    async def action(state: LoopState) -> str:
        return "无法回答"

    state = _state_with_criteria()
    executor = LoopExecutor(
        action_fn=action,
        max_iterations=5,
        max_consecutive_refusals=2,
    )
    result = await executor.run(state)
    assert result.passed is False
    assert "consecutive refusals" in result.termination_reason
    # Should terminate after 2 refusals, not 5 iterations
    assert result.iterations == 2


@pytest.mark.asyncio
async def test_loop_fast_fail_on_silent_failure() -> None:
    """LLM 返回 silent failure（"当前不可用，请稍后重试"）时也应触发快速失败。"""

    async def action(state: LoopState) -> str:
        return "当前不可用，请稍后重试"

    state = _state_with_criteria()
    executor = LoopExecutor(
        action_fn=action,
        max_iterations=5,
        max_consecutive_refusals=2,
    )
    result = await executor.run(state)
    assert result.passed is False
    assert "consecutive refusals" in result.termination_reason


@pytest.mark.asyncio
async def test_loop_recovers_from_single_refusal() -> None:
    """单次拒绝后恢复正常内容时，Loop 不应终止，应继续正常流程。"""
    call_count = {"n": 0}

    async def action(state: LoopState) -> str:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return "无法回答"
        return "good artifact after recovery"

    def reviewer(artifact: str, ctx: dict) -> dict:
        if "good" in artifact:
            return {"reviewer": "stub", "pass": True, "score": 0.95}
        return {"reviewer": "stub", "pass": False, "score": 0.3}

    state = _state_with_criteria()
    state.cvo_vision_confirmed = True
    state.attach_evidence("criterion_1", "pre-seeded")

    executor = LoopExecutor(
        action_fn=action,
        verifier=Verifier(quality_threshold=0.85, reviewer=reviewer),
        max_iterations=5,
        max_consecutive_refusals=2,
    )
    result = await executor.run(state)
    assert result.passed is True
    assert "consecutive refusals" not in result.termination_reason
