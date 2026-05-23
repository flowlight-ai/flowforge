"""
OpenRoute management API endpoints.

Provides REST API for managing the hiclaw openroute service lifecycle,
including start, stop, status, and health check operations.

Uses PluginRegistry to access the OpenRouteService instead of the old
global singleton pattern.
"""

from fastapi import APIRouter, HTTPException

from flowforge.app.deps import get_plugin_registry
from flowforge.core.tracing import get_logger

logger = get_logger("openroute_api")

router = APIRouter(prefix="/api/v1/openroute", tags=["openroute"])


def _get_openroute_service():
    """Get the OpenRouteService from PluginRegistry."""
    registry = get_plugin_registry()
    if registry is None:
        raise HTTPException(status_code=503, detail="PluginRegistry not initialized")
    try:
        return registry.get_plugin("openroute")
    except Exception:
        raise HTTPException(status_code=503, detail="OpenRoute plugin not registered")


@router.post("/start")
async def start_openroute():
    """Start the openroute service and wait for it to become healthy.

    The openroute service launches Playwright-driven browsers to wrap web chat
    interfaces as OpenAI-compatible APIs. This may take up to 30 seconds
    as it needs to initialize browsers and navigate to chat pages.
    """
    svc = _get_openroute_service()
    result = await svc.start_and_wait()
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result)
    if result.get("status") == "crashed":
        raise HTTPException(status_code=500, detail=result)
    return result


@router.post("/stop")
async def stop_openroute():
    """Stop the openroute service and close all browser instances."""
    svc = _get_openroute_service()
    result = svc.stop()
    return result


@router.get("/status")
async def openroute_status():
    """Get the current status of the openroute service.

    Returns information about whether the openroute is running, healthy,
    which models are available, and how long it has been up.
    """
    svc = _get_openroute_service()
    result = await svc.get_status()
    return result


@router.get("/models")
async def list_openroute_models():
    """List models available through the openroute service.

    Only returns models if the openroute service is currently running and healthy.
    """
    svc = _get_openroute_service()
    status = await svc.get_status()
    if not status.get("healthy"):
        raise HTTPException(
            status_code=503,
            detail="OpenRoute service is not running. Start it first with POST /api/v1/openroute/start",
        )
    return {"models": status.get("models", [])}


@router.post("/chat")
async def openroute_chat(request: dict):
    """Send a chat completion request through the openroute.

    Args:
        request: Dict with keys 'model', 'messages', and optional 'temperature',
                 'max_tokens', etc.

    Returns:
        OpenAI-format chat completion response.
    """
    model = request.get("model", "web/chat")
    messages = request.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="messages is required")

    svc = _get_openroute_service()
    kwargs = {k: v for k, v in request.items() if k not in ("model", "messages")}
    result = await svc.chat(model, messages, **kwargs)

    if result is None:
        raise HTTPException(
            status_code=503,
            detail="OpenRoute service unavailable or request failed",
        )
    return result
