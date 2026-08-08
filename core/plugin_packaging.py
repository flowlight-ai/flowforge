"""Plugin packaging specification and discovery.

Defines the standard for packaging FlowForge plugins as Python packages
with setuptools entry points for automatic discovery.

Plugin Package Structure:
    my_plugin/
    ├── pyproject.toml          # Package metadata + entry point
    ├── my_plugin/
    │   ├── __init__.py         # Exports Plugin class
    │   └── plugin.py           # Plugin implementation
    └── README.md

pyproject.toml entry:
    [project.entry-points."flowforge.plugins"]
    my_plugin = "my_plugin:Plugin"
"""

import importlib
import importlib.metadata
from typing import Any, Dict, List, Optional

from flowforge.core.plugin_protocol import FlowForgePlugin, PluginManifest
from flowforge.core.tracing import get_logger

logger = get_logger("plugin_packaging")

ENTRY_POINT_GROUP = "flowforge.plugins"


def discover_entry_point_plugins() -> List[Dict[str, Any]]:
    """Discover plugins registered via setuptools entry points.

    Scans the 'flowforge.plugins' entry point group for installed
    Python packages that declare FlowForge plugins.

    Returns a list of dicts with 'name', 'module', 'entry_point' keys.
    """
    plugins: List[Dict[str, Any]] = []
    try:
        eps = importlib.metadata.entry_points()
        # Python 3.12+ returns a SelectableGroups, 3.9+ returns dict
        if hasattr(eps, 'select'):
            group_eps = eps.select(group=ENTRY_POINT_GROUP)
        elif isinstance(eps, dict):
            group_eps = eps.get(ENTRY_POINT_GROUP, [])
        else:
            group_eps = [ep for ep in eps if ep.group == ENTRY_POINT_GROUP]

        for ep in group_eps:
            plugins.append({
                "name": ep.name,
                "module": ep.module if hasattr(ep, 'module') else ep.value.split(":")[0],
                "entry_point": str(ep),
            })
            logger.info(f"Discovered entry point plugin: {ep.name} from {ep.value}")
    except Exception as e:
        logger.warning(f"Failed to scan entry points: {e}")

    return plugins


def load_entry_point_plugin(name: str) -> Optional[FlowForgePlugin]:
    """Load a specific plugin by its entry point name.

    Args:
        name: The entry point name (e.g., 'my_plugin')

    Returns:
        FlowForgePlugin instance or None if not found
    """
    try:
        eps = importlib.metadata.entry_points()
        if hasattr(eps, 'select'):
            group_eps = list(eps.select(group=ENTRY_POINT_GROUP, name=name))
        elif isinstance(eps, dict):
            group_eps = [ep for ep in eps.get(ENTRY_POINT_GROUP, []) if ep.name == name]
        else:
            group_eps = [ep for ep in eps if ep.group == ENTRY_POINT_GROUP and ep.name == name]

        if not group_eps:
            logger.warning(f"Entry point plugin '{name}' not found")
            return None

        ep = group_eps[0]
        plugin_cls = ep.load()

        if isinstance(plugin_cls, type) and issubclass(plugin_cls, FlowForgePlugin):
            return plugin_cls()
        else:
            logger.error(f"Entry point '{name}' does not point to a FlowForgePlugin subclass")
            return None
    except Exception as e:
        logger.error(f"Failed to load entry point plugin '{name}': {e}")
        return None
