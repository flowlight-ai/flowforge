"""FlowForge Plugin Protocol — standard extension mechanism.

Re-exports from plugin_protocol.py for canonical import path:
    from flowforge.core.plugin import FlowForgePlugin, PluginRegistry

Plugins allow projects (ContentForge, DevForge, etc.) to register
their agents, tools, routes, and workflows into FlowForge.
"""
from flowforge.core.plugin_protocol import (
    FlowForgePlugin,
    PluginContext,
    PluginManifest,
    PluginState,
    fill_config_defaults,
    validate_plugin_config,
)


class PluginRegistry:
    """Registry for FlowForge business plugins.

    Manages lifecycle of FlowForgePlugin instances (business project plugins),
    distinct from the tool-focused PluginRegistry in plugin_registry.py.
    """

    def __init__(self):
        self._plugins: dict[str, FlowForgePlugin] = {}

    def register(self, plugin: FlowForgePlugin) -> None:
        """Register a plugin and call its on_startup hook."""
        name = plugin.name
        self._plugins[name] = plugin
        plugin.state = PluginState.STARTING
        try:
            plugin.on_startup({})
            plugin.state = PluginState.READY
        except Exception as e:
            plugin.state = PluginState.ERROR
            from flowforge.core.tracing import get_logger
            get_logger("plugin_registry").error(
                f"Plugin '{name}' startup failed: {e}", exc_info=True
            )

    def get(self, name: str) -> FlowForgePlugin | None:
        """Get a plugin by name."""
        return self._plugins.get(name)

    def list_plugins(self) -> list[str]:
        """List all registered plugin names."""
        return list(self._plugins.keys())

    def unregister(self, name: str) -> None:
        """Unregister a plugin and call its on_shutdown hook."""
        if name in self._plugins:
            plugin = self._plugins[name]
            plugin.state = PluginState.STOPPING
            try:
                plugin.on_shutdown({})
            except Exception:
                pass
            plugin.state = PluginState.STOPPED
            del self._plugins[name]

    def get_all(self) -> dict[str, FlowForgePlugin]:
        """Get all registered plugins."""
        return dict(self._plugins)


__all__ = [
    "FlowForgePlugin",
    "PluginContext",
    "PluginManifest",
    "PluginRegistry",
    "PluginState",
    "validate_plugin_config",
    "fill_config_defaults",
]
