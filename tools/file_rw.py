import os
from core.base_tool import BaseTool, ToolInput, ToolOutput


class FileReadWriteTool(BaseTool):
    name = "file_rw"
    description = "受限的文件读写工具"
    parameters_schema = {
        "type": "object",
        "required": ["path", "action"],
        "properties": {
            "path": {"type": "string"},
            "action": {"type": "string", "enum": ["read", "write", "delete"]},
            "content": {"type": "string"},
        }
    }
    ALLOWED_BASE = os.path.join(os.path.dirname(__file__), "..", "data", "sandbox")

    def _validate_path(self, path: str) -> bool:
        real_base = os.path.realpath(self.ALLOWED_BASE)
        real_path = os.path.realpath(os.path.join(real_base, path))
        return real_path.startswith(real_base)

    async def execute(self, input: ToolInput) -> ToolOutput:
        action = input.params.get("action", "read")
        file_path = input.params.get("path", "")
        if not self._validate_path(file_path):
            return ToolOutput(result={}, error="Access denied: path traversal detected")

        real_base = os.path.realpath(self.ALLOWED_BASE)
        full_path = os.path.join(real_base, file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        if action == "read":
            if not os.path.exists(full_path):
                return ToolOutput(result={"content": ""})
            with open(full_path, 'r', encoding='utf-8') as f:
                return ToolOutput(result={"content": f.read()})
        elif action == "write":
            content = input.params.get("content", "")
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return ToolOutput(result={"status": "written"})
        elif action == "delete":
            if os.path.exists(full_path):
                os.remove(full_path)
                return ToolOutput(result={"status": "deleted"})
            return ToolOutput(result={"status": "not found"})
        else:
            return ToolOutput(result={}, error=f"Unknown action: {action}")
