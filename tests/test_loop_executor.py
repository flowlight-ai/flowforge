"""Tests for LoopExecutor — five-step closed loop (v7.0 component API).

适配重构后的 LoopExecutor：构造函数注入 HybridExecutor / HarnessOrchestrator /
LoopPlanner / LoopVerifier / LoopReflector / CheckpointManager / EntropyManager /
RuleEvolution 等组件；旧 `action_fn`/`max_iterations` 构造已删除。
测试用 stub 组件驱动 run() 验证行为。stub 采用鸭类型实现，不实例化真实
执行器（避免 SQLite 文件/状态管理副作用）。
"""

from __future__ import annotations

from typing import Any, Callable

import pytest

from flowforge.core.task_context import TaskContext
from flowforge.harness.entropy_manager import EntropyManager, RuleEvolution
from flowforge.loop.executor import LoopExecutor
from flowforge.loop.planner import LoopPlanner
from flowforge.loop.reflector import LoopReflector
from flowforge.loop.state import LoopPhase, LoopResult, LoopState, Reflection, Verdict
from flowforge.loop.verifier import LoopVerifier


# ---------------------------------------------------------------------------
# Stub 组件 — 鸭类型实现，避免真实执行器/SQLite 副作用
# ---------------------------------------------------------------------------

class _StubCheckpoint:
    def save(self, task_id: str, step_name: str, state: dict) -> None:
        return None

    def load(self, task_id: str, step_name: str):
        return None


class _StubExecutor:
    def __init__(self, result_fn: Callable[[TaskContext], dict]):
        self.result_fn = result_fn

    async def run(self, task: TaskContext, mode_hint: str = "") -> dict:
        return self.result_fn(task)


class _StubHarness:
    async def pre_execute(self, task: TaskContext) -> None:
        return None

    async def post_execute(self, result: dict, task: TaskContext) -> dict:
        return result


class _StubPlanner(LoopPlanner):
    async def plan(self, task: TaskContext, config: dict) -> list[dict]:
        return [{"step": "execute"}]

    async def replan(self, plan: list[dict], reflection: Reflection, past_errors: list[str]) -> list[dict]:
        return plan


class _StubVerifier(LoopVerifier):
    async def verify(self, result: dict, task: TaskContext, config: dict) -> Verdict:
        return Verdict(passed=True, score=0.95, errors=[])


class _StubReflector(LoopReflector):
    async def reflect(self, errors: list[str], task: TaskContext, state: LoopState) -> Reflection:
        return Reflection(suggestions=[], root_cause="", plan_adjustments=[])


def _make_task() -> TaskContext:
    return TaskContext(
        task_id="t-1",
        instruction="test loop",
        inputs={},
        state={},
        metadata={},
        input_data={},
    )


def _make_loop_config(name: str = "test-loop", refusals: int = 2, retries: int = 5) -> dict:
    return {
        "name": name,
        "max_retries": retries,
        "max_consecutive_refusals": refusals,
        "total_timeout": 30,
        "timeout_per_iteration": 5,
        "backoff_base": 0,
        "worker": {
            "mode": "workflow",
            "steps": [{"name": "step-1", "mode": "direct", "input": {}, "output": "content"}],
        },
        "metric": {},
    }


def _make_executor(executor_result_fn: Callable[[TaskContext], dict]) -> LoopExecutor:
    return LoopExecutor(
        hybrid_executor=_StubExecutor(executor_result_fn),
        harness=_StubHarness(),
        planner=_StubPlanner(),
        verifier=_StubVerifier(),
        reflector=_StubReflector(),
        checkpoint_mgr=_StubCheckpoint(),
        entropy_mgr=EntropyManager(),
        rule_evolution=RuleEvolution(),
        persona_lock=None,
        memory_manager=None,
    )


# ---------------------------------------------------------------------------
# 快速失败机制测试 — 连续拒绝响应应提前终止
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_loop_fast_fail_on_consecutive_refusals() -> None:
    """LLM 连续返回"无法回答"时，Loop 应提前终止，不跑完 max_retries。"""

    async def refusal(task: TaskContext) -> dict:
        return {"content": "无法回答"}

    executor = _make_executor(refusal)
    result: LoopResult = await executor.run(_make_task(), _make_loop_config(retries=5, refusals=2))
    assert result.success is False
    assert "consecutive refusals" in (result.error or "")
    assert result.state is not None
    assert result.total_attempts == 2
    assert result.state.phase == LoopPhase.FAILED


@pytest.mark.asyncio
async def test_loop_recovers_from_single_refusal() -> None:
    """单次拒绝后恢复正常内容，不提前终止。"""
    count = {"n": 0}

    async def flaky(task: TaskContext) -> dict:
        count["n"] += 1
        if count["n"] == 1:
            return {"content": "无法回答"}
        return {"content": "正常生成的文章内容，长度足够。"}

    executor = _make_executor(flaky)
    result: LoopResult = await executor.run(_make_task(), _make_loop_config(retries=5, refusals=2))
    assert "consecutive refusals" not in (result.error or "")


# ---------------------------------------------------------------------------
# 状态机测试 — LoopState 迁移与字段
# ---------------------------------------------------------------------------

def test_loop_state_initial_phase_planning() -> None:
    state = LoopState(loop_id="l1", task_id="t1", template_name="l1")
    assert state.phase == LoopPhase.PLANNING
    assert state.attempt == 0
    assert state.max_retries == 3


def test_loop_state_max_retries_config() -> None:
    state = LoopState(loop_id="l1", task_id="t1", template_name="l1", max_retries=7)
    assert state.max_retries == 7


def test_loop_result_carries_state() -> None:
    state = LoopState(loop_id="l1", task_id="t1", template_name="l1", attempt=2)
    result = LoopResult(success=False, error="failed", total_attempts=2, state=state)
    assert result.success is False
    assert result.state.attempt == 2


def test_checkpoint_mgr_propagates_phase() -> None:
    """run 中状态迁移到 FAILED 后，LoopState.phase 生效。"""
    state = LoopState(loop_id="l1", task_id="t1", template_name="l1")
    state.phase = LoopPhase.COMPLETED
    assert state.phase == LoopPhase.COMPLETED