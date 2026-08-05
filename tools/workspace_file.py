import os

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput


class WorkspaceFileTool(BaseTool):
    name = "workspace_file"
    description = "任务工作区文件操作：read/write/list/delete/mkdir/exists"
    parameters_schema = {
        "type": "object",
        "required": ["action", "path"],
        "properties": {
            "action": {"type": "string", "enum": ["read", "write", "list", "delete", "mkdir", "exists"], "description": "操作类型"},
            "path": {"type": "string", "description": "文件相对路径"},
            "content": {"type": "string", "description": "写入内容（action=write时必填）"},
        }
    }

    WORKSPACE_BASE = os.path.join(os.path.dirname(__file__), "..", "data", "workspace")

    def _resolve(self, path: str) -> tuple[str | None, str | None]:
        base = os.path.realpath(self.WORKSPACE_BASE)
        full = os.path.realpath(os.path.join(base, path))
        if not full.startswith(base):
            return None, "Path traversal detected"
        return full, None

    def _is_binary(self, file_path: str) -> bool:
        try:
            with open(file_path, "rb") as f:
                chunk = f.read(8192)
            return b"\x00" in chunk
        except Exception:
            return False

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params["action"]
        rel_path = input.params.get("path", "")

        full_path, err = self._resolve(rel_path)
        if err:
            return ToolOutput(result={}, error=err)

        if action == "read":
            if not os.path.exists(full_path):
                return ToolOutput(result={"content": "", "exists": False})
            if os.path.isdir(full_path):
                return ToolOutput(result={}, error="Path is a directory, use 'list' action")
            if self._is_binary(full_path):
                return ToolOutput(result={}, error="Binary file detected, cannot read as text")
            with open(full_path, encoding="utf-8") as f:
                content = f.read()
            return ToolOutput(result={"content": content, "exists": True})

        elif action == "write":
            content = input.params.get("content", "")
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
            return ToolOutput(result={"status": "written", "path": rel_path})

        elif action == "list":
            if not os.path.exists(full_path):
                return ToolOutput(result={"entries": []})
            entries = []
            for entry in os.scandir(full_path):
                entries.append({
                    "name": entry.name,
                    "type": "directory" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else 0,
                })
            entries.sort(key=lambda e: (e["type"] != "directory", e["name"]))
            return ToolOutput(result={"entries": entries})

        elif action == "delete":
            if not os.path.exists(full_path):
                return ToolOutput(result={"status": "not found"})
            if os.path.isdir(full_path):
                os.rmdir(full_path)
            else:
                os.remove(full_path)
            return ToolOutput(result={"status": "deleted"})

        elif action == "mkdir":
            os.makedirs(full_path, exist_ok=True)
            return ToolOutput(result={"status": "created", "path": rel_path})

        elif action == "exists":
            exists = os.path.exists(full_path)
            is_dir = os.path.isdir(full_path) if exists else False
            return ToolOutput(result={"exists": exists, "is_directory": is_dir})

        else:
            return ToolOutput(result={}, error=f"Unknown action: {action}")
