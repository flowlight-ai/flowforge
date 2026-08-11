"""Tests for Mode A — Scope Guard (detect_signals API)."""

from __future__ import annotations

from flowforge.evolution.models import ScopeGuardSignal
from flowforge.evolution.scope_guard import ScopeGuard


def _vision() -> str:
    # 分词器按 [\\s,，。.;；、] 切分，取交集算重叠度 — 愿景词需用分隔符隔开
    return "内容创建，内容发布，内容审核"


def test_no_signal_on_aligned_idea() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=_vision(),
        new_idea="内容创建，内容发布 的编辑体验优化",
        current_ac=["支持富文本编辑"],
    )
    assert signals == []


def test_low_overlap_triggers_not_serving_vision() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=_vision(),
        new_idea="搭建一个电商导购站",
        current_ac=["商品推荐"],
    )
    assert ScopeGuardSignal.NOT_SERVING_VISION in signals


def test_new_journey_triggers_strong_signal() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=_vision(),
        new_idea="内容创建 与 内容发布，核心是新增一个独立的移动端新子系统",
        current_ac=["内容创建", "内容发布"],
    )
    assert ScopeGuardSignal.NEW_JOURNEY in signals


def test_new_dependency_triggers_strong_signal() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=_vision(),
        new_idea="内容发布 接入第三方外部支付服务",
        current_ac=["内容发布"],
    )
    assert ScopeGuardSignal.NEW_DEPENDENCY in signals


def test_unclear_verification_without_ac() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=_vision(),
        new_idea="再看情况 后续可能要加很多东西",
        current_ac=[],
    )
    assert ScopeGuardSignal.UNCLEAR_VERIFICATION in signals


def test_unclear_verification_ambiguous_wording() -> None:
    sg = ScopeGuard()
    signals = sg.detect_signals(
        current_vision=_vision(),
        new_idea="内容创建 到时候再看，先这样",
        current_ac=["内容创建"],
    )
    assert ScopeGuardSignal.UNCLEAR_VERIFICATION in signals


def test_remind_throttle_two_per_phase() -> None:
    sg = ScopeGuard()
    assert sg.should_remind("feat-1") is True
    sg.log_trigger(feature_id="feat-1", signal_type="not_serving_vision", action="remind", outcome="reminder-1", agent="scope_guard")
    assert sg.should_remind("feat-1") is True
    sg.log_trigger(feature_id="feat-1", signal_type="not_serving_vision", action="remind", outcome="reminder-2", agent="scope_guard")
    assert sg.should_remind("feat-1") is False


def test_divergence_pattern_after_three_triggers() -> None:
    sg = ScopeGuard()
    for _ in range(3):
        sg.log_trigger(feature_id="feat-hot", signal_type="new_journey", action="remind", outcome="ok", agent="scope_guard")
    assert sg.check_divergence_pattern("feat-hot") is True
    # reset_phase 仅清 phase 计数，check_divergence_pattern 之于 _logs 不因 reset 归零
    sg.reset_phase("feat-hot")
    assert sg.should_remind("feat-hot") is True
    assert sg.check_divergence_pattern("feat-hot") is True