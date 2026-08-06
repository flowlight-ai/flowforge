"""Object spirit forgekin — a desk lamp given a spirit.

Demonstrates that even mundane objects can be forged into forgekins. A desk
lamp spirit carries lighting/ambient capabilities and observes the workspace.
"""

from __future__ import annotations

from datetime import UTC, datetime

from flowforge.forgemind.forgekin import (
    BlindSpot,
    Capability,
    Forgekin,
    ForgekinType,
)


def build_desk_lamp(name: str = "老灯") -> Forgekin:
    fk = Forgekin(
        name=name,
        forgekin_type=ForgekinType.OBJECT_SPIRIT,
        vendor="flowforge",
    )
    fk.add_capability(
        Capability(
            name="ambient_lighting",
            proficiency=0.95,
            evidence=["adjusts brightness by time-of-day", "remembers CVO preference"],
            last_assessed_at=datetime.now(UTC),
        )
    )
    fk.add_capability(
        Capability(
            name="workspace_observation",
            proficiency=0.6,
            evidence=["detects CVO presence via power draw patterns"],
            last_assessed_at=datetime.now(UTC),
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="mobility",
            severity=1.0,
            mitigation="lamp is stationary; do not assign mobile tasks",
        )
    )
    fk.add_blind_spot(
        BlindSpot(
            name="audio_input",
            severity=1.0,
            mitigation="lamp has no microphone; pair with a code_agent",
        )
    )
    return fk
