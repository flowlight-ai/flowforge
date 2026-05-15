import subprocess
import sys
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from flowforge.app.deps import get_plugin_manager
from flowforge.core.tracing import get_trace_id, get_logger

logger = get_logger("plugins_api")

router = APIRouter(prefix="/plugins", tags=["plugins"])


def _make_response(data: dict) -> dict:
    return {
        "status": "success",
        "data": data,
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


def _make_error(code: str, message: str, details: dict = None) -> dict:
    return {
        "status": "error",
        "error": {"code": code, "message": message, "details": details or {}},
        "meta": {"trace_id": get_trace_id(), "timestamp": datetime.now(timezone.utc).isoformat() + "Z"},
    }


@router.get("")
async def list_plugins(plugin_manager=Depends(get_plugin_manager)):
    if plugin_manager is None:
        return _make_error("SERVICE_UNAVAILABLE", "Plugin manager not initialized")
    status = plugin_manager.get_status()
    plugins = []
    for category, names in status.get("loaded", {}).items():
        for name in names:
            plugins.append({"name": name, "category": category, "status": "loaded"})
    return _make_response({"plugins": plugins, "total": len(plugins)})


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


@router.post("/reload")
async def reload_plugins(plugin_manager=Depends(get_plugin_manager)):
    if plugin_manager is None:
        return _make_error("SERVICE_UNAVAILABLE", "Plugin manager not initialized")
    plugin_manager._loaded = {"modes": [], "agents": [], "tools": [], "workflows": []}
    plugin_manager._config_results = {}
    logger.info("plugins reloaded")
    return _make_response({"reloaded": True})
