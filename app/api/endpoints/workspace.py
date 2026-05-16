"""
Workspace management API endpoints for Solo mode.

Provides REST API for managing per-task workspaces, including
workspace creation, chat message persistence, and task resume.
"""

from fastapi import APIRouter, HTTPException

from flowforge.core.workspace import get_workspace_manager
from flowforge.core.tracing import get_logger

logger = get_logger("workspace_api")

router = APIRouter(prefix="/api/v1/workspace", tags=["workspace"])


@router.post("")
async def create_workspace(payload: dict):
    """Create a new workspace for a Solo task.

    Args:
        payload: Dict with keys: task_id (required), metadata (optional).
    """
    task_id = payload.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id is required")

    ws = get_workspace_manager()
    if ws.get_workspace_path(task_id):
        return {"status": "already_exists", "task_id": task_id}

    metadata = payload.get("metadata", {})
    path = ws.create_workspace(task_id, metadata=metadata)
    return {"status": "created", "task_id": task_id, "path": str(path)}


@router.get("")
async def list_workspaces(status: str = None):
    """List all workspaces with their metadata."""
    ws = get_workspace_manager()
    workspaces = ws.list_workspaces(status=status)
    return {"workspaces": workspaces, "total": len(workspaces)}


@router.get("/{task_id}")
async def get_workspace(task_id: str):
    """Get workspace metadata for a specific task."""
    ws = get_workspace_manager()
    path = ws.get_workspace_path(task_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")

    messages = ws.load_messages(task_id)
    context = ws.load_context(task_id)
    from pathlib import Path
    task_meta_path = Path(str(path)) / ".solo" / "task.json"
    task_meta = None
    if task_meta_path.exists():
        import json
        with open(task_meta_path, "r", encoding="utf-8") as f:
            task_meta = json.load(f)

    return {
        "task_id": task_id,
        "workspace_path": str(path),
        "task_meta": task_meta,
        "message_count": len(messages),
        "has_context": context is not None,
        "context_saved_at": context.get("saved_at") if context else None,
    }


@router.post("/{task_id}/messages")
async def save_message(task_id: str, payload: dict):
    """Save a chat message to the workspace.

    Args:
        task_id: The task ID.
        payload: Message dict with keys: role, content, etc.
    """
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        ws.create_workspace(task_id)

    message = {
        "role": payload.get("role", "user"),
        "content": payload.get("content", ""),
        "model": payload.get("model"),
        "task_id": task_id,
    }
    ws.save_message(task_id, message)
    return {"status": "saved", "task_id": task_id}


@router.get("/{task_id}/messages")
async def get_messages(task_id: str):
    """Get all chat messages for a task workspace."""
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")

    messages = ws.load_messages(task_id)
    return {"task_id": task_id, "messages": messages, "count": len(messages)}


@router.post("/{task_id}/context")
async def save_context(task_id: str, payload: dict):
    """Save LLM context snapshot for task resume.

    Args:
        task_id: The task ID.
        payload: Context dict to persist.
    """
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        ws.create_workspace(task_id)

    ws.save_context(task_id, payload)
    return {"status": "saved", "task_id": task_id}


@router.get("/{task_id}/context")
async def get_context(task_id: str):
    """Load saved LLM context for task resume."""
    ws = get_workspace_manager()
    context = ws.load_context(task_id)
    if context is None:
        raise HTTPException(status_code=404, detail="No saved context found")
    return {"task_id": task_id, "context": context}


@router.post("/{task_id}/status")
async def update_status(task_id: str, payload: dict):
    """Update task status in the workspace."""
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")

    status = payload.get("status", "running")
    ws.update_task_status(task_id, status, **payload.get("metadata", {}))
    return {"status": "updated", "task_id": task_id}


@router.patch("/{task_id}")
async def update_workspace_metadata(task_id: str, payload: dict):
    """Update workspace metadata (e.g. rename task intent)."""
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")

    updates = payload.get("updates", payload)
    result = ws.update_task_metadata(task_id, updates)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Task metadata not found: {task_id}")
    return {"status": "updated", "task_id": task_id, "metadata": result}


@router.post("/{task_id}/validate-command")
async def validate_command(task_id: str, payload: dict):
    """Validate a command for dangerous patterns before execution.

    Args:
        task_id: The task ID.
        payload: Dict with key: command.
    """
    command = payload.get("command", "")
    ws = get_workspace_manager()
    result = ws.validate_command(command)
    return result


@router.delete("/{task_id}")
async def delete_workspace(task_id: str):
    """Delete a workspace and all its contents."""
    ws = get_workspace_manager()
    if ws.delete_workspace(task_id):
        return {"status": "deleted", "task_id": task_id}
    raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
