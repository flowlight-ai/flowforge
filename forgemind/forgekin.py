"""Forgekin — universal abstraction for any forgeable spirit (ForgekinSpecies).

A forgekin is the long-term subject (roleagent.md Ch.0): the entity that
persists across many task instances. Roles are runtime tags applied to a
forgekin for the duration of a single task.

Forgekin types (ForgekinType) — non-exhaustive, extensible via plugins:
- animal_companion    — pets / service animals / wildlife spirits
- organization        — companies / teams / communities
- object_spirit       — furniture / lamps / tools given a spirit
- fictional_character — fairy-tale / myth / history / novel characters
- vr_persona          — VR / game characters with a spirit
- code_agent          — software agents (devforge contentforge etc.)
- custom              — anything else
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from flowforge.core.errors import ForgekinError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.forgemind.forgekin")


class ForgekinType(str, Enum):
    ANIMAL_COMPANION = "animal_companion"
    ORGANIZATION = "organization"
    OBJECT_SPIRIT = "object_spirit"
    FICTIONAL_CHARACTER = "fictional_character"
    VR_PERSONA = "vr_persona"
    CODE_AGENT = "code_agent"
    CUSTOM = "custom"


@dataclass
class Capability:
    """One capability dimension of a forgekin.

    Examples:
        Capability(name="coding", proficiency=0.8, evidence=["commit abc"])
        Capability(name="empathy", proficiency=0.9, evidence=["user feedback"])
    """

    name: str
    proficiency: float = 0.0  # 0.0..1.0
    evidence: list[str] = field(default_factory=list)
    last_assessed_at: datetime | None = None


@dataclass
class BlindSpot:
    """One known blind spot — what this forgekin is bad at.

    Blind spots are first-class: a forgekin that knows its blind spots is
    safer than one that pretends to be omniscient.
    """

    name: str
    severity: float = 0.0  # 0.0..1.0
    mitigation: str = ""  # how to compensate (delegate / ask human / etc.)
    discovered_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class ForgekinState:
    """Mutable runtime state of a forgekin."""

    energy: float = 1.0  # 0.0..1.0 — task budget remaining
    mood: str = "neutral"
    last_task_at: datetime | None = None
    open_handoffs: list[str] = field(default_factory=list)  # capsule ids


@dataclass
class Forgekin:
    """Universal forgekin (ForgekinSpecies).

    Subclass this for specific forgekin types, or instantiate directly with
    a `forgekin_type` for ad-hoc forgekins.
    """

    name: str
    forgekin_type: ForgekinType = ForgekinType.CUSTOM
    forgekin_id: str = field(default_factory=lambda: f"fk-{uuid.uuid4().hex[:12]}")
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    # Long-term profile
    capabilities: dict[str, Capability] = field(default_factory=dict)
    blind_spots: list[BlindSpot] = field(default_factory=list)
    history: list[dict[str, Any]] = field(default_factory=list)

    # Runtime state
    state: ForgekinState = field(default_factory=ForgekinState)

    # Vendor / model lineage (for cross-vendor review in council)
    vendor: str = "flowforge"
    model_lineage: list[str] = field(default_factory=list)

    # Optional external agent bindings — populated by external_agents.py
    bound_external_agents: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ForgekinError("Forgekin name must not be empty")
        logger.debug(f"forgekin instantiated: id={self.forgekin_id} name={self.name!r}")

    def add_capability(self, cap: Capability) -> None:
        self.capabilities[cap.name] = cap
        logger.debug(f"forgekin {self.forgekin_id}: +capability {cap.name}")

    def add_blind_spot(self, spot: BlindSpot) -> None:
        self.blind_spots.append(spot)
        logger.debug(f"forgekin {self.forgekin_id}: +blind_spot {spot.name}")

    def record_history(self, event: dict[str, Any]) -> None:
        event.setdefault("timestamp", datetime.now(UTC).isoformat())
        self.history.append(event)

    def has_capability(self, name: str, min_proficiency: float = 0.5) -> bool:
        cap = self.capabilities.get(name)
        return cap is not None and cap.proficiency >= min_proficiency

    def can_take_task(self, required_capabilities: list[str]) -> tuple[bool, list[str]]:
        """Check if this forgekin can take a task requiring the given capabilities."""
        missing: list[str] = []
        for req in required_capabilities:
            if not self.has_capability(req):
                missing.append(req)
        if missing:
            return False, missing
        if self.state.energy <= 0.0:
            return False, ["energy depleted"]
        return True, []

    def spend_energy(self, amount: float) -> None:
        if amount < 0:
            raise ForgekinError(f"energy amount must be >= 0, got {amount}")
        self.state.energy = max(0.0, self.state.energy - amount)
        self.state.last_task_at = datetime.now(UTC)

    def recover_energy(self, amount: float) -> None:
        if amount < 0:
            raise ForgekinError(f"energy amount must be >= 0, got {amount}")
        self.state.energy = min(1.0, self.state.energy + amount)

    def __repr__(self) -> str:
        return (
            f"<Forgekin {self.name!r} type={self.forgekin_type.value} "
            f"id={self.forgekin_id} energy={self.state.energy:.2f}>"
        )
