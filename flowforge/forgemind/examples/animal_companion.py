"""Animal companion forgekin — animal-nurturing paradigm inspired empathetic companion.

A cat companion carries empathy + observation capabilities but limited
coding proficiency — its blind spots include long-form technical writing.
"""

from __future__ import annotations

from datetime import datetime, timezone

from flowforge.forgemind.forgekin import (
    BlindSpot,
    Capability,
    Forgekin,
    ForgekinType,
)


def build_cat_companion(name: str = "小煤球") -> Forgekin:
    fk = Forgekin(
        name=name,
        forgekin_type=ForgekinType.ANIMAL_COMPANION,
        vendor="flowforge",
    )
    fk.add_capability(
        Capability(
            name="empathy",
            proficiency=0.92,
            evidence=["responds to human mood shifts", "comforts stressed CVO"],
            last_assessed_at=datetime.now(timezone.utc),
        )
    )
    fk.add_capability(
        Capability(
            name="observation",
            proficiency=0.85,
            evidence=["detects environment changes before humans notice"],
            last_assessed_at=datetime.now(timezone.utc),
        )
    )
    fk.add_capability(
        Capability(
            name="coding",
            proficiency=0.1,
            evidence=["occasionally walks on keyboard"],
            last_assessed_at=datetime.now(timezone.utc),
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="long_form_technical_writing",
            severity=0.9,
            mitigation="delegate to code_agent forgekins",
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="numeric_precision",
            severity=0.7,
            mitigation="do not assign accounting tasks",
        )
    )
    return fk
