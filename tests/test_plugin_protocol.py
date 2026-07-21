"""Tests for Plugin Protocol V3 — four self-evolution hooks.

Per TIP-032: each V3 hook receives its OWN registry type, not a shared one.
"""

from __future__ import annotations

import pytest

from flowforge.core.errors import PluginError
from flowforge.core.plugin_protocol import (
    PluginContext,
    PluginManager,
    PluginProtocol,
    PluginV3Registries,
)
from flowforge.core.registries import (
    AutoForgeConfig,
    AutoForgeRegistry,
    CouncilChannelDescriptor,
    CouncilRegistry,
    SkillDescriptor,
    SkillRegistry,
)
from flowforge.forgemind.forgekin import Forgekin, ForgekinType
from flowforge.forgemind.registry import ForgekinRegistry


def _make_registries() -> PluginV3Registries:
    """Build a fresh bundle of four empty registries for each test."""
    return PluginV3Registries(
        forgekin_registry=ForgekinRegistry(),
        skill_registry=SkillRegistry(),
        council_registry=CouncilRegistry(),
        auto_forge_registry=AutoForgeRegistry(),
    )


class _DemoPlugin(PluginProtocol):
    plugin_id = "demo-plugin"
    plugin_version = "0.0.1"
    plugin_description = "demo"

    def __init__(self) -> None:
        self.calls: list[str] = []

    def register_forgekins(self, registry: ForgekinRegistry) -> None:
        self.calls.append("forgekins")
        registry.register(Forgekin(name="demo-fk", forgekin_type=ForgekinType.CUSTOM))

    def register_forge_skills(self, registry: SkillRegistry) -> None:
        self.calls.append("skills")
        registry.register(
            SkillDescriptor(
                skill_id="demo.skill",
                name="Demo Skill",
                source_plugin=self.plugin_id,
            )
        )

    def register_council_channels(self, registry: CouncilRegistry) -> None:
        self.calls.append("council")
        registry.register(
            CouncilChannelDescriptor(
                channel_id="demo.review",
                name="Demo Review",
                source_plugin=self.plugin_id,
            )
        )

    def register_auto_forge_config(self, registry: AutoForgeRegistry) -> None:
        self.calls.append("auto_forge")
        registry.register(
            AutoForgeConfig(
                config_id="demo.forge",
                plugin_id=self.plugin_id,
                domain="demo",
            )
        )


def test_register_requires_plugin_id() -> None:
    class _NoId(PluginProtocol):
        plugin_id = ""

        def register_forgekins(self, r): pass
        def register_forge_skills(self, r): pass
        def register_council_channels(self, r): pass
        def register_auto_forge_config(self, r): pass

    pm = PluginManager()
    with pytest.raises(PluginError, match="non-empty plugin_id"):
        pm.register(_NoId())


def test_register_rejects_duplicates() -> None:
    pm = PluginManager()
    pm.register(_DemoPlugin())
    with pytest.raises(PluginError, match="already registered"):
        pm.register(_DemoPlugin())


def test_get_unknown_raises() -> None:
    pm = PluginManager()
    with pytest.raises(PluginError, match="not found"):
        pm.get("bogus")


def test_invoke_v3_hooks_calls_all_four_with_distinct_registries() -> None:
    """TIP-032 fix: each hook must receive its OWN registry type."""
    pm = PluginManager()
    plugin = _DemoPlugin()
    pm.register(plugin)
    registries = _make_registries()
    pm.invoke_v3_hooks(registries)

    # All four hooks called in declared order
    assert plugin.calls == ["forgekins", "skills", "council", "auto_forge"]

    # Each registry received exactly one entry of its OWN type
    assert registries.forgekin_registry.count() == 1
    assert registries.skill_registry.count() == 1
    assert registries.council_registry.count() == 1
    assert registries.auto_forge_registry.count() == 1

    # Cross-check: the forgekin registry must NOT contain skills / channels / configs
    fk = registries.forgekin_registry.list_all()[0]
    assert isinstance(fk, Forgekin)
    assert fk.name == "demo-fk"

    skill = registries.skill_registry.list_all()[0]
    assert isinstance(skill, SkillDescriptor)
    assert skill.skill_id == "demo.skill"

    channel = registries.council_registry.list_all()[0]
    assert isinstance(channel, CouncilChannelDescriptor)
    assert channel.channel_id == "demo.review"

    config = registries.auto_forge_registry.list_all()[0]
    assert isinstance(config, AutoForgeConfig)
    assert config.config_id == "demo.forge"


def test_invoke_v3_hooks_propagates_errors_as_plugin_error() -> None:
    class _BrokenPlugin(PluginProtocol):
        plugin_id = "broken"

        def register_forgekins(self, r): raise RuntimeError("boom")
        def register_forge_skills(self, r): pass
        def register_council_channels(self, r): pass
        def register_auto_forge_config(self, r): pass

    pm = PluginManager()
    pm.register(_BrokenPlugin())
    with pytest.raises(PluginError, match="V3 hook failed"):
        pm.invoke_v3_hooks(_make_registries())


def test_list_plugins() -> None:
    pm = PluginManager()
    pm.register(_DemoPlugin())
    assert pm.list_plugins() == ["demo-plugin"]


def test_plugin_context_carries_config_and_container() -> None:
    ctx = PluginContext(config={"k": "v"}, container="stub")
    assert ctx.config == {"k": "v"}
    assert ctx.container == "stub"


def test_v2_backcompat_hooks_optional() -> None:
    plugin = _DemoPlugin()
    # V2 hooks return empty lists by default
    assert plugin.register_agents() == []
    assert plugin.register_tools() == []


def test_skill_registry_find_by_tag_and_plugin() -> None:
    sr = SkillRegistry()
    sr.register(
        SkillDescriptor(
            skill_id="s1",
            name="S1",
            capability_tags=["coding", "review"],
            source_plugin="p1",
        )
    )
    sr.register(
        SkillDescriptor(
            skill_id="s2",
            name="S2",
            capability_tags=["coding"],
            source_plugin="p2",
        )
    )
    assert len(sr.find_by_tag("coding")) == 2
    assert len(sr.find_by_tag("review")) == 1
    assert len(sr.find_by_plugin("p1")) == 1
    assert sr.find_by_plugin("p1")[0].skill_id == "s1"


def test_council_registry_unregister() -> None:
    cr = CouncilRegistry()
    cr.register(
        CouncilChannelDescriptor(channel_id="ch1", name="CH1", source_plugin="p1")
    )
    assert cr.count() == 1
    removed = cr.unregister("ch1")
    assert removed.channel_id == "ch1"
    assert cr.count() == 0


def test_auto_forge_registry_find_by_domain() -> None:
    ar = AutoForgeRegistry()
    ar.register(AutoForgeConfig(config_id="c1", plugin_id="p1", domain="coding"))
    ar.register(AutoForgeConfig(config_id="c2", plugin_id="p2", domain="writing"))
    assert len(ar.find_by_domain("coding")) == 1
    assert len(ar.find_by_domain("writing")) == 1
    assert len(ar.find_by_domain("nonexistent")) == 0


def test_skill_registry_rejects_empty_id() -> None:
    sr = SkillRegistry()
    with pytest.raises(PluginError, match="non-empty skill_id"):
        sr.register(SkillDescriptor(skill_id="", name="bad"))


def test_council_registry_rejects_duplicates() -> None:
    cr = CouncilRegistry()
    cr.register(CouncilChannelDescriptor(channel_id="dup", name="D"))
    with pytest.raises(PluginError, match="already registered"):
        cr.register(CouncilChannelDescriptor(channel_id="dup", name="D2"))
