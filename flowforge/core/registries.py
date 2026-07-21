"""Registries for Plugin V3 hooks — separate registries per hook type.

Per TIP-032 (see docs/TIPS.md):
- register_forgekins -> ForgekinRegistry (forgemind/registry.py)
- register_forge_skills -> SkillRegistry (here)
- register_council_channels -> CouncilRegistry (here)
- register_auto_forge_config -> AutoForgeRegistry (here)

This file defines the three registries that plugin V3 hooks target.
ForgekinRegistry lives in forgemind/registry.py because it owns forgekin
lifecycle, but the other three are framework-level and live in core/.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from flowforge.core.errors import PluginError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.registries")

__all__ = [
    "SkillDescriptor",
    "SkillRegistry",
    "CouncilChannelDescriptor",
    "CouncilRegistry",
    "AutoForgeConfig",
    "AutoForgeRegistry",
]


# ---------------------------------------------------------------------------
# SkillRegistry — target of register_forge_skills
# ---------------------------------------------------------------------------


@dataclass
class SkillDescriptor:
    """One forge skill (灵技) — a reusable capability manifest.

    Skills are NOT forgekins. They are capability cards that any forgekin
    may load. Distinguishing skills from forgekins is the TIP-032 fix.
    """

    skill_id: str
    name: str
    description: str = ""
    capability_tags: list[str] = field(default_factory=list)
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)
    source_plugin: str = ""
    version: str = "0.0.1"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class SkillRegistry:
    """In-memory registry for SkillDescriptors."""

    def __init__(self) -> None:
        self._skills: dict[str, SkillDescriptor] = {}

    def register(self, skill: SkillDescriptor) -> None:
        if not skill.skill_id:
            raise PluginError("SkillDescriptor must declare a non-empty skill_id")
        if skill.skill_id in self._skills:
            raise PluginError(f"Skill {skill.skill_id!r} already registered")
        self._skills[skill.skill_id] = skill
        logger.info(
            f"skill_registry: +skill id={skill.skill_id} name={skill.name!r} "
            f"plugin={skill.source_plugin}"
        )

    def unregister(self, skill_id: str) -> SkillDescriptor:
        if skill_id not in self._skills:
            raise PluginError(f"Skill {skill_id!r} not found")
        return self._skills.pop(skill_id)

    def get(self, skill_id: str) -> SkillDescriptor:
        if skill_id not in self._skills:
            raise PluginError(f"Skill {skill_id!r} not found")
        return self._skills[skill_id]

    def find_by_tag(self, tag: str) -> list[SkillDescriptor]:
        return [s for s in self._skills.values() if tag in s.capability_tags]

    def find_by_plugin(self, plugin_id: str) -> list[SkillDescriptor]:
        return [s for s in self._skills.values() if s.source_plugin == plugin_id]

    def list_all(self) -> list[SkillDescriptor]:
        return list(self._skills.values())

    def count(self) -> int:
        return len(self._skills)

    def clear(self) -> None:
        self._skills.clear()


# ---------------------------------------------------------------------------
# CouncilRegistry — target of register_council_channels
# ---------------------------------------------------------------------------


@dataclass
class CouncilChannelDescriptor:
    """Descriptor for a council channel (灵议通道).

    A council channel is a named review pathway (e.g. "security-review",
    "code-review", "content-review") that plugins may register. The actual
    CouncilChannel runtime lives in forgemind/council.py.
    """

    channel_id: str
    name: str
    description: str = ""
    min_reviewers: int = 2
    min_distinct_vendors: int = 2
    pass_threshold: float = 0.85
    review_policy: str = "cross_vendor"  # cross_vendor | unanimous | majority
    source_plugin: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class CouncilRegistry:
    """In-memory registry for CouncilChannelDescriptors."""

    def __init__(self) -> None:
        self._channels: dict[str, CouncilChannelDescriptor] = {}

    def register(self, channel: CouncilChannelDescriptor) -> None:
        if not channel.channel_id:
            raise PluginError("CouncilChannelDescriptor must declare a non-empty channel_id")
        if channel.channel_id in self._channels:
            raise PluginError(f"Council channel {channel.channel_id!r} already registered")
        self._channels[channel.channel_id] = channel
        logger.info(
            f"council_registry: +channel id={channel.channel_id} name={channel.name!r} "
            f"plugin={channel.source_plugin}"
        )

    def unregister(self, channel_id: str) -> CouncilChannelDescriptor:
        if channel_id not in self._channels:
            raise PluginError(f"Council channel {channel_id!r} not found")
        return self._channels.pop(channel_id)

    def get(self, channel_id: str) -> CouncilChannelDescriptor:
        if channel_id not in self._channels:
            raise PluginError(f"Council channel {channel_id!r} not found")
        return self._channels[channel_id]

    def list_all(self) -> list[CouncilChannelDescriptor]:
        return list(self._channels.values())

    def count(self) -> int:
        return len(self._channels)

    def clear(self) -> None:
        self._channels.clear()


# ---------------------------------------------------------------------------
# AutoForgeRegistry — target of register_auto_forge_config
# ---------------------------------------------------------------------------


@dataclass
class AutoForgeConfig:
    """Configuration entry for auto-forge (灵锻) — self-evolution config.

    Plugins register their auto-forge configuration here so ForgeMindEngine
    can pick it up (e.g. "this plugin allows skill distillation in domain X
    with cooldown Y").
    """

    config_id: str
    plugin_id: str
    domain: str = "default"
    distill_enabled: bool = True
    cooldown_seconds: int = 3600
    min_reusability_score: float = 0.7
    min_non_obviousness_score: float = 0.6
    max_distill_per_day: int = 10
    extra: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class AutoForgeRegistry:
    """In-memory registry for AutoForgeConfig entries."""

    def __init__(self) -> None:
        self._configs: dict[str, AutoForgeConfig] = {}

    def register(self, config: AutoForgeConfig) -> None:
        if not config.config_id:
            raise PluginError("AutoForgeConfig must declare a non-empty config_id")
        if config.config_id in self._configs:
            raise PluginError(f"AutoForgeConfig {config.config_id!r} already registered")
        self._configs[config.config_id] = config
        logger.info(
            f"auto_forge_registry: +config id={config.config_id} "
            f"plugin={config.plugin_id} domain={config.domain}"
        )

    def unregister(self, config_id: str) -> AutoForgeConfig:
        if config_id not in self._configs:
            raise PluginError(f"AutoForgeConfig {config_id!r} not found")
        return self._configs.pop(config_id)

    def get(self, config_id: str) -> AutoForgeConfig:
        if config_id not in self._configs:
            raise PluginError(f"AutoForgeConfig {config_id!r} not found")
        return self._configs[config_id]

    def find_by_plugin(self, plugin_id: str) -> list[AutoForgeConfig]:
        return [c for c in self._configs.values() if c.plugin_id == plugin_id]

    def find_by_domain(self, domain: str) -> list[AutoForgeConfig]:
        return [c for c in self._configs.values() if c.domain == domain]

    def list_all(self) -> list[AutoForgeConfig]:
        return list(self._configs.values())

    def count(self) -> int:
        return len(self._configs)

    def clear(self) -> None:
        self._configs.clear()


# ---------------------------------------------------------------------------
# Process-wide defaults (one per registry type)
# ---------------------------------------------------------------------------

_default_skill_registry: SkillRegistry | None = None
_default_council_registry: CouncilRegistry | None = None
_default_auto_forge_registry: AutoForgeRegistry | None = None


def get_skill_registry() -> SkillRegistry:
    global _default_skill_registry
    if _default_skill_registry is None:
        _default_skill_registry = SkillRegistry()
    return _default_skill_registry


def set_skill_registry(registry: SkillRegistry | None) -> None:
    global _default_skill_registry
    _default_skill_registry = registry


def get_council_registry() -> CouncilRegistry:
    global _default_council_registry
    if _default_council_registry is None:
        _default_council_registry = CouncilRegistry()
    return _default_council_registry


def set_council_registry(registry: CouncilRegistry | None) -> None:
    global _default_council_registry
    _default_council_registry = registry


def get_auto_forge_registry() -> AutoForgeRegistry:
    global _default_auto_forge_registry
    if _default_auto_forge_registry is None:
        _default_auto_forge_registry = AutoForgeRegistry()
    return _default_auto_forge_registry


def set_auto_forge_registry(registry: AutoForgeRegistry | None) -> None:
    global _default_auto_forge_registry
    _default_auto_forge_registry = registry
