"""CapabilityProfile — the long-term subject identity of a forgekin.

roleagent.md Ch.0: role is a runtime tag (who does what this step), profile
is the persistent answer to "why this forgekin". ``CapabilityProfile`` is
the Phase 1 skeleton covering the constant + variable layers (cognitive
style, skill packages, blind spots). The accumulation layer (historical
performance) and instantaneous layer (current state) are deferred to
later phases per ADR-004 §5.

Boundary铁律: this module is in ``core/`` and MUST NOT import any upper
layer (``forgemind/``, ``evolution/``, ``loop/``, ``*forge``). It depends
only on ``flowforge.core.capability.models`` + ``flowforge.core.{errors,
tracing}``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from flowforge.core.capability.models import BlindSpot, CognitiveStyle, SkillPackage
from flowforge.core.errors import CapabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.capability.profile")

__all__ = ["CapabilityProfile", "STRENGTH_THRESHOLD"]

# A skill counts as a "strength" (强项) when proficiency >= this threshold.
# Used by ``has_blind_spot_conflict`` to detect "one's strength is other's
# blind spot". 0.5 matches Forgekin.has_capability default.
STRENGTH_THRESHOLD: float = 0.5


@dataclass
class CapabilityProfile:
    """Capability profile (能力画像) — the persistent identity of a forgekin.

    Fields:
        forgekin_id: id of the forgekin this profile describes.
        cognitive_style: constant-layer thinking style (分析型/直觉型/...).
        skill_packages: variable-layer loadable skills, keyed by name.
        blind_spots: semi-constant-layer known blind spots.
        last_updated_at: last time the profile was refreshed.
    """

    forgekin_id: str
    cognitive_style: CognitiveStyle = CognitiveStyle.ANALYTICAL
    skill_packages: dict[str, SkillPackage] = field(default_factory=dict)
    blind_spots: list[BlindSpot] = field(default_factory=list)
    last_updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        if not self.forgekin_id.strip():
            raise CapabilityError("CapabilityProfile forgekin_id must not be empty")
        logger.debug(
            f"capability: profile instantiated forgekin_id={self.forgekin_id} "
            f"style={self.cognitive_style.value}"
        )

    def add_skill(
        self,
        name: str,
        proficiency: float,
        evidence: list[str] | None = None,
    ) -> SkillPackage:
        """Add or replace a skill package on this profile.

        Args:
            name: skill name (key).
            proficiency: 0.0..1.0.
            evidence: supporting trace ids / commit refs.

        Returns:
            The created ``SkillPackage``.
        """
        if not name.strip():
            raise CapabilityError("skill name must not be empty")
        if not 0.0 <= proficiency <= 1.0:
            raise CapabilityError(f"proficiency must be in [0.0, 1.0], got {proficiency}")
        pkg = SkillPackage(
            name=name,
            proficiency=proficiency,
            evidence=list(evidence) if evidence else [],
            last_assessed_at=datetime.now(timezone.utc),
        )
        self.skill_packages[name] = pkg
        self.last_updated_at = datetime.now(timezone.utc)
        logger.info(f"capability: +skill name={name} proficiency={proficiency:.2f}")
        return pkg

    def add_blind_spot(
        self,
        name: str,
        severity: float,
        mitigation: str = "",
    ) -> BlindSpot:
        """Add a known blind spot to this profile.

        Args:
            name: blind spot name (e.g. "design").
            severity: 0.0..1.0.
            mitigation: how to compensate (delegate / ask human / etc.).

        Returns:
            The created ``BlindSpot``.
        """
        if not name.strip():
            raise CapabilityError("blind spot name must not be empty")
        if not 0.0 <= severity <= 1.0:
            raise CapabilityError(f"severity must be in [0.0, 1.0], got {severity}")
        spot = BlindSpot(
            name=name,
            severity=severity,
            mitigation=mitigation,
            discovered_at=datetime.now(timezone.utc),
        )
        self.blind_spots.append(spot)
        self.last_updated_at = datetime.now(timezone.utc)
        logger.info(f"capability: +blind_spot name={name} severity={severity:.2f}")
        return spot

    def has_blind_spot_conflict(self, other: CapabilityProfile) -> bool:
        """Check if one profile's strength is the other's blind spot.

        A conflict exists when a skill of one profile (proficiency >=
        ``STRENGTH_THRESHOLD``) has the same name as a blind spot of the
        other profile. This drives cross-vendor review pairing
        (ADR-004 §2.5): conflicting profiles should NOT review each other.

        Args:
            other: the other profile to compare against.

        Returns:
            True if a name conflict between strength and blind spot exists.
        """
        self_strengths = {
            name
            for name, skill in self.skill_packages.items()
            if skill.proficiency >= STRENGTH_THRESHOLD
        }
        other_strengths = {
            name
            for name, skill in other.skill_packages.items()
            if skill.proficiency >= STRENGTH_THRESHOLD
        }
        other_blind_names = {b.name for b in other.blind_spots}
        self_blind_names = {b.name for b in self.blind_spots}
        if self_strengths & other_blind_names:
            return True
        if other_strengths & self_blind_names:
            return True
        return False

    def to_dict(self) -> dict[str, Any]:
        """Serialize this profile to a JSON/YAML-friendly dict."""
        return {
            "forgekin_id": self.forgekin_id,
            "cognitive_style": self.cognitive_style.value,
            "skill_packages": [
                {
                    "name": s.name,
                    "proficiency": s.proficiency,
                    "evidence": list(s.evidence),
                    "last_assessed_at": s.last_assessed_at.isoformat()
                    if s.last_assessed_at
                    else None,
                }
                for s in self.skill_packages.values()
            ],
            "blind_spots": [
                {
                    "name": b.name,
                    "severity": b.severity,
                    "mitigation": b.mitigation,
                    "discovered_at": b.discovered_at.isoformat(),
                }
                for b in self.blind_spots
            ],
            "last_updated_at": self.last_updated_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CapabilityProfile:
        """Reconstruct a ``CapabilityProfile`` from a serialized dict.

        Args:
            data: dict produced by ``to_dict`` or loaded from YAML.

        Returns:
            The reconstructed profile.

        Raises:
            CapabilityError: if required fields are missing or invalid.
        """
        if not isinstance(data, dict):
            raise CapabilityError(
                f"profile data must be a dict, got {type(data).__name__}"
            )
        forgekin_id = data.get("forgekin_id")
        if not forgekin_id or not str(forgekin_id).strip():
            raise CapabilityError("profile data missing forgekin_id")
        style_raw = data.get("cognitive_style", CognitiveStyle.ANALYTICAL.value)
        try:
            cognitive_style = CognitiveStyle(style_raw)
        except ValueError as exc:
            raise CapabilityError(f"invalid cognitive_style: {style_raw!r}") from exc

        skill_packages: dict[str, SkillPackage] = {}
        for entry in data.get("skill_packages", []) or []:
            if not isinstance(entry, dict):
                raise CapabilityError(
                    f"skill_package entry must be a dict, got {type(entry).__name__}"
                )
            name = entry.get("name")
            if not name:
                raise CapabilityError("skill_package entry missing name")
            last_assessed_raw = entry.get("last_assessed_at")
            skill_packages[name] = SkillPackage(
                name=name,
                proficiency=float(entry.get("proficiency", 0.0)),
                evidence=list(entry.get("evidence", []) or []),
                last_assessed_at=(
                    datetime.fromisoformat(last_assessed_raw)
                    if last_assessed_raw
                    else None
                ),
            )

        blind_spots: list[BlindSpot] = []
        for entry in data.get("blind_spots", []) or []:
            if not isinstance(entry, dict):
                raise CapabilityError(
                    f"blind_spot entry must be a dict, got {type(entry).__name__}"
                )
            name = entry.get("name")
            if not name:
                raise CapabilityError("blind_spot entry missing name")
            discovered_raw = entry.get("discovered_at")
            blind_spots.append(
                BlindSpot(
                    name=name,
                    severity=float(entry.get("severity", 0.0)),
                    mitigation=str(entry.get("mitigation", "")),
                    discovered_at=(
                        datetime.fromisoformat(discovered_raw)
                        if discovered_raw
                        else datetime.now(timezone.utc)
                    ),
                )
            )

        last_updated_raw = data.get("last_updated_at")
        last_updated_at = (
            datetime.fromisoformat(last_updated_raw)
            if last_updated_raw
            else datetime.now(timezone.utc)
        )

        return cls(
            forgekin_id=forgekin_id,
            cognitive_style=cognitive_style,
            skill_packages=skill_packages,
            blind_spots=blind_spots,
            last_updated_at=last_updated_at,
        )
