"""Attribution matrix — classify failures into one of seven layers.

The seven attribution types (F020 / task.md P1-5):
- INTENTION — 意图层 (目标设定错误)
- PLAN      — 计划层 (规划错误)
- TOOL      — 工具层 (工具调用错误)
- KNOWLEDGE — 知识层 (事实性错误)
- EXECUTION — 执行层 (操作错误, e.g. timeout)
- CONTEXT   — 上下文层 (信息缺失)
- LUCK      — 运气层 (不可控因素, fallback)

Classification is keyword-based and deterministic (no LLM). The concatenated
failure text is matched against ordered rules; the first matching rule wins.
Rules with no match fall back to LUCK.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.attribution")


class AttributionType(Enum):
    """The seven failure-attribution layers."""

    INTENTION = "intention"
    PLAN = "plan"
    TOOL = "tool"
    KNOWLEDGE = "knowledge"
    EXECUTION = "execution"
    CONTEXT = "context"
    LUCK = "luck"


@dataclass(frozen=True)
class FailureDescription:
    """Structured description of a failure to be classified."""

    what_failed: str
    expected: str
    actual: str
    context: str
    error_trace: str = ""


@dataclass(frozen=True)
class AttributionRule:
    """A keyword-to-type mapping used by AttributionMatrix.classify()."""

    keywords: list[str]
    type: AttributionType


# Ordered default rules — earlier rules take priority on overlap.
# EXECUTION (timeout/deadline) is checked first because a timeout often
# co-occurs with other symptoms but is usually the root cause.
DEFAULT_ATTRIBUTION_RULES: list[AttributionRule] = [
    AttributionRule(
        keywords=[
            "timeout",
            "timed out",
            "deadline",
            "expired",
            "latency",
        ],
        type=AttributionType.EXECUTION,
    ),
    AttributionRule(
        keywords=[
            "wrong fact",
            "wrong",
            "incorrect",
            "hallucination",
            "hallucinate",
            "false fact",
            "inaccurate",
        ],
        type=AttributionType.KNOWLEDGE,
    ),
    AttributionRule(
        keywords=[
            "missing input",
            "missing context",
            "no context",
            "missing data",
            "not provided",
            "absent input",
        ],
        type=AttributionType.CONTEXT,
    ),
    AttributionRule(
        keywords=[
            "tool",
            "api",
            "function call",
            "tool call",
            "instrument",
            "sdk",
        ],
        type=AttributionType.TOOL,
    ),
    AttributionRule(
        keywords=[
            "plan",
            "step",
            "sequence",
            "workflow",
            "ordering",
        ],
        type=AttributionType.PLAN,
    ),
    AttributionRule(
        keywords=[
            "goal",
            "intent",
            "objective",
            "aim",
            "target",
        ],
        type=AttributionType.INTENTION,
    ),
]


class AttributionMatrix:
    """Classify failures into the seven attribution layers.

    Pass custom `rules` (e.g. loaded from YAML) to override the defaults; pass
    an empty list to force LUCK for everything (rarely useful outside tests).
    """

    def __init__(self, rules: list[AttributionRule] | None = None) -> None:
        self._rules: list[AttributionRule] = (
            list(rules) if rules is not None else list(DEFAULT_ATTRIBUTION_RULES)
        )

    def classify(self, failure: FailureDescription) -> AttributionType:
        """Return the AttributionType for a single failure."""
        text = " ".join(
            [
                failure.what_failed,
                failure.expected,
                failure.actual,
                failure.context,
                failure.error_trace,
            ]
        ).lower()
        for rule in self._rules:
            for kw in rule.keywords:
                if kw.lower() in text:
                    logger.debug(
                        f"attribution matched: keyword={kw!r} type={rule.type.value}"
                    )
                    return rule.type
        logger.debug("attribution: no keyword matched, fallback to LUCK")
        return AttributionType.LUCK

    def get_distribution(
        self, failures: list[FailureDescription]
    ) -> dict[AttributionType, int]:
        """Count how many failures fall into each attribution layer."""
        distribution: dict[AttributionType, int] = {}
        for failure in failures:
            attr_type = self.classify(failure)
            distribution[attr_type] = distribution.get(attr_type, 0) + 1
        # Build the human-readable view outside the f-string so the colon inside
        # the dict comprehension never collides with the f-string format spec
        # (keeps the line valid on Python 3.11, not just 3.12+).
        distribution_view = {t.value: c for t, c in distribution.items()}
        logger.info(
            f"attribution distribution over {len(failures)} failures: {distribution_view}"
        )
        return distribution
