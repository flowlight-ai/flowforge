"""Frontend plugin extension — server-side support for UI plugins.

Provides:
- Plugin manifest declaration of frontend resources
- Server API to expose frontend plugin metadata
- Component registry for mount point rendering

Frontend plugins declare their UI components in the manifest:
    manifest = PluginManifest(
        name="my_plugin",
        frontend_entry="my-plugin/dist/index.js",
        mount_points=["sidebar", "toolbar", "settings"],
    )

The server exposes this metadata via API, and the Next.js frontend
uses a dynamic loader to render plugin components at mount points.
"""

from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("plugin_frontend")


class FrontendPluginRegistry:
    """Registry for frontend plugin components.

    Tracks which plugins provide frontend components and at which
    mount points, so the Next.js app can dynamically load them.
    """

    # Standard mount points
    MOUNT_SIDEBAR = "sidebar"
    MOUNT_TOOLBAR = "toolbar"
    MOUNT_SETTINGS = "settings"
    MOUNT_DASHBOARD = "dashboard"
    MOUNT_TASK_PANEL = "task_panel"
    MOUNT_REVIEW_PANEL = "review_panel"

    def __init__(self):
        self._plugins: dict[str, dict[str, Any]] = {}

    def register(self, plugin_name: str, manifest: Any) -> None:
        """Register a plugin's frontend metadata.

        Only registers if the manifest has a frontend_entry defined.
        """
        frontend_entry = getattr(manifest, "frontend_entry", "")
        mount_points = getattr(manifest, "mount_points", []) or []

        if not frontend_entry:
            return

        self._plugins[plugin_name] = {
            "name": plugin_name,
            "entry": frontend_entry,
            "mount_points": mount_points,
            "version": getattr(manifest, "version", "0.1.0"),
        }
        logger.info(f"[frontend] Registered plugin UI: {plugin_name} at {mount_points}")

    def unregister(self, plugin_name: str) -> None:
        """Remove a plugin's frontend metadata."""
        if plugin_name in self._plugins:
            del self._plugins[plugin_name]

    def get_plugins_for_mount(self, mount_point: str) -> list[dict[str, Any]]:
        """Get all plugins that provide components for a specific mount point."""
        return [
            p for p in self._plugins.values()
            if mount_point in p.get("mount_points", [])
        ]

    def get_all_plugins(self) -> list[dict[str, Any]]:
        """Get all registered frontend plugins."""
        return list(self._plugins.values())

    def get_plugin(self, plugin_name: str) -> dict[str, Any] | None:
        """Get frontend metadata for a specific plugin."""
        return self._plugins.get(plugin_name)
