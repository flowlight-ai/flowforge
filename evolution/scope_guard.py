"""Mode A: Scope Guard — defensive mode, prevents scope drift.

Triggers (any):
1. CVO instruction contains magic words (第一性原理 / 我能猜出来 / 下次一定 / 星星罐子)
2. Action description drifts beyond scope_baseline
3. Same kind of deviation appears ≥ N times within window
4. High-risk domain action taken without explicit authorization

Actions (escalation ladder):
- info → log only
- warn → log + notify CVO
- block → log + abort current step
- magic_word_triggered → log + immediate halt + force signoff
"""

from __future__ import annotations

import uuid
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Literal

from flowforge.core.tracing import get_logger
from flowforge.evolution.models import ScopeGuardLog, ScopeGuardSignal

logger = get_logger("flowforge.evolution.scope_guard")

# Default thresholds (overridable via evolution.yaml)
DEFAULT_FREQUENCY_WINDOW_MINUTES = 60
DEFAULT_FREQUENCY_THRESHOLD = 3
DEFAULT_DEVIATION_KEYWORDS = (
    "无关",
    "超出范围",
    "顺便",
    "既然",
    "扩展",
)

MAGIC_WORDS = ("第一性原理", "我能猜出来", "下次一定", "星星罐子")


class ScopeGuard:
    """Mode A — scope deviation detector + log writer."""

    def __init__(
        self,
        scope_baseline: str,
        frequency_window_minutes: int = DEFAULT_FREQUENCY_WINDOW_MINUTES,
        frequency_threshold: int = DEFAULT_FREQUENCY_THRESHOLD,
        deviation_keywords: tuple[str, ...] = DEFAULT_DEVIATION_KEYWORDS,
        magic_words: tuple[str, ...] = MAGIC_WORDS,
    ) -> None:
        self.scope_baseline = scope_baseline
        self.frequency_window = timedelta(minutes=frequency_window_minutes)
        self.frequency_threshold = frequency_threshold
        self.deviation_keywords = deviation_keywords
        self.magic_words = magic_words
        self._recent_signals: deque[tuple[datetime, str]] = deque(maxlen=100)
        self._logs: list[ScopeGuardLog] = []

    def detect(
        self,
        instruction: str,
        action_description: str,
        is_high_risk: bool = False,
        authorized: bool = True,
    ) -> ScopeGuardSignal | None:
        """Inspect one instruction + action pair. Returns signal or None."""
        # 1. Magic words (only trigger on current instruction, not historical quotes)
        for word in self.magic_words:
            if word in instruction:
                signal = ScopeGuardSignal(
                    signal_id=f"sg-{uuid.uuid4().hex[:12]}",
                    signal_type="magic_word",
                    scope_baseline=self.scope_baseline,
                    actual_behavior=instruction,
                    evidence=[f"instruction contains magic word: {word}"],
                    severity="block",
                    magic_word=word,
                )
                self._record(signal, action_taken="magic_word_triggered")
                return signal

        # 2. Deviation keywords
        for kw in self.deviation_keywords:
            if kw in action_description:
                signal = ScopeGuardSignal(
                    signal_id=f"sg-{uuid.uuid4().hex[:12]}",
                    signal_type="scope_creep",
                    scope_baseline=self.scope_baseline,
                    actual_behavior=action_description,
                    evidence=[f"action description contains deviation keyword: {kw}"],
                    severity="warn",
                )
                self._record(signal, action_taken="logged")
                return signal

        # 3. Frequency breach
        self._recent_signals.append((datetime.now(UTC), action_description))
        if self._count_recent() >= self.frequency_threshold:
            signal = ScopeGuardSignal(
                signal_id=f"sg-{uuid.uuid4().hex[:12]}",
                signal_type="frequency_breach",
                scope_baseline=self.scope_baseline,
                actual_behavior=action_description,
                evidence=[
                    f"≥{self.frequency_threshold} signals within "
                    f"{self.frequency_window.total_seconds()/60:.0f} min"
                ],
                severity="warn",
            )
            self._record(signal, action_taken="escalated")
            return signal

        # 4. High-risk action without authorization
        if is_high_risk and not authorized:
            signal = ScopeGuardSignal(
                signal_id=f"sg-{uuid.uuid4().hex[:12]}",
                signal_type="high_risk_unauthorized",
                scope_baseline=self.scope_baseline,
                actual_behavior=action_description,
                evidence=["high_risk=True but authorized=False"],
                severity="block",
            )
            self._record(signal, action_taken="blocked")
            return signal

        return None

    def _count_recent(self) -> int:
        cutoff = datetime.now(UTC) - self.frequency_window
        while self._recent_signals and self._recent_signals[0][0] < cutoff:
            self._recent_signals.popleft()
        return len(self._recent_signals)

    def _record(
        self,
        signal: ScopeGuardSignal,
        action_taken: Literal["logged", "escalated", "blocked", "magic_word_triggered"],
    ) -> ScopeGuardLog:
        log = ScopeGuardLog(
            log_id=f"sl-{uuid.uuid4().hex[:12]}",
            signal=signal,
            action_taken=action_taken,
        )
        self._logs.append(log)
        logger.warning(
            f"scope_guard signal: type={signal.signal_type} severity={signal.severity} "
            f"action={action_taken}"
        )
        return log

    def get_logs(self) -> list[ScopeGuardLog]:
        return list(self._logs)

    def reset(self) -> None:
        self._recent_signals.clear()
        self._logs.clear()
