"""Fictional character forgekin — Sherlock Holmes spirit.

Demonstrates forging a spirit into a fictional character. Sherlock carries
deductive reasoning + observation but has well-documented blind spots
(arrogance, social skills) that the spirit must mitigate.
"""

from __future__ import annotations

from datetime import datetime, timezone

from flowforge.forgemind.forgekin import (
    BlindSpot,
    Capability,
    Forgekin,
    ForgekinType,
)


def build_sherlock(name: str = "Sherlock Holmes") -> Forgekin:
    fk = Forgekin(
        name=name,
        forgekin_type=ForgekinType.FICTIONAL_CHARACTER,
        vendor="flowforge",
    )
    fk.add_capability(
        Capability(
            name="deductive_reasoning",
            proficiency=0.97,
            evidence=["A Study in Scarlet", "The Hound of the Baskervilles"],
            last_assessed_at=datetime.now(timezone.utc),
        )
    )
    fk.add_capability(
        Capability(
            name="observation",
            proficiency=0.93,
            evidence=["noted ash on shoes → deduced Brixton visit"],
            last_assessed_at=datetime.now(timezone.utc),
        )
    )
    fk.add_capability(
        Capability(
            name="forensic_analysis",
            proficiency=0.85,
            evidence=["pioneered blood-typing and footprint analysis"],
            last_assessed_at=datetime.now(timezone.utc),
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="social_empathy",
            severity=0.8,
            mitigation="pair with an animal_companion forgekin for human-side judgment",
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="patience_with_routine_work",
            severity=0.75,
            mitigation="do not assign repetitive tasks; delegate to code_agent",
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="modern_technology",
            severity=0.9,
            mitigation="character is from 1890s — pair with contemporary forgekin",
        )
    )
    return fk
