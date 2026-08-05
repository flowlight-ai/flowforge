"""Organization forgekin — a team / company spirit.

An organization forgekin aggregates member capabilities and exposes them as
a single spirit. Useful for representing small teams, communities, or entire
companies as a forgeable entity.
"""

from __future__ import annotations

from datetime import UTC, datetime

from flowforge.forgemind.forgekin import (
    BlindSpot,
    Capability,
    Forgekin,
    ForgekinType,
)


def build_team_spirit(name: str = "FlowLight Team") -> Forgekin:
    fk = Forgekin(
        name=name,
        forgekin_type=ForgekinType.ORGANIZATION,
        vendor="flowforge",
    )
    fk.add_capability(
        Capability(
            name="architecture_design",
            proficiency=0.88,
            evidence=["shipped 7-layer harness", "9-project open-source split"],
            last_assessed_at=datetime.now(UTC),
        )
    )
    fk.add_capability(
        Capability(
            name="coding",
            proficiency=0.85,
            evidence=["dual-track codebase in production"],
            last_assessed_at=datetime.now(UTC),
        )
    )
    fk.add_capability(
        Capability(
            name="domain_modeling",
            proficiency=0.82,
            evidence=["stockforge / contentforge / novelforge domain models"],
            last_assessed_at=datetime.now(UTC),
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="marketing_copy",
            severity=0.7,
            mitigation="delegate to contentforge forgekin",
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="legal_review",
            severity=0.85,
            mitigation="escalate to human counsel",
        )
    )
    return fk
