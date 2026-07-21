"""Capability analysis — gap analysis, complementarity, overlap.

Pure logic over ``CapabilityProfile`` instances. No I/O, no side effects.

Boundary铁律: this module is in ``core/`` and depends only on
``flowforge.core.capability.profile`` + ``flowforge.core.tracing``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from flowforge.core.capability.profile import CapabilityProfile
from flowforge.core.errors import CapabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.capability.analyzer")

__all__ = ["GapReport", "CapabilityAnalyzer"]


@dataclass
class GapReport:
    """Result of ``gap_analysis`` — what the profile is missing vs a requirement.

    Fields:
        missing_skills: required capabilities the profile cannot satisfy.
        matching_skills: required capabilities the profile satisfies.
        total_gap_score: numeric gap severity (count of missing skills).
    """

    missing_skills: list[str] = field(default_factory=list)
    matching_skills: list[str] = field(default_factory=list)
    total_gap_score: float = 0.0


class CapabilityAnalyzer:
    """Analyzes capability profiles for routing and team composition.

    Stateless utility; ``proficiency_threshold`` determines what counts as
    "having" a skill (default 0.5, matching ``Forgekin.has_capability``).
    """

    def __init__(self, proficiency_threshold: float = 0.5) -> None:
        if not 0.0 <= proficiency_threshold <= 1.0:
            raise CapabilityError(
                f"proficiency_threshold must be in [0.0, 1.0], got {proficiency_threshold}"
            )
        self.proficiency_threshold = proficiency_threshold

    def _has_skill(self, profile: CapabilityProfile, name: str) -> bool:
        """Return True if ``profile`` has skill ``name`` at/above threshold."""
        skill = profile.skill_packages.get(name)
        return skill is not None and skill.proficiency >= self.proficiency_threshold

    def gap_analysis(
        self,
        profile: CapabilityProfile,
        required_capabilities: list[str],
    ) -> GapReport:
        """Compute the gap between a profile and required capabilities.

        Args:
            profile: the profile to evaluate.
            required_capabilities: capability names the task needs.

        Returns:
            ``GapReport`` with matching/missing skills and a gap score.
        """
        matching: list[str] = []
        missing: list[str] = []
        for req in required_capabilities:
            if self._has_skill(profile, req):
                matching.append(req)
            else:
                missing.append(req)
        report = GapReport(
            missing_skills=missing,
            matching_skills=matching,
            total_gap_score=float(len(missing)),
        )
        logger.debug(
            f"capability: gap_analysis forgekin_id={profile.forgekin_id} "
            f"matching={len(matching)} missing={len(missing)}"
        )
        return report

    def find_complementary_pair(
        self,
        profile_a: CapabilityProfile,
        profile_b: CapabilityProfile,
        required: list[str],
    ) -> bool:
        """Check if two profiles together cover all required capabilities.

        Two profiles complement when, for every required capability, at
        least one of the two has it at sufficient proficiency. This is the
        basis for TeamAct owner/verifier pairing (F002).

        Args:
            profile_a: first profile.
            profile_b: second profile.
            required: capability names the task needs.

        Returns:
            True if the pair jointly covers all required capabilities.
        """
        for req in required:
            if not (self._has_skill(profile_a, req) or self._has_skill(profile_b, req)):
                logger.debug(
                    f"capability: complementary=False req={req!r} "
                    f"a={profile_a.forgekin_id} b={profile_b.forgekin_id} (both lack)"
                )
                return False
        logger.debug(
            f"capability: complementary=True "
            f"a={profile_a.forgekin_id} b={profile_b.forgekin_id}"
        )
        return True

    def compute_overlap(
        self,
        profile_a: CapabilityProfile,
        profile_b: CapabilityProfile,
    ) -> float:
        """Compute skill-name overlap (Jaccard) between two profiles.

        Args:
            profile_a: first profile.
            profile_b: second profile.

        Returns:
            Jaccard similarity in [0.0, 1.0] over skill names.
        """
        names_a = set(profile_a.skill_packages.keys())
        names_b = set(profile_b.skill_packages.keys())
        union = names_a | names_b
        if not union:
            return 0.0
        intersection = names_a & names_b
        overlap = len(intersection) / len(union)
        logger.debug(
            f"capability: overlap a={profile_a.forgekin_id} "
            f"b={profile_b.forgekin_id} overlap={overlap:.3f}"
        )
        return overlap
