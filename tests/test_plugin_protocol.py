"""Tests for the FlowForge plugin system (core.plugin / plugin_protocol).

Covers:
- FlowForgePlugin base class: default state, manifest, name/version
- V3 ForgeMind hooks (register_forgekins / register_forge_skills /
  register_council_channels / register_auto_forge_config) — no-op by default
  and callable with real registries
- PluginRegistry (core/plugin.py) register / get / list / unregister lifecycle
- PluginContext DI accessors
- PluginManifest defaults
- validate_plugin_config + fill_config_defaults helpers

No LLM is involved — these are pure data-structure + lifecycle tests.
"""

from __future__ import annotations

import pytest

from flowforge.core.errors import PluginError, ForgekinError
from flowforge.core.plugin import (
    FlowForgePlugin,
    PluginContext,
    PluginManifest,
    PluginRegistry,
    PluginState,
    fill_config_defaults,
    validate_plugin_config,
)
from flowforge.forgemind.forgekin import Forgekin, ForgekinType
from flowforge.forgemind.registry import ForgekinRegistry


class _DemoPlugin(FlowForgePlugin):
    manifest = PluginManifest(
        name="demo-plugin",
        version="0.0.1",
        description="demo",
    )

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[str] = []

    def register_forgekins(self, registry) -> None:
        self.calls.append("forgekins")
        registry.register(
            Forgekin(name="demo-fk", forgekin_type=ForgekinType.CUSTOM)
        )

    def register_council_channels(self, registry) -> None:
        self.calls.append("council")
        assert registry is not None


# --------------------------------------------------------------------------- #
# FlowForgePlugin base
# --------------------------------------------------------------------------- #


def test_plugin_initial_state_is_uninitialized() -> None:
    plugin = _DemoPlugin()
    assert plugin.state is PluginState.UNINITIALIZED


def test_plugin_name_version_from_manifest() -> None:
    plugin = _DemoPlugin()
    assert plugin.name == "demo-plugin"
    assert plugin.version == "0.0.1"


def test_default_manifest_values() -> None:
    manifest = PluginManifest()
    assert manifest.name == ""
    assert manifest.version == "0.1.0"
    assert manifest.priority == 100
    assert manifest.transport == "local"
    assert manifest.safety_level == "normal"
    assert manifest.tags == []
    assert manifest.dependencies == []


def test_name_falls_back_to_module_when_manifest_empty() -> None:
    class _NoManifest(FlowForgePlugin):
        pass

    plugin = _NoManifest()
    assert plugin.name == "flowforge"


# --------------------------------------------------------------------------- #
# V3 hooks — optional by default, callable with registries
# --------------------------------------------------------------------------- #


def test_v3_hooks_noop_by_default() -> None:
    class _Minimal(FlowForgePlugin):
        pass

    plugin = _Minimal()
    plugin.register_forgekins(ForgekinRegistry())
    plugin.register_forge_skills(None)
    plugin.register_council_channels(None)
    plugin.register_auto_forge_config(None)


def test_register_forgekins_registers_into_registry() -> None:
    plugin = _DemoPlugin()
    registry = ForgekinRegistry()
    plugin.register_forgekins(registry)
    assert plugin.calls == ["forgekins"]
    assert registry.count() == 1
    fk = registry.list_all()[0]
    assert isinstance(fk, Forgekin)
    assert fk.name == "demo-fk"
    assert fk.forgekin_type is ForgekinType.CUSTOM


def test_register_forgekins_raises_forgekin_error_on_duplicate() -> None:
    plugin = _DemoPlugin()
    registry = ForgekinRegistry()
    fk = Forgekin(name="demo-fk", forgekin_type=ForgekinType.CUSTOM)
    registry.register(fk)
    with pytest.raises(ForgekinError, match="already registered"):
        registry.register(fk)


def test_v2_hooks_are_noop_by_default() -> None:
    plugin = _DemoPlugin()
    plugin.register_agents(None)
    plugin.register_tools(None)
    plugin.register_workflows(None)


# --------------------------------------------------------------------------- #
# PluginRegistry (core/plugin.py) — lifecycle
# --------------------------------------------------------------------------- #


def test_registry_register_transitions_state_to_ready() -> None:
    registry = PluginRegistry()
    plugin = _DemoPlugin()
    registry.register(plugin)
    assert plugin.state is PluginState.READY
    assert registry.get("demo-plugin") is plugin


def test_registry_get_unknown_returns_none() -> None:
    registry = PluginRegistry()
    assert registry.get("bogus") is None


def test_registry_list_plugins() -> None:
    registry = PluginRegistry()
    registry.register(_DemoPlugin())
    assert registry.list_plugins() == ["demo-plugin"]


def test_registry_unregister_calls_shutdown() -> None:
    registry = PluginRegistry()
    plugin = _DemoPlugin()
    registry.register(plugin)
    registry.unregister("demo-plugin")
    assert plugin.state is PluginState.STOPPED
    assert registry.get("demo-plugin") is None
    assert registry.list_plugins() == []


def test_registry_unregister_unknown_is_noop() -> None:
    registry = PluginRegistry()
    registry.unregister("does-not-exist")
    assert registry.list_plugins() == []


def test_registry_startup_failure_marks_error() -> None:
    class _Boom(FlowForgePlugin):
        manifest = PluginManifest(name="boom-plugin")

        def on_startup(self, context: dict) -> None:
            raise RuntimeError("startup exploded")

    registry = PluginRegistry()
    plugin = _Boom()
    registry.register(plugin)
    assert plugin.state is PluginState.ERROR


# --------------------------------------------------------------------------- #
# PluginContext
# --------------------------------------------------------------------------- #


def test_plugin_context_carries_services_and_config() -> None:
    ctx = PluginContext(
        agent_registry="ar",
        tool_registry="tr",
        mode_registry="mr",
        event_bus="eb",
        scheduler="sched",
        app="app",
        config={"k": "v"},
        plugin_config={"p": "q"},
    )
    assert ctx.agent_registry == "ar"
    assert ctx.tool_registry == "tr"
    assert ctx.mode_registry == "mr"
    assert ctx.event_bus == "eb"
    assert ctx.scheduler == "sched"
    assert ctx.app == "app"
    assert ctx.config == {"k": "v"}
    assert ctx.plugin_config == {"p": "q"}


def test_plugin_context_forgekin_registry_accessor() -> None:
    fk_registry = ForgekinRegistry()
    ctx = PluginContext(
        agent_registry=None,
        tool_registry=None,
        mode_registry=None,
        event_bus=None,
        scheduler=None,
        app=None,
        forgekin_registry=fk_registry,
    )
    assert ctx.forgekin_registry is fk_registry
    assert ctx.council_registry is None


def test_plugin_context_register_service() -> None:
    ctx = PluginContext(
        agent_registry=None,
        tool_registry=None,
        mode_registry=None,
        event_bus=None,
        scheduler=None,
        app=None,
    )
    ctx.register_service("custom", {"x": 1})
    assert ctx.get_service("custom") == {"x": 1}
    assert ctx.get_service("missing") is None


# --------------------------------------------------------------------------- #
# validate_plugin_config / fill_config_defaults
# --------------------------------------------------------------------------- #


def test_validate_config_accepts_valid() -> None:
    schema = {
        "name": {"type": "string", "required": True},
        "count": {"type": "integer", "required": False, "default": 10},
    }
    ok, errors = validate_plugin_config({"name": "x"}, schema)
    assert ok is True
    assert errors == []


def test_validate_config_reports_missing_required() -> None:
    schema = {"name": {"type": "string", "required": True}}
    ok, errors = validate_plugin_config({}, schema)
    assert ok is False
    assert any("Missing required field: name" in e for e in errors)


def test_validate_config_type_mismatch() -> None:
    schema = {"count": {"type": "integer"}}
    ok, errors = validate_plugin_config({"count": "not-an-int"}, schema)
    assert ok is False
    assert any("expected type integer" in e for e in errors)


def test_validate_config_fills_default_from_config() -> None:
    schema = {"count": {"type": "integer", "default": 10}}
    cfg = {}
    ok, _ = validate_plugin_config(cfg, schema)
    assert ok is True
    assert cfg["count"] == 10


def test_fill_config_defaults_returns_new_dict() -> None:
    schema = {
        "name": {"type": "string", "default": "default-name"},
        "count": {"type": "integer", "default": 3},
    }
    cfg = {"name": "override"}
    result = fill_config_defaults(cfg, schema)
    assert result["name"] == "override"
    assert result["count"] == 3
    # original not mutated
    assert "count" not in cfg
