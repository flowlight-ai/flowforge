"""Tests for Mode A — Scope Guard."""

from __future__ import annotations

from flowforge.evolution.scope_guard import MAGIC_WORDS, ScopeGuard


def test_no_signal_on_clean_instruction() -> None:
    sg = ScopeGuard(scope_baseline="test")
    sig = sg.detect(instruction="proceed", action_description="normal work")
    assert sig is None


def test_magic_word_triggers_block_signal() -> None:
    sg = ScopeGuard(scope_baseline="test")
    sig = sg.detect(instruction="请你按第一性原理重新思考", action_description="planning")
    assert sig is not None
    assert sig.signal_type == "magic_word"
    assert sig.severity == "block"
    assert sig.magic_word == "第一性原理"


def test_all_magic_words_trigger() -> None:
    sg = ScopeGuard(scope_baseline="test")
    for word in MAGIC_WORDS:
        sg.reset()
        sig = sg.detect(instruction=f"用{word}重新考虑", action_description="planning")
        assert sig is not None, f"magic word {word!r} did not trigger"
        assert sig.signal_type == "magic_word"


def test_deviation_keyword_triggers_warn() -> None:
    sg = ScopeGuard(scope_baseline="test")
    sig = sg.detect(instruction="proceed", action_description="顺便加点无关功能")
    assert sig is not None
    assert sig.signal_type == "scope_creep"
    assert sig.severity == "warn"


def test_high_risk_unauthorized_blocked() -> None:
    sg = ScopeGuard(scope_baseline="test")
    sig = sg.detect(
        instruction="proceed",
        action_description="deploy to production",
        is_high_risk=True,
        authorized=False,
    )
    assert sig is not None
    assert sig.signal_type == "high_risk_unauthorized"
    assert sig.severity == "block"


def test_high_risk_authorized_ok() -> None:
    sg = ScopeGuard(scope_baseline="test")
    sig = sg.detect(
        instruction="proceed",
        action_description="deploy to production",
        is_high_risk=True,
        authorized=True,
    )
    assert sig is None


def test_frequency_breach_after_threshold() -> None:
    sg = ScopeGuard(scope_baseline="test", frequency_threshold=3, frequency_window_minutes=60)
    # First two clean calls should not breach
    assert sg.detect(instruction="ok", action_description="a1") is None
    assert sg.detect(instruction="ok", action_description="a2") is None
    # Third call breaches
    sig = sg.detect(instruction="ok", action_description="a3")
    assert sig is not None
    assert sig.signal_type == "frequency_breach"


def test_logs_are_recorded() -> None:
    sg = ScopeGuard(scope_baseline="test")
    sg.detect(instruction="第一性原理", action_description="x")
    logs = sg.get_logs()
    assert len(logs) == 1
    assert logs[0].action_taken == "magic_word_triggered"
