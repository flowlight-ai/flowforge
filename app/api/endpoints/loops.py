"""FlowForge Loop Engine API endpoints."""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from flowforge.memory.helm_db import get_helm_db

router = APIRouter(prefix="/api/v1", tags=["loops"])


# --- Request/Response Models ---

class CreateLoopRequest(BaseModel):
    task_id: str
    template_name: str
    overrides: Optional[dict] = None

class StopLoopRequest(BaseModel):
    reason: Optional[str] = None


# --- Helper ---

def _make_response(data, success=True):
    return {"success": success, "data": data}

def _make_error(code, message):
    return {"success": False, "error": {"code": code, "message": message}}


# --- Endpoints ---

@router.post("/loops")
async def create_loop(body: CreateLoopRequest):
    """Create a Loop instance and start execution."""
    db = get_helm_db()

    # Check template exists
    template = None
    try:
        from flowforge.loop.registry import LoopRegistry
        registry = LoopRegistry()
        template = registry.get(body.template_name)
    except Exception:
        pass

    if template is None:
        raise HTTPException(status_code=404, detail=_make_error("TEMPLATE_NOT_FOUND", f"模板 '{body.template_name}' 不存在"))

    # Merge overrides
    max_retries = template.max_retries
    if body.overrides and "max_retries" in body.overrides:
        max_retries = body.overrides["max_retries"]

    loop_id = db.create_loop(
        task_id=body.task_id,
        template_name=body.template_name,
        max_retries=max_retries,
    )

    loop = db.get_loop(loop_id)
    return _make_response(loop)


@router.get("/loops/{loop_id}")
async def get_loop(loop_id: str):
    """Query Loop execution status."""
    db = get_helm_db()
    loop = db.get_loop(loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail=_make_error("LOOP_NOT_FOUND", f"Loop '{loop_id}' 不存在"))
    return _make_response(loop)


@router.post("/loops/{loop_id}/stop")
async def stop_loop(loop_id: str, body: StopLoopRequest = None):
    """Manually stop a running Loop."""
    db = get_helm_db()
    loop = db.get_loop(loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail=_make_error("LOOP_NOT_FOUND", f"Loop '{loop_id}' 不存在"))

    if loop.get("phase") in ("completed", "failed"):
        raise HTTPException(status_code=400, detail=_make_error("ALREADY_STOPPED", f"Loop 已处于 {loop['phase']} 状态"))

    # Update phase to failed (stopped by user)
    state = json.loads(loop.get("state_json") or "{}")
    state["phase"] = "failed"
    state["stopped_by_user"] = True
    if body and body.reason:
        state["stop_reason"] = body.reason

    db.update_loop_state(loop_id, json.dumps(state, ensure_ascii=False), "failed", loop.get("attempt", 0))
    return _make_response(db.get_loop(loop_id))


@router.get("/loops/{loop_id}/history")
async def get_loop_history(loop_id: str):
    """Get Loop iteration history."""
    db = get_helm_db()
    loop = db.get_loop(loop_id)
    if loop is None:
        raise HTTPException(status_code=404, detail=_make_error("LOOP_NOT_FOUND", f"Loop '{loop_id}' 不存在"))

    iterations = db.get_loop_iterations(loop_id)
    return _make_response({"loop": loop, "iterations": iterations})


@router.get("/loop-templates")
async def list_loop_templates():
    """List available Loop templates."""
    try:
        from flowforge.loop.registry import LoopRegistry
        registry = LoopRegistry()
        templates = []
        for name in registry.list_templates():
            t = registry.get(name)
            templates.append({
                "name": t.name,
                "description": t.description,
                "version": t.version,
                "max_retries": t.max_retries,
            })
        return _make_response(templates)
    except Exception as e:
        return _make_response([])


@router.get("/loop-templates/{name}")
async def get_loop_template(name: str):
    """Get Loop template details."""
    try:
        from flowforge.loop.registry import LoopRegistry
        registry = LoopRegistry()
        template = registry.get(name)
    except Exception:
        template = None

    if template is None:
        raise HTTPException(status_code=404, detail=_make_error("TEMPLATE_NOT_FOUND", f"模板 '{name}' 不存在"))

    return _make_response(template.model_dump())
