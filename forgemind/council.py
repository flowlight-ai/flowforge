"""CouncilChannel — cross-vendor review with push-back rights.

A council is convened when:
- A forgekin produces a high-stakes artifact (≥ 0.85 quality bar)
- A high-risk domain action is proposed
- A cross-vendor disagreement needs arbitration

Each reviewer (forgekin) has the right to push back. The council aggregates
verdicts with cross-vendor weighting: same-vendor agreement is discounted to
prevent groupthink.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.forgemind.forgekin import Forgekin

logger = get_logger("flowforge.forgemind.council")


class CouncilVerdict(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    NEEDS_REVISION = "needs_revision"
    ESCALATE = "escalate"


@dataclass
class CouncilReview:
    reviewer_id: str
    reviewer_vendor: str
    verdict: CouncilVerdict
    score: float  # 0.0..1.0
    notes: str = ""
    push_back_points: list[str] = field(default_factory=list)
    reviewed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class CouncilSession:
    session_id: str = field(default_factory=lambda: f"cs-{uuid.uuid4().hex[:12]}")
    artifact: str = ""
    reviews: list[CouncilReview] = field(default_factory=list)
    final_verdict: CouncilVerdict | None = None
    final_score: float = 0.0
    convened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    closed_at: datetime | None = None


class CouncilChannel:
    """Cross-vendor council for high-stakes review.

    The channel is vendor-aware: it discounts same-vendor agreement and
    requires ≥2 distinct vendors for a PASS verdict.
    """

    def __init__(
        self,
        min_reviewers: int = 2,
        min_distinct_vendors: int = 2,
        pass_threshold: float = 0.85,
    ) -> None:
        self.min_reviewers = min_reviewers
        self.min_distinct_vendors = min_distinct_vendors
        self.pass_threshold = pass_threshold

    def convene(
        self,
        artifact: str,
        reviewers: list[Forgekin],
        review_fn: Any | None = None,
    ) -> CouncilSession:
        """Convene a council session. review_fn(reviewee, artifact) -> CouncilReview.

        If review_fn is None, a default stub returns a neutral PASS — useful for
        testing the aggregation logic without invoking real LLMs.
        """
        session = CouncilSession(artifact=artifact)
        if len(reviewers) < self.min_reviewers:
            logger.warning(
                f"council: only {len(reviewers)} reviewers (< {self.min_reviewers}); "
                f"verdict will be ESCALATE"
            )
        for reviewer in reviewers:
            if review_fn is None:
                review = CouncilReview(
                    reviewer_id=reviewer.forgekin_id,
                    reviewer_vendor=reviewer.vendor,
                    verdict=CouncilVerdict.PASS,
                    score=0.85,
                    notes="default stub review",
                )
            else:
                review = review_fn(reviewer, artifact)
            session.reviews.append(review)
            logger.debug(
                f"council review: reviewer={reviewer.name!r} vendor={reviewer.vendor} "
                f"verdict={review.verdict.value} score={review.score:.2f}"
            )
        session.final_verdict, session.final_score = self._aggregate(session.reviews)
        session.closed_at = datetime.now(timezone.utc)
        logger.info(
            f"council closed: session={session.session_id} "
            f"reviews={len(session.reviews)} verdict={session.final_verdict.value} "
            f"score={session.final_score:.4f}"
        )
        return session

    def _aggregate(self, reviews: list[CouncilReview]) -> tuple[CouncilVerdict, float]:
        if not reviews:
            return CouncilVerdict.ESCALATE, 0.0
        if len(reviews) < self.min_reviewers:
            return CouncilVerdict.ESCALATE, 0.0
        distinct_vendors = {r.reviewer_vendor for r in reviews}
        if len(distinct_vendors) < self.min_distinct_vendors:
            return CouncilVerdict.ESCALATE, 0.0
        # Weighted average — vendors weighted equally, individual reviewers
        # within a vendor share that vendor's weight
        vendor_weight = 1.0 / len(distinct_vendors)
        per_vendor_count: dict[str, int] = {}
        for r in reviews:
            per_vendor_count[r.reviewer_vendor] = per_vendor_count.get(r.reviewer_vendor, 0) + 1
        weighted_sum = 0.0
        for r in reviews:
            w = vendor_weight / per_vendor_count[r.reviewer_vendor]
            weighted_sum += r.score * w
        if any(r.verdict == CouncilVerdict.FAIL for r in reviews):
            return CouncilVerdict.FAIL, weighted_sum
        if any(r.verdict == CouncilVerdict.NEEDS_REVISION for r in reviews):
            return CouncilVerdict.NEEDS_REVISION, weighted_sum
        if weighted_sum >= self.pass_threshold:
            return CouncilVerdict.PASS, weighted_sum
        return CouncilVerdict.NEEDS_REVISION, weighted_sum
