"""Domain plugin hot-reload management API endpoints.

These endpoints manage FlowForgePlugin instances (domain/business plugins)
loaded via the plugin protocol, supporting hot-load, unload, reload, pause,
and resume.  Delegates to PluginLifecycleManager when available.
"""

from fastapi import APIRouter, HTTPException

from flowforge.core.tracing import get_logger

logger = get_logger("api.domain_plugins")
router = APIRouter(prefix="/domain-plugins", tags=["domain-plugins"])


@router.get("")
async def list_domain_plugins():
    """List all loaded domain plugins with their status."""
    from flowforge.app.main import plugin_loader
    if plugin_loader.lifecycle_manager:
        return {"plugins": plugin_loader.lifecycle_manager.list_plugins()}
    # Fallback
    from flowforge.app.main import plugin_loader
    return {"plugins": plugin_loader.get_loaded_plugins()}


@router.get("/{plugin_name}")
async def get_domain_plugin(plugin_name: str):
    """Get detailed info about a specific domain plugin."""
    from flowforge.app.main import plugin_loader
    if plugin_loader.lifecycle_manager:
        plugin = plugin_loader.lifecycle_manager.get_plugin(plugin_name)
        if not plugin:
            raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")
        state = plugin_loader.lifecycle_manager.get_state(plugin_name)
        record = plugin_loader.lifecycle_manager.get_record(plugin_name)
        result = {
            "name": plugin.name,
            "version": plugin.version,
            "state": state.value if state else "unknown",
            "priority": plugin.manifest.priority,
            "description": plugin.manifest.description,
            "health": plugin.health_check(),
            "registered_agents": list(plugin._registered_agents),
            "registered_tools": list(plugin._registered_tools),
            "registered_event_handlers": [
                {"event_type": et} for et, _ in plugin._registered_event_handlers
            ],
            "registered_schedules": list(plugin._registered_schedules),
        }
        if record:
            result["registrations"] = record.summary()
        return result

    # Fallback
    from flowforge.app.main import plugin_loader
    for p in plugin_loader.loaded_plugins:
        if p.name == plugin_name:
            health = p.health_check()
            return {
                "name": p.name,
                "version": p.version,
                "state": p.state.value,
                "priority": p.manifest.priority,
                "description": p.manifest.description,
                "health": health,
                "registered_agents": list(p._registered_agents),
                "registered_tools": list(p._registered_tools),
                "registered_event_handlers": [
                    {"event_type": et} for et, _ in p._registered_event_handlers
                ],
                "registered_schedules": list(p._registered_schedules),
            }
    raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")


@router.post("/{plugin_name}/reload")
async def reload_domain_plugin(plugin_name: str):
    """Reload a domain plugin — unload and reload."""
    from flowforge.app.main import plugin_loader
    result = await plugin_loader.reload_plugin(plugin_name)
    if result["status"] != "success":
        raise HTTPException(status_code=400, detail=result.get("message", result.get("error", "Reload failed")))
    return result


@router.delete("/{plugin_name}")
async def unload_domain_plugin(plugin_name: str):
    """Unload a domain plugin — removes all its registrations."""
    from flowforge.app.main import plugin_loader
    result = await plugin_loader.unload_plugin(plugin_name)
    if result["status"] != "success":
        raise HTTPException(status_code=400, detail=result.get("message", result.get("error", "Unload failed")))
    return result


@router.post("/{plugin_name}/pause")
async def pause_domain_plugin(plugin_name: str):
    """Pause a domain plugin — stop events/schedules, keep agents/tools."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    result = await plugin_loader.lifecycle_manager.pause_plugin(plugin_name)
    if result.get("status") != "success":
        raise HTTPException(400, result.get("error", "Pause failed"))
    return result


@router.post("/{plugin_name}/resume")
async def resume_domain_plugin(plugin_name: str):
    """Resume a paused domain plugin."""
    from flowforge.app.main import plugin_loader
    if not plugin_loader.lifecycle_manager:
        raise HTTPException(503, "Plugin lifecycle manager not available")
    result = await plugin_loader.lifecycle_manager.resume_plugin(plugin_name)
    if result.get("status") != "success":
        raise HTTPException(400, result.get("error", "Resume failed"))
    return result


@router.get("/{plugin_name}/health")
async def domain_plugin_health(plugin_name: str):
    """Check domain plugin health status."""
    from flowforge.app.main import plugin_loader
    if plugin_loader.lifecycle_manager:
        plugin = plugin_loader.lifecycle_manager.get_plugin(plugin_name)
        if not plugin:
            raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")
        return plugin.health_check()

    # Fallback
    from flowforge.app.main import plugin_loader
    for p in plugin_loader.loaded_plugins:
        if p.name == plugin_name:
            return p.health_check()
    raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")
