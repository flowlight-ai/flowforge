"""Marketplace API endpoints — plugin discovery, install, uninstall, update."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from flowforge.core.tracing import get_logger

logger = get_logger("api.marketplace")
router = APIRouter(prefix="/marketplace", tags=["marketplace"])


# ── Request/Response models ──────────────────────────────────────────


class InstallRequest(BaseModel):
    """Request body for plugin installation."""
    name: str
    version: str | None = None


class UninstallRequest(BaseModel):
    """Request body for plugin uninstallation."""
    name: str


# ── Lazy marketplace instance ────────────────────────────────────────

_marketplace_instance = None


def _get_marketplace():
    """Get or create the Marketplace singleton."""
    global _marketplace_instance
    if _marketplace_instance is None:
        from flowforge.core.marketplace import Marketplace
        from flowforge.app.deps import get_plugin_manager

        plugin_manager = None
        try:
            import asyncio
            plugin_manager = asyncio.get_event_loop().run_until_complete(
                get_plugin_manager()
            )
        except Exception:
            pass

        _marketplace_instance = Marketplace(plugin_manager=plugin_manager)
    return _marketplace_instance


# ── Endpoints ────────────────────────────────────────────────────────


@router.get("/search")
async def search_plugins(
    q: str = Query("", description="Search query keyword"),
    category: str | None = Query(None, description="Filter by category"),
):
    """Search the marketplace for plugins.

    Matches against plugin name, display name, description, and tags.
    """
    mp = _get_marketplace()
    results = await mp.search(q, category=category)
    return {
        "query": q,
        "category": category,
        "total": len(results),
        "plugins": [r.model_dump() for r in results],
    }


@router.get("/plugins/{name}")
async def get_plugin_detail(name: str):
    """Get detailed information about a specific marketplace plugin."""
    mp = _get_marketplace()
    manifest = await mp.get_plugin(name)
    if manifest is None:
        raise HTTPException(404, f"Plugin '{name}' not found in marketplace")
    return manifest.model_dump()


@router.post("/install")
async def install_plugin(request: InstallRequest):
    """Install a plugin from the marketplace.

    Performs version compatibility check, dependency resolution,
    file download, and registration with PluginManager.
    """
    mp = _get_marketplace()
    result = await mp.install(request.name, version=request.version)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("error", "Installation failed"))
    return result


@router.post("/uninstall")
async def uninstall_plugin(request: UninstallRequest):
    """Uninstall a plugin.

    Checks for dependent plugins before proceeding.
    Removes files and unregisters from PluginManager.
    """
    mp = _get_marketplace()
    result = await mp.uninstall(request.name)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("error", "Uninstallation failed"))
    return result


@router.get("/installed")
async def list_installed():
    """List all currently installed plugins."""
    mp = _get_marketplace()
    installed = await mp.list_installed()
    return {
        "total": len(installed),
        "plugins": [p.model_dump() for p in installed],
    }


@router.post("/update/{name}")
async def update_plugin(name: str):
    """Update a plugin to the latest version in the marketplace."""
    mp = _get_marketplace()
    result = await mp.update(name)
    if result.get("status") == "error":
        raise HTTPException(400, result.get("error", "Update failed"))
    return result
