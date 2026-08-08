"""Verifier — quality score + cross-agent review.

The verifier is invoked in the Verify step of the loop. It:
1. Computes a quality score over the produced artifact
2. Invokes cross-agent reviewers (different vendors) to push back
3. Aggregates reviewer notes into the loop state
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.loop.state import LoopState

logger = get_logger("flowforge.loop.verifier")

DEFAULT_QUALITY_THRESHOLD = 0.85


class Verifier:
    """Verifies the produced artifact against acceptance criteria."""

    def __init__(
        self,
        quality_threshold: float = DEFAULT_QUALITY_THRESHOLD,
        reviewer: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self.quality_threshold = quality_threshold
        # `reviewer` is intentionally a callable so tests can inject a stub.
        # In production it would dispatch to LLMClient with cross-vendor fallback.
        self.reviewer = reviewer

    def verify(
        self,
        state: LoopState,
        artifact: str,
        criteria_check: Callable[[str, str], bool] | None = None,
    ) -> dict[str, Any]:
        """Run verification. Returns dict with quality_score, passed, reviewer_notes."""
        # 1. Per-criterion check (caller may inject custom judge)
        criteria_results: dict[str, bool] = {}
        if criteria_check is None:
            # Default: criterion considered met if artifact is non-empty
            criteria_results = {c: bool(artifact.strip()) for c in state.acceptance_criteria}
        else:
            for c in state.acceptance_criteria:
                criteria_results[c] = criteria_check(c, artifact)
        criteria_pass_rate = (
            sum(1 for v in criteria_results.values() if v) / len(criteria_results)
            if criteria_results
            else 0.0
        )

        # 2. Cross-agent review (optional)
        reviewer_notes: list[dict[str, Any]] = []
        if self.reviewer is not None:
            try:
                note = self.reviewer(artifact, {"criteria": state.acceptance_criteria})
                reviewer_notes.append(note)
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"reviewer raised: {exc!r}")
                reviewer_notes.append({"reviewer": "error", "error": repr(exc)})

        # 3. Quality score — geometric mean of criteria pass rate and reviewer agreement
        reviewer_agreement = 1.0
        if reviewer_notes:
            agreed = sum(1 for n in reviewer_notes if n.get("pass", False))
            reviewer_agreement = agreed / len(reviewer_notes)
        quality_score = (criteria_pass_rate * reviewer_agreement) ** 0.5
        quality_score = round(quality_score, 4)

        # 4. Persist into state
        state.quality_score = quality_score
        state.reviewer_notes.extend(reviewer_notes)
        for crit, passed in criteria_results.items():
            if passed and not state.evidence.get(crit):
                state.attach_evidence(crit, f"verifier:criteria_passed:{crit}")

        passed = quality_score >= self.quality_threshold and criteria_pass_rate == 1.0
        logger.info(
            f"verifier: criteria_pass_rate={criteria_pass_rate:.2f} "
            f"reviewer_agreement={reviewer_agreement:.2f} quality_score={quality_score:.4f} "
            f"threshold={self.quality_threshold} passed={passed}"
        )
        return {
            "quality_score": quality_score,
            "criteria_results": criteria_results,
            "reviewer_notes": reviewer_notes,
            "passed": passed,
        }
