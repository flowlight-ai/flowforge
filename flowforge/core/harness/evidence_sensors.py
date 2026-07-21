"""Evidence & Sensors — record-then-verify evidence store (roleagent.md Ch.7).

Layer 3 of the Harness seven-layer guardrail. Evidence is recorded unverified
and must be explicitly verified before it counts toward acceptance criteria.
Cross-check returns a simple string-similarity ratio in [0.0, 1.0].
"""

from __future__ import annotations

import difflib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from flowforge.core.errors import HarnessError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.harness.evidence_sensors")

__all__ = ["Evidence", "EvidenceCollector"]


@dataclass
class Evidence:
    """One piece of recorded evidence."""

    evidence_id: str
    source: str
    content: str
    type: str
    recorded_at: datetime
    verified: bool = False


class EvidenceCollector:
    """Record-then-verify evidence store with cross-check."""

    def __init__(self) -> None:
        self._evidence: dict[str, Evidence] = {}

    def record_evidence(
        self,
        source: str,
        content: str,
        evidence_type: str,
    ) -> Evidence:
        evidence_id = uuid.uuid4().hex
        evidence = Evidence(
            evidence_id=evidence_id,
            source=source,
            content=content,
            type=evidence_type,
            recorded_at=datetime.now(timezone.utc),
            verified=False,
        )
        self._evidence[evidence_id] = evidence
        logger.info(
            f"harness: record_evidence id={evidence_id} source={source!r} "
            f"type={evidence_type!r}"
        )
        return evidence

    def verify(self, evidence_id: str, verifier: str) -> None:
        if evidence_id not in self._evidence:
            raise HarnessError(f"evidence {evidence_id!r} not found")
        self._evidence[evidence_id].verified = True
        logger.info(
            f"harness: verify_evidence id={evidence_id} verifier={verifier!r}"
        )

    def list_unverified(self) -> list[Evidence]:
        return [e for e in self._evidence.values() if not e.verified]

    def cross_check(self, evidence_a: Evidence, evidence_b: Evidence) -> float:
        """Return content similarity in [0.0, 1.0] via SequenceMatcher ratio.

        1.0 means identical content; 0.0 means no shared character subsequences.
        """
        ratio = difflib.SequenceMatcher(
            None, evidence_a.content, evidence_b.content
        ).ratio()
        logger.debug(
            f"harness: cross_check a={evidence_a.evidence_id} "
            f"b={evidence_b.evidence_id} ratio={ratio:.4f}"
        )
        return ratio
