"""Eval Contract — the five questions every harness component must answer.

The five questions (F018 / task.md P1-5):
1. what_was_promised   — 承诺了什么
2. what_was_delivered  — 实际交付了什么
3. what_evidence_exists — 有什么证据
4. what_quality_bar    — 质量门槛 (default 0.85)
5. what_attribution    — 归因到哪一层 (one of the seven attribution types)

The runner is deterministic and does NOT call an LLM. Delivery is scored via
token-overlap (Jaccard) between promised and delivered, and evidence is scored
by count (≥2 sources = full score, matching the "evidence ≥2 sources"
guardrail used elsewhere in flowforge). Missing evidence forces a fail
regardless of the delivery score.
"""

from __future__ import annotations

from dataclasses import dataclass

from flowforge.core.errors import EvalError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.eval.contract")

DEFAULT_QUALITY_BAR = 0.85
# Two independent evidence sources are required for full credit, mirroring the
# engine.py "evidence ≥2 sources" hard guardrail.
FULL_EVIDENCE_SOURCES = 2


@dataclass(frozen=True)
class EvalContract:
    """The five questions a harness component answers for self-evaluation."""

    what_was_promised: str
    what_was_delivered: str
    what_evidence_exists: list[str]
    what_quality_bar: float = DEFAULT_QUALITY_BAR
    what_attribution: str = ""


@dataclass(frozen=True)
class EvalVerdict:
    """Result of running an EvalContract through EvalContractRunner."""

    passed: bool
    score: float
    missing_evidence: list[str]
    attribution: str = ""
    notes: str = ""


def _tokenize(text: str) -> set[str]:
    """Split into lowercase word tokens, stripping surrounding punctuation."""
    return {
        tok.strip(".,;:!?\"'()[]{}").lower()
        for tok in text.split()
        if tok.strip()
    }


def _jaccard(a: set[str], b: set[str]) -> float:
    """Jaccard overlap of two token sets. Empty promised set => 0.0."""
    if not a or not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


class EvalContractRunner:
    """Evaluates an EvalContract deterministically (no LLM).

    Scoring:
      delivery_score  = Jaccard(promised_tokens, delivered_tokens)
      evidence_score  = min(1.0, len(evidence) / FULL_EVIDENCE_SOURCES)
      score           = geometric_mean(delivery_score, evidence_score)
                        (matches the verifier.py aggregation pattern)

    A contract passes only when score >= quality_bar AND at least one evidence
    source is present (missing evidence => automatic fail).
    """

    def __init__(self, full_evidence_sources: int = FULL_EVIDENCE_SOURCES) -> None:
        self.full_evidence_sources = max(1, full_evidence_sources)

    def evaluate(self, contract: EvalContract) -> EvalVerdict:
        if contract.what_quality_bar < 0.0 or contract.what_quality_bar > 1.0:
            raise EvalError(
                f"quality_bar must be within [0.0, 1.0], got {contract.what_quality_bar}"
            )

        promised_tokens = _tokenize(contract.what_was_promised)
        delivered_tokens = _tokenize(contract.what_was_delivered)
        delivery_score = _jaccard(promised_tokens, delivered_tokens)

        evidence_count = len(contract.what_evidence_exists)
        evidence_score = min(1.0, evidence_count / self.full_evidence_sources)

        # Geometric mean — same shape as loop/verifier.py quality scoring.
        score = (delivery_score * evidence_score) ** 0.5
        score = round(score, 4)

        missing: list[str] = []
        if evidence_count == 0:
            missing.append("at least one evidence source required")

        attribution = contract.what_attribution or "unclassified"
        passed = score >= contract.what_quality_bar and not missing

        notes = (
            f"delivery_score={delivery_score:.2f} "
            f"evidence_score={evidence_score:.2f} "
            f"evidence_count={evidence_count}"
        )

        logger.info(f"eval: contract verdict passed={passed} score={score:.2f}")

        return EvalVerdict(
            passed=passed,
            score=score,
            missing_evidence=missing,
            attribution=attribution,
            notes=notes,
        )
