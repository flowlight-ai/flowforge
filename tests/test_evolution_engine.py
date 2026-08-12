"""Tests for the ForgeMindEngine — evaluate(context: dict) + execute(action: dict).

适配重构后的 v7.0 API：`EvolutionContext`/Decision 对象已移除，
evaluate 接收 dict 上下文、返回 dict（suggested_actions + meta）。
"""

from __future__ import annotations

import pytest

from flowforge.evolution.engine import ForgeMindEngine


@pytest.fixture
def engine() -> ForgeMindEngine:
    return ForgeMindEngine()


def _sg_ctx(new_idea: str, ac: list[str], feature_id: str = "f1") -> dict:
    return {
        "mode": "scope_guard",
        "scope_guard": {
            "current_vision": "内容创建，内容发布",
            "new_idea": new_idea,
            "current_ac": ac,
            "feature_id": feature_id,
        },
    }


@pytest.mark.asyncio
async def test_auto_empty_context_no_actions(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({"mode": "auto"})
    assert result["suggested_actions"] == []
    assert result["meta"]["mode"] == "auto"
    assert "evaluated_at" in result["meta"]


@pytest.mark.asyncio
async def test_scope_guard_trigger_remind(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate(_sg_ctx(
        new_idea="内容创建，新增移动端新子系统",
        ac=["内容创建"],
    ))
    actions = result["suggested_actions"]
    assert len(actions) == 1
    assert actions[0]["mode"] == "scope_guard"
    assert actions[0]["action"] == "remind"


@pytest.mark.asyncio
async def test_scope_guard_no_signal_returns_no_action(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate(_sg_ctx(
        new_idea="内容创建，内容发布 的编辑体验优化",
        ac=["内容创建"],
    ))
    scope_actions = [a for a in result["suggested_actions"] if a["mode"] == "scope_guard"]
    assert scope_actions == []


@pytest.mark.asyncio
async def test_repeated_error_triggers_process_evolution(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({
        "mode": "process_evolution",
        "process_evolution": {
            "error_history": [{"err": "x"}, {"err": "x"}],
        },
    })
    actions = result["suggested_actions"]
    assert len(actions) == 1
    assert actions[0]["mode"] == "process_evolution"
    assert actions[0]["action"] == "create_proposal"


@pytest.mark.asyncio
async def test_knowledge_signal_triggers_episode_card(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({
        "mode": "knowledge_evolution",
        "knowledge_evolution": {
            "reusability": True,
            "non_obviousness": True,
            "decay_risk": True,
            "episode_data": {"task_snapshot": "deep research"},
        },
    })
    actions = result["suggested_actions"]
    assert len(actions) == 1
    assert actions[0]["mode"] == "knowledge_evolution"
    assert actions[0]["action"] == "create_episode_card"


@pytest.mark.asyncio
async def test_execute_scope_guard_remind(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate(_sg_ctx(
        new_idea="内容创建，新增移动端新子系统",
        ac=["内容创建"],
    ))
    action = result["suggested_actions"][0]
    executed = await engine.execute(action)
    assert executed["status"] == "ok"
    assert "reminder" in executed
    # 执行记录进日志区
    logs = engine.scope_guard.get_log()
    assert len(logs) == 1
    assert logs[0].feature_id == "f1"


@pytest.mark.asyncio
async def test_high_risk_uses_wilson_route(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({
        "mode": "auto",
        "metacognition": {
            "successes": 1,
            "trials": 5,
            "is_high_risk": True,
            "evidence_completeness": 0.5,
            "self_reported": 0.95,
        },
    })
    meta_route = result["meta"]["metacognition_route"]
    assert meta_route is not None
    assert isinstance(meta_route, dict)