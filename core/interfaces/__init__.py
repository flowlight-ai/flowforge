"""FlowForge Core Interfaces Package.

All abstract base classes and protocol definitions live here.
Upper layers (brain, workers, app) depend on these interfaces;
lower layers (tools, memory) implement them.
"""

from flowforge.core.interfaces.tools import (
    PluginHealth,
    PluginManifest,
    PluginState,
    PluginTransport,
    ToolPlugin,
)

__all__ = [
    "PluginHealth",
    "PluginManifest",
    "PluginState",
    "PluginTransport",
    "ToolPlugin",
]
