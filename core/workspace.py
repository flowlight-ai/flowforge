"""
Solo Workspace Manager for FlowForge.

Provides per-task workspace isolation with file access control and
sandbox execution, inspired by Trae SOLO's workspace and sandbox design.

Each Solo task gets an independent workspace directory under `data/workspaces/`.
All file operations and command executions are restricted to the workspace boundary.

Workspace structure:
    data/workspaces/{task_id}/
    ├── .solo/              # Solo metadata (chat history, task state)
    │   ├── chat.jsonl      # Chat messages (append-only log)
    │   ├── task.json       # Task metadata and state
    │   └── context.json    # LLM context snapshot for resume
    ├── files/              # User/agent generated files
    └── output/             # Task output artifacts

Usage:
    ws = WorkspaceManager()
    ws.create_workspace(task_id)
    ws.save_message(task_id, {"role": "user", "content": "hello"})
    messages = ws.load_messages(task_id)
    sandbox_path = ws.get_sandbox_path(task_id)
"""

import json
import os
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from flowforge.core.tracing import get_logger

logger = get_logger("workspace")

WORKSPACE_BASE = Path("data/workspaces")
SOLO_DIR = ".solo"
CHAT_FILE = "chat.jsonl"
TASK_FILE = "task.json"
CONTEXT_FILE = "context.json"
FILES_DIR = "files"
OUTPUT_DIR = "output"

DANGEROUS_COMMANDS = {
    "rm -rf /", "del /s /q C:\\", "format", "mkfs",
    "dd if=", "> /dev/sd", "shutdown", "reboot",
    ":(){ :|:& };:", "chmod -R 777 /", "chown -R",
}

DANGEROUS_PATTERNS = [
    "rm -rf /", "del /s /q C:\\", "format ", "mkfs.",
    "dd if=", "shutdown ", "reboot ",
    "chmod 777 /", "chown -R /",
    "wget.*|.*sh", "curl.*|.*sh",
    "> /etc/", ">> /etc/",
    "pip install.*--user", "npm install -g",
]


class WorkspaceManager:
    """Manages per-task workspace directories with sandbox isolation.

    Each Solo task gets an isolated workspace directory. File operations
    are restricted to the workspace boundary, and command execution is
    subject to dangerous command interception.

    Attributes:
        _base: Root directory for all workspaces.
    """

    def __init__(self, base: Optional[Path] = None):
        self._base = base or WORKSPACE_BASE
        self._base.mkdir(parents=True, exist_ok=True)
        self._dir_map: Dict[str, Path] = {}

    def create_workspace(self, task_id: str, metadata: Optional[dict] = None, workspace_dir: Optional[str] = None) -> Path:
        ws_path = Path(workspace_dir) if workspace_dir else self._base / task_id
        ws_path.mkdir(parents=True, exist_ok=True)
        (ws_path / SOLO_DIR).mkdir(exist_ok=True)
        (ws_path / FILES_DIR).mkdir(exist_ok=True)
        (ws_path / OUTPUT_DIR).mkdir(exist_ok=True)

        task_meta = {
            "task_id": task_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "running",
            "message_count": 0,
            "workspace_dir": workspace_dir,
            **(metadata or {}),
        }
        self._write_json(ws_path / SOLO_DIR / TASK_FILE, task_meta)

        if workspace_dir:
            self._dir_map[task_id] = ws_path

        logger.info(f"Workspace created: {ws_path}")
        return ws_path

    def get_workspace_path(self, task_id: str) -> Optional[Path]:
        if task_id in self._dir_map:
            p = self._dir_map[task_id]
            return p if p.exists() else None
        ws_path = self._base / task_id
        return ws_path if ws_path.exists() else None

    def get_sandbox_path(self, task_id: str) -> Path:
        ws_path = self._resolve_ws_path(task_id) or self._base / task_id
        sandbox = ws_path / FILES_DIR
        sandbox.mkdir(parents=True, exist_ok=True)
        return sandbox

    def get_output_path(self, task_id: str) -> Path:
        ws_path = self._resolve_ws_path(task_id) or self._base / task_id
        output = ws_path / OUTPUT_DIR
        output.mkdir(parents=True, exist_ok=True)
        return output

    def save_output_file(self, task_id: str, filename: str, content: str,
                          metadata: Optional[dict] = None) -> Optional[dict]:
        """Save content as a workspace output file.

        Args:
            task_id: The task ID.
            filename: Output filename (e.g., 'article.md').
            content: File content.
            metadata: Optional file metadata (e.g., mime_type, size_hint).

        Returns:
            File info dict: {path, size, filename, mtime} or None on error.
        """
        try:
            output_dir = self.get_output_path(task_id)
            safe_name = filename.replace("..", "").replace("/", "_").replace("\\", "_")
            file_path = output_dir / safe_name
            file_path.write_text(content, encoding="utf-8")
            mtime = file_path.stat().st_mtime
            ws_path = self._resolve_ws_path(task_id) or self._base / task_id
            try:
                rel_path = str(file_path.relative_to(ws_path))
            except ValueError:
                rel_path = str(file_path)
            return {
                "filename": safe_name,
                "path": rel_path,
                "size": file_path.stat().st_size,
                "mtime": mtime,
                **({} if metadata is None else metadata),
            }
        except Exception as e:
            logger.error(f"Failed to save output file {filename} for task {task_id}: {e}")
            return None

    def save_content_file(self, task_id: str, filename: str, content: str) -> Optional[dict]:
        """Save generated content as a workspace file.
        
        Shortcut for save_output_file with content-specific metadata."""
        mime_type = "text/markdown" if filename.endswith(".md") else "text/plain"
        return self.save_output_file(task_id, filename, content, {
            "mime_type": mime_type,
            "type": "generated_content",
        })

    def validate_path(self, task_id: str, path: str) -> bool:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return False
        ws_resolved = ws_path.resolve()
        target = (ws_resolved / path).resolve()
        return str(target).startswith(str(ws_resolved))

    def validate_command(self, command: str) -> dict:
        """Validate a command for dangerous patterns.

        Checks the command against a list of dangerous patterns
        and returns whether it's safe to execute.

        Args:
            command: The command string to validate.

        Returns:
            dict with keys: safe, reason, blocked_pattern.
        """
        command_lower = command.lower().strip()
        for pattern in DANGEROUS_PATTERNS:
            if pattern.lower() in command_lower:
                return {
                    "safe": False,
                    "reason": f"Blocked dangerous pattern: {pattern}",
                    "blocked_pattern": pattern,
                }
        return {"safe": True, "reason": "", "blocked_pattern": ""}

    def save_message(self, task_id: str, message: dict) -> None:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return
        solo_dir = ws_path / SOLO_DIR
        solo_dir.mkdir(parents=True, exist_ok=True)
        chat_path = solo_dir / CHAT_FILE

        if "timestamp" not in message:
            message["timestamp"] = datetime.now(timezone.utc).isoformat()

        with open(chat_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(message, ensure_ascii=False) + "\n")

        task_meta = self._load_task_meta(task_id)
        if task_meta:
            task_meta["message_count"] = task_meta.get("message_count", 0) + 1
            task_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._write_json(solo_dir / TASK_FILE, task_meta)

    def load_messages(self, task_id: str) -> List[dict]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return []
        chat_path = ws_path / SOLO_DIR / CHAT_FILE
        if not chat_path.exists():
            return []

        messages = []
        with open(chat_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        messages.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        return messages

    def save_context(self, task_id: str, context: dict) -> None:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return
        solo_dir = ws_path / SOLO_DIR
        solo_dir.mkdir(parents=True, exist_ok=True)
        context["saved_at"] = datetime.now(timezone.utc).isoformat()
        self._write_json(solo_dir / CONTEXT_FILE, context)

    def load_context(self, task_id: str) -> Optional[dict]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return None
        ctx_path = ws_path / SOLO_DIR / CONTEXT_FILE
        if not ctx_path.exists():
            return None
        return self._load_json(ctx_path)

    def update_task_status(self, task_id: str, status: str, **kwargs) -> None:
        """Update task status and metadata.

        Args:
            task_id: The task ID.
            status: New status string (running/completed/error/paused).
            **kwargs: Additional metadata to update.
        """
        task_meta = self._load_task_meta(task_id)
        if not task_meta:
            return
        task_meta["status"] = status
        task_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        task_meta.update(kwargs)
        ws_path = self._resolve_ws_path(task_id)
        if ws_path:
            self._write_json(ws_path / SOLO_DIR / TASK_FILE, task_meta)

    def update_task_metadata(self, task_id: str, updates: dict) -> Optional[dict]:
        task_meta = self._load_task_meta(task_id)
        if not task_meta:
            return None
        task_meta.update(updates)
        task_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        ws_path = self._resolve_ws_path(task_id)
        if ws_path:
            self._write_json(ws_path / SOLO_DIR / TASK_FILE, task_meta)
        return task_meta

    def list_workspaces(self, status: Optional[str] = None) -> List[dict]:
        if not self._base.exists():
            return []

        workspaces = []
        seen_ids = set()
        for ws_dir in self._base.iterdir():
            if not ws_dir.is_dir():
                continue
            task_meta = self._load_task_meta(ws_dir.name)
            if task_meta:
                seen_ids.add(ws_dir.name)
                if status and task_meta.get("status") != status:
                    continue
                task_meta["workspace_path"] = str(ws_dir)
                workspaces.append(task_meta)

        for task_id, ws_path in self._dir_map.items():
            if task_id in seen_ids:
                continue
            task_meta = self._load_task_meta(task_id)
            if task_meta:
                if status and task_meta.get("status") != status:
                    continue
                task_meta["workspace_path"] = str(ws_path)
                workspaces.append(task_meta)

        workspaces.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return workspaces

    def delete_workspace(self, task_id: str) -> bool:
        ws_path = self._base / task_id
        if ws_path.exists():
            shutil.rmtree(ws_path)
            logger.info(f"Workspace deleted: {ws_path}")
            self._dir_map.pop(task_id, None)
            return True
        custom = self._dir_map.pop(task_id, None)
        if custom and custom.exists():
            shutil.rmtree(custom)
            logger.info(f"Workspace deleted: {custom}")
            return True
        return False

    def _resolve_ws_path(self, task_id: str) -> Optional[Path]:
        if task_id in self._dir_map:
            return self._dir_map[task_id]
        ws_path = self._base / task_id
        return ws_path if ws_path.exists() else None

    def read_file(self, task_id: str, filename: str) -> Optional[str]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return None
        filepath = ws_path / filename
        if not filepath.exists() or not filepath.is_file():
            return None
        resolved = filepath.resolve()
        ws_resolved = ws_path.resolve()
        if not str(resolved).startswith(str(ws_resolved)):
            return None
        try:
            return filepath.read_text(encoding="utf-8")
        except Exception:
            return None

    def list_all_files(self, task_id: str, pattern: str = "*", subdir: str = "") -> List[dict]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return []
        search_dir = ws_path / subdir if subdir else ws_path
        if not search_dir.exists():
            return []
        resolved = search_dir.resolve()
        ws_resolved = ws_path.resolve()
        if not str(resolved).startswith(str(ws_resolved)):
            return []
        results = []
        for entry in search_dir.rglob(pattern):
            if entry.is_file() and SOLO_DIR not in entry.parts:
                rel = entry.relative_to(ws_path)
                stat = entry.stat()
                results.append({
                    "name": entry.name,
                    "path": str(rel),
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "is_dir": False,
                })
        results.sort(key=lambda x: x["path"])
        return results

    def search_files(self, task_id: str, query: str) -> List[dict]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return []
        results = []
        query_lower = query.lower()
        for entry in ws_path.rglob("*"):
            if not entry.is_file() or SOLO_DIR in entry.parts:
                continue
            try:
                content = entry.read_text(encoding="utf-8")
                count = content.lower().count(query_lower)
                if count > 0:
                    rel = entry.relative_to(ws_path)
                    results.append({
                        "name": entry.name,
                        "path": str(rel),
                        "matches": count,
                        "size": entry.stat().st_size,
                    })
            except Exception:
                continue
        results.sort(key=lambda x: x["matches"], reverse=True)
        return results

    def write_file(self, task_id: str, filename: str, content: str) -> Optional[dict]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return None
        safe_name = filename.replace("..", "").replace("\\", "_")
        filepath = ws_path / safe_name
        resolved = filepath.resolve()
        ws_resolved = ws_path.resolve()
        if not str(resolved).startswith(str(ws_resolved)):
            return None
        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text(content, encoding="utf-8")
        stat = filepath.stat()
        return {
            "filename": safe_name,
            "path": str(filepath.relative_to(ws_path)),
            "size": stat.st_size,
            "mtime": stat.st_mtime,
        }

    def delete_file(self, task_id: str, filename: str) -> bool:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return False
        filepath = ws_path / filename
        resolved = filepath.resolve()
        ws_resolved = ws_path.resolve()
        if not str(resolved).startswith(str(ws_resolved)):
            return False
        if filepath.exists():
            filepath.unlink()
            return True
        return False

    def save_checkpoint(self, task_id: str, state: dict) -> None:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return
        ws_path.mkdir(parents=True, exist_ok=True)
        state["saved_at"] = datetime.now(timezone.utc).isoformat()
        self._write_json(ws_path / ".checkpoint.json", state)

    def load_checkpoint(self, task_id: str) -> Optional[dict]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return None
        cp_path = ws_path / ".checkpoint.json"
        if not cp_path.exists():
            return None
        return self._load_json(cp_path)

    def get_incomplete_tasks(self) -> List[dict]:
        results = []
        if not self._base.exists():
            return results
        for ws_dir in self._base.iterdir():
            if not ws_dir.is_dir():
                continue
            task_meta = self._load_task_meta(ws_dir.name)
            if task_meta and task_meta.get("status") in ("running", "paused"):
                results.append(task_meta)
        return results

    def _load_task_meta(self, task_id: str) -> Optional[dict]:
        ws_path = self._resolve_ws_path(task_id)
        if not ws_path:
            return None
        task_path = ws_path / SOLO_DIR / TASK_FILE
        if not task_path.exists():
            return None
        return self._load_json(task_path)

    def _write_json(self, path: Path, data: dict) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _load_json(self, path: Path) -> Optional[dict]:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return None


_workspace_manager: Optional[WorkspaceManager] = None


def get_workspace_manager() -> WorkspaceManager:
    """Get or create the global WorkspaceManager singleton."""
    global _workspace_manager
    if _workspace_manager is None:
        _workspace_manager = WorkspaceManager()
    return _workspace_manager
