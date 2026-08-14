from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from pathlib import Path

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


# ── Named Workspace Endpoints ──


@router.get("/named")
async def list_named_workspaces():
    ws = get_workspace_manager()
    workspaces = ws.list_named_workspaces()
    return {"workspaces": workspaces}


@router.post("/named")
async def create_named_workspace(payload: dict):
    name = payload.get("name", "default")
    path = payload.get("path")
    ws = get_workspace_manager()
    ws_path = ws.create_named_workspace(name, path=path)
    return {"status": "created", "name": name, "path": str(ws_path)}


@router.get("/named/{workspace_name}/tasks")
async def list_workspace_tasks(workspace_name: str):
    ws = get_workspace_manager()
    tasks = ws.list_workspace_tasks(workspace_name)
    return {"workspace": workspace_name, "tasks": tasks}


@router.delete("/named/{workspace_name}")
async def delete_named_workspace(workspace_name: str):
    ws = get_workspace_manager()
    import shutil
    ws_path = ws._base / workspace_name
    if ws_path.exists():
        shutil.rmtree(ws_path)
        return {"status": "deleted", "name": workspace_name}
    raise HTTPException(status_code=404, detail=f"Workspace not found: {workspace_name}")


# ── 开发面板端点（文件树 / 文件读取 / 命令执行） ──────────────
# 注意：必须声明在 /{task_id} 通配路由之前，否则 /tree /file /exec 会被当作 task_id


def _dev_workspace_root(ws) -> Path:
    """开发面板默认工作区根目录（default named workspace）。"""
    for meta in ws.list_named_workspaces():
        if meta.get("name") == "default":
            return Path(meta["path"])
    ws.get_default_workspace()
    return ws._base / "default"


def _build_tree(root: Path, depth: int, _current: int = 0) -> list:
    """递归构建前端 TreeNode 结构（name/path/type/children）。"""
    nodes = []
    try:
        entries = sorted(root.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except OSError:
        return nodes
    for entry in entries:
        if entry.name.startswith(".") or entry.name in ("node_modules", "__pycache__"):
            continue
        if entry.is_dir():
            node = {"name": entry.name, "path": str(entry), "type": "directory"}
            if _current < depth:
                node["children"] = _build_tree(entry, depth, _current + 1)
            nodes.append(node)
        else:
            nodes.append({"name": entry.name, "path": str(entry), "type": "file"})
    return nodes


def _ensure_inside_root(target: Path, root: Path) -> bool:
    """校验 target 位于 root 内（防目录穿越）。"""
    try:
        import os
        return os.path.commonpath([str(target), str(root)]) == str(root)
    except ValueError:
        return False


@router.get("/tree")
async def get_dev_file_tree(depth: int = 3):
    """开发面板文件树（默认工作区目录树）。"""
    ws = get_workspace_manager()
    root = _dev_workspace_root(ws)
    tree = _build_tree(root, max(0, min(depth, 6)))
    return {"tree": tree, "root": str(root)}


@router.get("/file")
async def get_dev_file(path: str):
    """读取工作区内文件内容（防目录穿越）。"""
    ws = get_workspace_manager()
    root = _dev_workspace_root(ws).resolve()
<<<<<<< HEAD
    target = Path(path)
    if not target.is_absolute():
        # 相对路径基于工作区根解析（而非进程 cwd），与 tree 返回的 path 一致
        target = root / target
    target = target.resolve()
=======
    target = Path(path).resolve()
>>>>>>> feat/multi-thread-council
    if not _ensure_inside_root(target, root):
        raise HTTPException(status_code=400, detail="Path outside workspace root")
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    content = target.read_text(encoding="utf-8", errors="replace")
    return {"path": path, "content": content, "size": target.stat().st_size}


class ExecCommandRequest(BaseModel):
    command: str
    cwd: Optional[str] = None


@router.post("/exec")
async def exec_command(payload: ExecCommandRequest, timeout: int = 30):
    """在默认工作区内执行命令（终端桥接，CLI 真实执行）。"""
    import subprocess
    ws = get_workspace_manager()
    root = _dev_workspace_root(ws).resolve()
    cwd = Path(payload.cwd).resolve() if payload.cwd else root
    if not _ensure_inside_root(cwd, root):
        raise HTTPException(status_code=400, detail="cwd outside workspace root")
    if not payload.command.strip():
        raise HTTPException(status_code=400, detail="Empty command")
    try:
        proc = subprocess.run(
            payload.command,
            shell=True,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=max(1, min(timeout, 120)),
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired as e:
        return {
            "status": "timeout",
            "stdout": e.stdout or "",
            "stderr": f"Command timed out after {timeout}s",
            "exit_code": -1,
        }
    except Exception as e:
        return {"status": "error", "stdout": "", "stderr": str(e), "exit_code": -2}
    return {"status": "done", "stdout": proc.stdout, "stderr": proc.stderr, "exit_code": proc.returncode}


# ── Legacy Workspace Endpoints ──


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
async def list_workspaces(status: str = None, limit: int = 20):
    ws = get_workspace_manager()
    # Prefer named workspaces
    named = ws.list_named_workspaces()
    if named:
        named.sort(key=lambda w: w.get("created_at", ""), reverse=True)
        return {"workspaces": named[:limit], "total": len(named)}
    # Fallback to legacy task-based workspaces
    workspaces = ws.list_workspaces(status=status)
    workspaces.sort(key=lambda w: w.get("created_at", ""), reverse=True)
    return {"workspaces": workspaces[:limit], "total": len(workspaces)}


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
    task_meta_path = Path(str(path)) / ".helm" / "task.json"
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


@router.get("/{task_id}/status")
async def get_status(task_id: str):
    """Read the current workspace/task status (GET).

    Previously this endpoint only supported POST (update). The GET method
    reads the status from the workspace's task metadata without modifying it.
    """
    ws = get_workspace_manager()
    path = ws.get_workspace_path(task_id)
    if not path:
        raise HTTPException(status_code=404, detail=f"Workspace not found: {task_id}")
    from pathlib import Path
    import json
    task_meta_path = Path(str(path)) / ".helm" / "task.json"
    task_meta = None
    if task_meta_path.exists():
        with open(task_meta_path, "r", encoding="utf-8") as f:
            task_meta = json.load(f)
    # Also check .checkpoint.json for the latest status
    checkpoint_path = Path(str(path)) / ".checkpoint.json"
    checkpoint = None
    if checkpoint_path.exists():
        with open(checkpoint_path, "r", encoding="utf-8") as f:
            checkpoint = json.load(f)
    current_status = "unknown"
    if task_meta and isinstance(task_meta, dict):
        current_status = task_meta.get("status", "unknown")
    elif checkpoint and isinstance(checkpoint, dict):
        current_status = checkpoint.get("status", "unknown")
    return {
        "task_id": task_id,
        "status": current_status,
        "task_meta": task_meta,
        "checkpoint": checkpoint,
    }


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
