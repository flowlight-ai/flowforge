"""
WebProxy management API endpoints.

Provides REST API for managing the hiclaw web proxy service lifecycle,
including start, stop, status, and health check operations.
"""

from fastapi import APIRouter, HTTPException

from flowforge.tools.webproxy_service import get_webproxy_service
from flowforge.core.tracing import get_logger

logger = get_logger("webproxy_api")

router = APIRouter(prefix="/api/v1/webproxy", tags=["webproxy"])


@router.post("/start")
async def start_webproxy():
    """Start the web proxy service and wait for it to become healthy.

    The proxy service launches Playwright-driven browsers to wrap web chat
    interfaces as OpenAI-compatible APIs. This may take up to 30 seconds
    as it needs to initialize browsers and navigate to chat pages.
    """
    svc = get_webproxy_service()
    result = await svc.start_and_wait()
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result)
    if result.get("status") == "crashed":
        raise HTTPException(status_code=500, detail=result)
    return result


@router.post("/stop")
async def stop_webproxy():
    """Stop the web proxy service and close all browser instances."""
    svc = get_webproxy_service()
    result = svc.stop()
    return result


@router.get("/status")
async def webproxy_status():
    """Get the current status of the web proxy service.

    Returns information about whether the proxy is running, healthy,
    which models are available, and how long it has been up.
    """
    svc = get_webproxy_service()
    result = await svc.get_status()
    return result


@router.get("/models")
async def list_webproxy_models():
    """List models available through the web proxy service.

    Only returns models if the proxy service is currently running and healthy.
    """
    svc = get_webproxy_service()
    status = await svc.get_status()
    if not status.get("healthy"):
        raise HTTPException(
            status_code=503,
            detail="Web proxy service is not running. Start it first with POST /api/v1/webproxy/start",
        )
    return {"models": status.get("models", [])}


@router.post("/chat")
async def webproxy_chat(request: dict):
    """Send a chat completion request through the web proxy.

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

    svc = get_webproxy_service()
    kwargs = {k: v for k, v in request.items() if k not in ("model", "messages")}
    result = await svc.chat(model, messages, **kwargs)

    if result is None:
        raise HTTPException(
            status_code=503,
            detail="Web proxy service unavailable or request failed",
        )
    return result
