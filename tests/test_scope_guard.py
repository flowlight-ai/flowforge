"""Tests for Mode A — Scope Guard（v7.0 API：detect_signals + ScopeGuardSignal 枚举）。

P-14 修复：旧 API（MAGIC_WORDS / detect() / signal.signal_type）已随 v7.0
Forge Nurturing 体系重构移除，按源码现状重写为 detect_signals 的启发式信号测试。
"""

from __future__ import annotations

from flowforge.evolution.models import ScopeGuardSignal
from flowforge.evolution.scope_guard import ScopeGuard

VISION = "AI 写作助手，帮助用户撰写高质量文章"


def test_no_signal_on_clean_instruction() -> None:
    sg = ScopeGuard()
    # 复用 vision 的标点分隔片段，保证关键词重叠度 ≥0.15（不触发 NOT_SERVING_VISION）
    signals = sg.detect_signals(
        current_vision=VISION,
        new_idea="帮助用户撰写高质量文章，优化写作提示词",
        current_ac=["支持文章写作"],
    )
    assert signals == []


def test_not_serving_vision_on_low_overlap() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=VISION,
        new_idea="开发电商平台，实现购物车结算功能",
        current_ac=["支持文章写作"],
    )
    assert ScopeGuardSignal.NOT_SERVING_VISION in signals


def test_new_journey_keyword_triggers_strong_signal() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=VISION,
        new_idea="新增一个用户管理新页面",
        current_ac=["支持文章写作"],
    )
    assert ScopeGuardSignal.NEW_JOURNEY in signals


def test_new_dependency_keyword_triggers_strong_signal() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=VISION,
        new_idea="需要接入第三方支付 SDK",
        current_ac=["支持文章写作"],
    )
    assert ScopeGuardSignal.NEW_DEPENDENCY in signals


def test_unclear_verification_when_ac_empty() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=VISION,
        new_idea="帮助用户撰写高质量文章，优化写作提示词",
        current_ac=[],
    )
    assert ScopeGuardSignal.UNCLEAR_VERIFICATION in signals


def test_unclear_verification_on_vague_wording() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=VISION,
        new_idea="这个功能先这样，后面再说",
        current_ac=["支持文章写作"],
    )
    assert ScopeGuardSignal.UNCLEAR_VERIFICATION in signals


def test_remind_frequency_limited_per_phase() -> None:
    sg = ScopeGuard()
    assert sg.should_remind("feat-1") is True
    sg.log_trigger(
        feature_id="feat-1", signal_type="new_journey",
        action="remind", outcome="ok", agent="test",
    )
    assert sg.should_remind("feat-1") is True
    sg.log_trigger(
        feature_id="feat-1", signal_type="new_journey",
        action="remind", outcome="ok", agent="test",
    )
    assert sg.should_remind("feat-1") is False  # 同一 phase 最多两次提醒


def test_divergence_pattern_suggests_split_feat() -> None:
    sg = ScopeGuard()
    for _ in range(3):
        sg.log_trigger(
            feature_id="feat-2", signal_type="new_dependency",
            action="remind", outcome="ok", agent="test",
        )
    assert sg.check_divergence_pattern("feat-2") is True
    assert sg.check_divergence_pattern("feat-other") is False


def test_logs_are_recorded() -> None:
    sg = ScopeGuard()
    sg.log_trigger(
        feature_id="feat-3", signal_type="new_journey",
        action="remind", outcome="【温柔提醒】", agent="test",
    )
    logs = sg.get_log()
    assert len(logs) == 1
    assert logs[0].feature_id == "feat-3"
    assert logs[0].action_taken == "remind"


def test_reset_phase_restores_remind() -> None:
    sg = ScopeGuard()
    for _ in range(2):
        sg.log_trigger(
            feature_id="feat-4", signal_type="new_journey",
            action="remind", outcome="ok", agent="test",
        )
    assert sg.should_remind("feat-4") is False
    sg.reset_phase("feat-4")
    assert sg.should_remind("feat-4") is True
