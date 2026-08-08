"""Plugin management API endpoints — hot load, unload, reload, pause, resume."""

from fastapi import APIRouter, HTTPException

from flowforge.core.tracing import get_logger

logger = get_logger("api.plugin_management")
router = APIRouter(prefix="/plugin-management", tags=["plugin-management"])


@router.get("")
async def list_plugins():
    """List all loaded plugins with their state and health."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    return {"plugins": plugin_loader.lifecycle_manager.list_plugins()}


@router.get("/{plugin_name}")
async def get_plugin(plugin_name: str):
    """Get detailed info about a specific plugin."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    plugin = plugin_loader.lifecycle_manager.get_plugin(plugin_name)
    if not plugin:
        raise HTTPException(404, f"Plugin '{plugin_name}' not found")
    return {
        "name": plugin.name,
        "version": plugin.version,
        "state": plugin_loader.lifecycle_manager.get_state(plugin_name).value if plugin_loader.lifecycle_manager.get_state(plugin_name) else "unknown",
        "health": plugin.health_check(),
        "manifest": {
            "description": plugin.manifest.description,
            "priority": plugin.manifest.priority,
            "dependencies": plugin.manifest.dependencies,
        },
    }


@router.post("/{plugin_name}/reload")
async def reload_plugin(plugin_name: str):
    """Reload a plugin (unload + load)."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    result = await plugin_loader.lifecycle_manager.reload_plugin(plugin_name)
    if result.get("status") != "success":
        raise HTTPException(500, result.get("error", "Reload failed"))
    return result


@router.delete("/{plugin_name}")
async def unload_plugin(plugin_name: str):
    """Unload a plugin (remove all registrations)."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    result = await plugin_loader.lifecycle_manager.unload_plugin(plugin_name)
    if result.get("status") != "success":
        raise HTTPException(500, result.get("error", "Unload failed"))
    return result


@router.post("/{plugin_name}/pause")
async def pause_plugin(plugin_name: str):
    """Pause a plugin (stop events/schedules, keep agents/tools)."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    result = await plugin_loader.lifecycle_manager.pause_plugin(plugin_name)
    if result.get("status") != "success":
        raise HTTPException(500, result.get("error", "Pause failed"))
    return result


@router.post("/{plugin_name}/resume")
async def resume_plugin(plugin_name: str):
    """Resume a paused plugin."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    result = await plugin_loader.lifecycle_manager.resume_plugin(plugin_name)
    if result.get("status") != "success":
        raise HTTPException(500, result.get("error", "Resume failed"))
    return result


@router.get("/{plugin_name}/health")
async def plugin_health(plugin_name: str):
    """Check a plugin's health status."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    plugin = plugin_loader.lifecycle_manager.get_plugin(plugin_name)
    if not plugin:
        raise HTTPException(404, f"Plugin '{plugin_name}' not found")
    return plugin.health_check()
