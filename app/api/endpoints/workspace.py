from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from flowforge.core.workspace import get_workspace_manager
from flowforge.core.tracing import get_logger

logger = get_logger("workspace_api")

router = APIRouter(prefix="/api/v1/workspace", tags=["workspace"])


class CreateWorkspaceRequest(BaseModel):
    task_id: str
    metadata: Optional[dict] = None
    workspace_dir: Optional[str] = None


class WriteFileRequest(BaseModel):
    filename: str
    content: str


class SaveCheckpointRequest(BaseModel):
    state: dict


class ValidateCommandRequest(BaseModel):
    command: str


class SaveMessageRequest(BaseModel):
    role: str = "user"
    content: str = ""
    model: Optional[str] = None


@router.post("")
async def create_workspace(payload: CreateWorkspaceRequest):
    ws = get_workspace_manager()
    if ws.get_workspace_path(payload.task_id):
        return {"status": "already_exists", "task_id": payload.task_id}
    path = ws.create_workspace(
        payload.task_id,
        metadata=payload.metadata,
        workspace_dir=payload.workspace_dir,
    )
    return {"status": "created", "task_id": payload.task_id, "path": str(path)}


@router.get("")
async def list_workspaces(status: str = None):
    ws = get_workspace_manager()
    workspaces = ws.list_workspaces(status=status)
    return {"workspaces": workspaces, "total": len(workspaces)}


@router.get("/incomplete")
async def get_incomplete_tasks():
    ws = get_workspace_manager()
    tasks = ws.get_incomplete_tasks()
    return {"tasks": tasks, "total": len(tasks)}


@router.get("/{task_id}")
async def get_workspace(task_id: str):
    ws = get_workspace_manager()
    path = ws.get_workspace_path(task_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    messages = ws.load_messages(task_id)
    context = ws.load_context(task_id)
    from pathlib import Path
    import json
    task_meta_path = Path(str(path)) / ".solo" / "task.json"
    task_meta = None
    if task_meta_path.exists():
        with open(task_meta_path, "r", encoding="utf-8") as f:
            task_meta = json.load(f)
    files = ws.list_all_files(task_id)
    return {
        "task_id": task_id,
        "workspace_path": str(path),
        "task_meta": task_meta,
        "message_count": len(messages),
        "has_context": context is not None,
        "context_saved_at": context.get("saved_at") if context else None,
        "file_count": len(files),
    }


@router.get("/{task_id}/files")
async def list_files(task_id: str, pattern: str = "*", subdir: str = ""):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    files = ws.list_all_files(task_id, pattern=pattern, subdir=subdir)
    return {"task_id": task_id, "files": files, "total": len(files)}


@router.get("/{task_id}/files/{filename:path}")
async def read_file(task_id: str, filename: str):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    content = ws.read_file(task_id, filename)
    if content is None:
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    return {"task_id": task_id, "filename": filename, "content": content}


@router.post("/{task_id}/files")
async def write_file(task_id: str, body: WriteFileRequest):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        ws.create_workspace(task_id)
    result = ws.write_file(task_id, body.filename, body.content)
    if result is None:
        raise HTTPException(status_code=400, detail="Failed to write file")
    return {"status": "written", "task_id": task_id, **result}


@router.delete("/{task_id}/files/{filename:path}")
async def delete_file(task_id: str, filename: str):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    if ws.delete_file(task_id, filename):
        return {"status": "deleted", "task_id": task_id, "filename": filename}
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


@router.get("/{task_id}/search")
async def search_files(task_id: str, query: str):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    results = ws.search_files(task_id, query)
    return {"task_id": task_id, "query": query, "results": results, "total": len(results)}


@router.post("/{task_id}/messages")
async def save_message(task_id: str, payload: SaveMessageRequest):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        ws.create_workspace(task_id)
    message = {
        "role": payload.role,
        "content": payload.content,
        "model": payload.model,
        "task_id": task_id,
    }
    ws.save_message(task_id, message)
    return {"status": "saved", "task_id": task_id}


@router.get("/{task_id}/messages")
async def get_messages(task_id: str):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    messages = ws.load_messages(task_id)
    return {"task_id": task_id, "messages": messages, "count": len(messages)}


@router.post("/{task_id}/context")
async def save_context(task_id: str, payload: dict):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        ws.create_workspace(task_id)
    ws.save_context(task_id, payload)
    return {"status": "saved", "task_id": task_id}


@router.get("/{task_id}/context")
async def get_context(task_id: str):
    ws = get_workspace_manager()
    context = ws.load_context(task_id)
    if context is None:
        raise HTTPException(status_code=404, detail="No saved context found")
    return {"task_id": task_id, "context": context}


@router.post("/{task_id}/status")
async def update_status(task_id: str, payload: dict):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    status = payload.get("status", "running")
    ws.update_task_status(task_id, status, **payload.get("metadata", {}))
    return {"status": "updated", "task_id": task_id}


@router.patch("/{task_id}")
async def update_workspace_metadata(task_id: str, payload: dict):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    updates = payload.get("updates", payload)
    result = ws.update_task_metadata(task_id, updates)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Task metadata not found: {task_id}")
    return {"status": "updated", "task_id": task_id, "metadata": result}


@router.post("/{task_id}/validate-command")
async def validate_command(task_id: str, payload: ValidateCommandRequest):
    ws = get_workspace_manager()
    result = ws.validate_command(payload.command)
    return result


@router.get("/{task_id}/checkpoint")
async def get_checkpoint(task_id: str):
    ws = get_workspace_manager()
    checkpoint = ws.load_checkpoint(task_id)
    if checkpoint is None:
        raise HTTPException(status_code=404, detail="No checkpoint found")
    return {"task_id": task_id, "checkpoint": checkpoint}


@router.post("/{task_id}/checkpoint")
async def save_checkpoint(task_id: str, body: SaveCheckpointRequest):
    ws = get_workspace_manager()
    if not ws.get_workspace_path(task_id):
        ws.create_workspace(task_id)
    ws.save_checkpoint(task_id, body.state)
    return {"status": "saved", "task_id": task_id}


@router.delete("/{task_id}")
async def delete_workspace(task_id: str):
    ws = get_workspace_manager()
    if ws.delete_workspace(task_id):
        return {"status": "deleted", "task_id": task_id}
    raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
