import subprocess
import sys
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException

from flowforge.app.deps import get_plugin_manager, get_plugin_registry
from flowforge.core.tracing import get_logger, get_trace_id

logger = get_logger("plugins_api")

router = APIRouter(prefix="/plugins", tags=["plugins"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(UTC).isoformat() + "Z"},
    }


def _make_error(code: str, message: str, details: dict = None) -> dict:
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(UTC).isoformat() + "Z"},
    }


@router.get("")
async def list_plugins(
    plugin_manager=Depends(get_plugin_manager),
    plugin_registry=Depends(get_plugin_registry),
):
    """List all registered plugins from both PluginManager and PluginRegistry."""
    plugins = []

    # New PluginRegistry data
    if plugin_registry is not None:
        for manifest in plugin_registry.list_plugins():
            health = plugin_registry.get_health(manifest.name)
            plugins.append({
                "name": manifest.name,
                "category": "tool",
                "status": health.state.value,
                "transport": manifest.transport.value,
                "tags": manifest.tags,
                "description": manifest.description,
            })

    # Legacy PluginManager data
    if plugin_manager is not None:
        status = plugin_manager.get_status()
        for category, names in status.get("loaded", {}).items():
            for name in names:
                # Avoid duplicates from PluginRegistry
                if not any(p["name"] == name for p in plugins):
                    plugins.append({"name": name, "category": category, "status": "loaded"})

    return _make_response({"plugins": plugins, "total": len(plugins)})


@router.get("/{plugin_name}/health")
async def plugin_health(
    plugin_name: str,
    plugin_registry=Depends(get_plugin_registry),
):
    """Get health status for a specific plugin."""
    if plugin_registry is None:
        return _make_error("SERVICE_UNAVAILABLE", "Plugin registry not initialized")
    if not plugin_registry.has_plugin(plugin_name):
        raise HTTPException(status_code=404, detail=_make_error(
            "NOT_FOUND", f"Plugin '{plugin_name}' not found"))
    health = await plugin_registry.get_plugin(plugin_name).health_check()
    return _make_response({
        "name": plugin_name,
        "state": health.state.value,
        "message": health.message,
        "latency_ms": health.latency_ms,
        "last_check": health.last_check,
    })


@router.post("/install")
async def install_plugin(payload: dict):
    package_name = payload.get("name")
    if not package_name:
        raise HTTPException(status_code=400, detail=_make_error(
            "VALIDATION_ERROR", "Package name is required"))
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", package_name],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            logger.error(f"plugin install failed: {package_name} - {result.stderr}")
            raise HTTPException(status_code=500, detail=_make_error(
                "INSTALL_FAILED", f"Failed to install {package_name}",
                {"stderr": result.stderr[:500]}))
        logger.info(f"plugin installed: {package_name}")
        return _make_response({"installed": package_name, "stdout": result.stdout[:500]})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=_make_error(
            "INSTALL_TIMEOUT", f"Installation of {package_name} timed out"))


@router.delete("/{plugin_name}")
async def uninstall_plugin(plugin_name: str):
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "uninstall", "-y", plugin_name],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            logger.error(f"plugin uninstall failed: {plugin_name} - {result.stderr}")
            raise HTTPException(status_code=500, detail=_make_error(
                "UNINSTALL_FAILED", f"Failed to uninstall {plugin_name}",
                {"stderr": result.stderr[:500]}))
        logger.info(f"plugin uninstalled: {plugin_name}")
        return _make_response({"uninstalled": plugin_name, "stdout": result.stdout[:500]})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=_make_error(
            "UNINSTALL_TIMEOUT", f"Uninstallation of {plugin_name} timed out"))


@router.post("/{plugin_name}/execute")
async def execute_plugin(
    plugin_name: str,
    payload: dict,
    plugin_registry=Depends(get_plugin_registry),
):
    """Execute a plugin by name with the given parameters."""
    if plugin_registry is None:
        return _make_error("SERVICE_UNAVAILABLE", "Plugin registry not initialized")
    if not plugin_registry.has_plugin(plugin_name):
        raise HTTPException(status_code=404, detail=_make_error(
            "NOT_FOUND", f"Plugin '{plugin_name}' not found"))
    params = payload.get("params", {})
    try:
        result = await plugin_registry.execute(plugin_name, params)
        return _make_response({"plugin": plugin_name, "result": result})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=_make_error(
            "VALIDATION_ERROR", str(e)))
    except Exception as e:
        return _make_error("EXECUTION_ERROR", str(e))


@router.get("/{plugin_name}/frontend")
async def get_plugin_frontend(plugin_name: str):
    """Get frontend plugin metadata for dynamic loading.

    Returns the plugin's frontend_entry and mount_points so that
    the web UI can dynamically load plugin components.
    """
    from flowforge.app.main import plugin_loader

    for p in plugin_loader.loaded_plugins:
        if p.name == plugin_name:
            manifest = p.manifest
            if not manifest.frontend_entry:
                raise HTTPException(
                    status_code=404,
                    detail=_make_error(
                        "NO_FRONTEND",
                        f"Plugin '{plugin_name}' has no frontend component",
                    ),
                )
            return _make_response({
                "name": p.name,
                "version": p.version,
                "frontend_entry": manifest.frontend_entry,
                "mount_points": manifest.mount_points,
            })
    raise HTTPException(
        status_code=404,
        detail=_make_error("NOT_FOUND", f"Plugin '{plugin_name}' not found"),
    )


@router.post("/reload")
async def reload_plugins(
    plugin_manager=Depends(get_plugin_manager),
    plugin_registry=Depends(get_plugin_registry),
):
    """Reload plugins from config."""
    if plugin_registry is not None:
        await plugin_registry.shutdown_all()
        await plugin_registry.load_from_config("plugins.yaml")
        plugin_registry.start_health_monitoring()

    if plugin_manager is not None:
        plugin_manager._loaded = {"modes": [], "agents": [], "tools": [], "workflows": []}
        plugin_manager._config_results = {}

    logger.info("plugins reloaded")
    return _make_response({"reloaded": True})
