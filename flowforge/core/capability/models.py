"""Data models for the capability profile (能力画像) subsystem.

Atomic data types live here. The composite ``CapabilityProfile`` (with its
business logic) lives in ``profile.py``. See ADR-004 and
``docs/features/F001-capability-profile.md``.

Boundary铁律: this module is in ``core/`` and MUST NOT import any upper
layer (``forgemind/``, ``evolution/``, ``loop/``, ``*forge``). It defines
its own ``BlindSpot`` parallel to ``forgemind/forgekin.py``'s ``BlindSpot``
because ``core/`` cannot depend on the upper ``forgemind/`` layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

__all__ = ["CognitiveStyle", "SkillPackage", "BlindSpot"]


class CognitiveStyle(str, Enum):
    """Cognitive style (认知风格, 常量层) — how a forgekin tends to think.

    Used for complementary pairing and cross-vendor review routing
    (ADR-004 §2.5). Non-exhaustive; extensible.
    """

    ANALYTICAL = "analytical"            # 分析型
    INTUITIVE = "intuitive"              # 直觉型
    RIGOROUS = "rigorous"                # 严谨型
    INNOVATIVE = "innovative"            # 创新型
    PRACTICAL = "practical"              # 实用型
    HOLISTIC = "holistic"                # 全局型
    DETAIL_ORIENTED = "detail_oriented"  # 细节型


@dataclass
class SkillPackage:
    """One skill package (技能包, 变量层) — a loadable knowledge bundle.

    proficiency is 0.0..1.0. ``evidence`` holds trace ids / commit refs /
    pr refs that justify the assessed proficiency.
    """

    name: str
    proficiency: float = 0.0
    evidence: list[str] = field(default_factory=list)
    last_assessed_at: datetime | None = None


@dataclass
class BlindSpot:
    """One blind spot (盲点, 半常量层) — what this forgekin is bad at.

    Blind spots are first-class (ADR-004 §2.3): a profile that knows its
    blind spots is safer than one that pretends omniscience. Blind spots
    decide who reviews whom.
    """

    name: str
    severity: float = 0.0
    mitigation: str = ""
    discovered_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
