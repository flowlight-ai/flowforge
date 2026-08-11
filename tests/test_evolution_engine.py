"""Tests for the ForgeMindEngine — closed-loop evaluate + execute（v7.0 dict API）。

P-14 修复：旧 API（EvolutionContext / decision.mode / decision.scope_signal 等）
已随 v7.0 Forge Nurturing 体系重构移除，按源码现状重写为
evaluate(context: dict) -> dict / execute(action: dict) -> dict 的断言。
"""

from __future__ import annotations

import pytest

from flowforge.evolution.engine import ForgeMindEngine

VISION = "AI 写作助手，帮助用户撰写高质量文章"


@pytest.fixture
def engine() -> ForgeMindEngine:
    return ForgeMindEngine()


@pytest.mark.asyncio
async def test_no_trigger_returns_empty_actions(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({"mode": "auto"})
    assert result["suggested_actions"] == []
    assert result["meta"]["mode"] == "auto"
    assert result["meta"]["actions_count"] == 0


@pytest.mark.asyncio
async def test_scope_guard_strong_signal_triggers_remind(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({
        "mode": "scope_guard",
        "scope_guard": {
            "current_vision": VISION,
            "new_idea": "新增一个用户管理新页面",
            "current_ac": ["支持文章写作"],
            "feature_id": "feat-1",
        },
    })
    actions = result["suggested_actions"]
    assert any(a["mode"] == "scope_guard" and a["action"] == "remind" for a in actions)


@pytest.mark.asyncio
async def test_repeated_error_triggers_process_evolution(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({
        "mode": "process_evolution",
        "process_evolution": {"error_history": [{"err": "x"}, {"err": "x"}]},
    })
    actions = result["suggested_actions"]
    assert any(
        a["mode"] == "process_evolution" and a["action"] == "create_proposal"
        for a in actions
    )


@pytest.mark.asyncio
async def test_knowledge_signal_triggers_episode_card(engine: ForgeMindEngine) -> None:
    result = await engine.evaluate({
        "mode": "knowledge_evolution",
        "knowledge_evolution": {
            "reusability": True,
            "non_obviousness": True,
            "decay_risk": True,
        },
    })
    actions = result["suggested_actions"]
    assert any(
        a["mode"] == "knowledge_evolution" and a["action"] == "create_episode_card"
        for a in actions
    )


@pytest.mark.asyncio
async def test_execute_scope_guard_remind(engine: ForgeMindEngine) -> None:
    record = await engine.execute({
        "mode": "scope_guard",
        "action": "remind",
        "payload": {
            "feature_id": "feat-1",
            "signals": ["new_journey"],
            "vision": VISION,
            "new_direction": "新增用户管理页面",
        },
    })
    assert record["status"] == "ok"
    assert "reminder" in record
    assert "温柔提醒" in record["reminder"]


@pytest.mark.asyncio
async def test_execute_process_evolution_creates_proposal(engine: ForgeMindEngine) -> None:
    record = await engine.execute({
        "mode": "process_evolution",
        "action": "create_proposal",
        "payload": {
            "trigger_type": "repeated_error",
            "trigger": "同类错误重复出现",
            "evidence": ["err-1", "err-2"],
            "root_cause": "缺少 SOP 指引",
            "lever": "memory",
            "verify": "连续 5 次无同类错误",
        },
    })
    assert record["status"] == "ok"
    assert record["proposal_id"].startswith("pe-")


@pytest.mark.asyncio
async def test_execute_unknown_mode_returns_error(engine: ForgeMindEngine) -> None:
    record = await engine.execute({"mode": "unknown", "action": "x", "payload": {}})
    assert record["status"] == "error"


@pytest.mark.asyncio
async def test_high_risk_uses_wilson_lower_bound(engine: ForgeMindEngine) -> None:
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
    route = result["meta"]["metacognition_route"]
    assert isinstance(route, dict)
    # Wilson 下界压制自报高置信度（1/5 成功 → action_confidence < 0.85）
    assert route["action_confidence"] < 0.85
    assert route["route"] == "escalate"
