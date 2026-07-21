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
