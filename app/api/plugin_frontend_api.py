"""Frontend plugin API — exposes plugin UI metadata to the Next.js frontend."""

from fastapi import APIRouter, HTTPException
from flowforge.core.tracing import get_logger

logger = get_logger("api.plugin_frontend")
router = APIRouter(prefix="/plugins/frontend", tags=["plugin-frontend"])


@router.get("")
async def list_frontend_plugins():
    """List all plugins that provide frontend components."""
    from flowforge.app.main import frontend_registry
    if not frontend_registry:
        return {"plugins": []}
    return {"plugins": frontend_registry.get_all_plugins()}


@router.get("/mount/{mount_point}")
async def get_plugins_for_mount(mount_point: str):
    """Get plugins that provide components for a specific mount point."""
    from flowforge.app.main import frontend_registry
    if not frontend_registry:
        return {"plugins": [], "mount_point": mount_point}
    plugins = frontend_registry.get_plugins_for_mount(mount_point)
    return {"plugins": plugins, "mount_point": mount_point}


@router.get("/{plugin_name}")
async def get_frontend_plugin(plugin_name: str):
    """Get frontend metadata for a specific plugin."""
    from flowforge.app.main import frontend_registry
    if not frontend_registry:
        raise HTTPException(503, "Frontend registry not available")
    plugin = frontend_registry.get_plugin(plugin_name)
    if not plugin:
        raise HTTPException(404, f"Plugin '{plugin_name}' has no frontend components")
    return plugin
