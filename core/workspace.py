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

    def create_workspace(self, task_id: str, metadata: Optional[dict] = None) -> Path:
        """Create a new workspace for a task.

        Args:
            task_id: Unique task identifier.
            metadata: Optional task metadata to store.

        Returns:
            Path to the workspace root directory.
        """
        ws_path = self._base / task_id
        ws_path.mkdir(parents=True, exist_ok=True)
        (ws_path / SOLO_DIR).mkdir(exist_ok=True)
        (ws_path / FILES_DIR).mkdir(exist_ok=True)
        (ws_path / OUTPUT_DIR).mkdir(exist_ok=True)

        task_meta = {
            "task_id": task_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "running",
            "message_count": 0,
            **(metadata or {}),
        }
        self._write_json(ws_path / SOLO_DIR / TASK_FILE, task_meta)

        logger.info(f"Workspace created: {ws_path}")
        return ws_path

    def get_workspace_path(self, task_id: str) -> Optional[Path]:
        """Get the workspace path for a task, or None if not exists."""
        ws_path = self._base / task_id
        return ws_path if ws_path.exists() else None

    def get_sandbox_path(self, task_id: str) -> Path:
        """Get the sandbox directory path for file operations.

        All file read/write operations should be restricted to this directory.
        """
        ws_path = self._base / task_id / FILES_DIR
        ws_path.mkdir(parents=True, exist_ok=True)
        return ws_path

    def get_output_path(self, task_id: str) -> Path:
        """Get the output directory path for task artifacts."""
        ws_path = self._base / task_id / OUTPUT_DIR
        ws_path.mkdir(parents=True, exist_ok=True)
        return ws_path

    def validate_path(self, task_id: str, path: str) -> bool:
        """Validate that a path is within the workspace sandbox.

        Prevents path traversal attacks by checking that the resolved
        path is within the workspace boundary.

        Args:
            task_id: The task whose workspace to check against.
            path: The path to validate.

        Returns:
            True if the path is within the workspace sandbox.
        """
        ws_path = (self._base / task_id).resolve()
        target = (ws_path / path).resolve()
        return str(target).startswith(str(ws_path))

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
        """Append a chat message to the workspace's chat log.

        Messages are stored in JSONL format (one JSON object per line)
        for efficient append operations.

        Args:
            task_id: The task ID.
            message: Chat message dict with keys: role, content, timestamp, etc.
        """
        ws_path = self._base / task_id / SOLO_DIR
        ws_path.mkdir(parents=True, exist_ok=True)
        chat_path = ws_path / CHAT_FILE

        if "timestamp" not in message:
            message["timestamp"] = datetime.now(timezone.utc).isoformat()

        with open(chat_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(message, ensure_ascii=False) + "\n")

        task_meta = self._load_task_meta(task_id)
        if task_meta:
            task_meta["message_count"] = task_meta.get("message_count", 0) + 1
            task_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
            self._write_json(ws_path / TASK_FILE, task_meta)

    def load_messages(self, task_id: str) -> List[dict]:
        """Load all chat messages for a task.

        Args:
            task_id: The task ID.

        Returns:
            List of message dicts in chronological order.
        """
        chat_path = self._base / task_id / SOLO_DIR / CHAT_FILE
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
        """Save LLM context snapshot for task resume.

        Args:
            task_id: The task ID.
            context: Context dict to persist (e.g., conversation history, state).
        """
        ws_path = self._base / task_id / SOLO_DIR
        ws_path.mkdir(parents=True, exist_ok=True)
        context["saved_at"] = datetime.now(timezone.utc).isoformat()
        self._write_json(ws_path / CONTEXT_FILE, context)

    def load_context(self, task_id: str) -> Optional[dict]:
        """Load saved LLM context for task resume.

        Args:
            task_id: The task ID.

        Returns:
            Context dict or None if not found.
        """
        ctx_path = self._base / task_id / SOLO_DIR / CONTEXT_FILE
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
        ws_path = self._base / task_id / SOLO_DIR
        self._write_json(ws_path / TASK_FILE, task_meta)

    def update_task_metadata(self, task_id: str, updates: dict) -> Optional[dict]:
        """Update specific fields in task metadata.

        Args:
            task_id: The task ID.
            updates: Dict of fields to update (e.g. {"intent": "new name"}).

        Returns:
            Updated task metadata dict, or None if task not found.
        """
        task_meta = self._load_task_meta(task_id)
        if not task_meta:
            return None
        task_meta.update(updates)
        task_meta["updated_at"] = datetime.now(timezone.utc).isoformat()
        ws_path = self._base / task_id / SOLO_DIR
        self._write_json(ws_path / TASK_FILE, task_meta)
        return task_meta

    def list_workspaces(self, status: Optional[str] = None) -> List[dict]:
        """List all workspaces with their metadata.

        Args:
            status: Optional filter by task status.

        Returns:
            List of task metadata dicts, sorted by creation time (newest first).
        """
        if not self._base.exists():
            return []

        workspaces = []
        for ws_dir in self._base.iterdir():
            if not ws_dir.is_dir():
                continue
            task_meta = self._load_task_meta(ws_dir.name)
            if task_meta:
                if status and task_meta.get("status") != status:
                    continue
                task_meta["workspace_path"] = str(ws_dir)
                workspaces.append(task_meta)

        workspaces.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return workspaces

    def delete_workspace(self, task_id: str) -> bool:
        """Delete a workspace and all its contents.

        Args:
            task_id: The task ID.

        Returns:
            True if the workspace was deleted.
        """
        ws_path = self._base / task_id
        if ws_path.exists():
            shutil.rmtree(ws_path)
            logger.info(f"Workspace deleted: {ws_path}")
            return True
        return False

    def _load_task_meta(self, task_id: str) -> Optional[dict]:
        task_path = self._base / task_id / SOLO_DIR / TASK_FILE
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
