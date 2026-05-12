import time
from typing import Any, Dict, Optional
from core.base_tool import BaseTool, ToolInput, ToolOutput


class CacheTool(BaseTool):
    name = "cache"
    description = "内存缓存工具，支持 TTL 过期"
    parameters_schema = {
        "type": "object",
        "required": ["key"],
        "properties": {
            "key": {"type": "string"},
            "action": {"type": "string", "enum": ["get", "set", "delete"], "default": "get"},
            "value": {"type": "object"},
            "ttl": {"type": "integer", "default": 3600},
        }
    }

    _store: Dict[str, tuple] = {}

    async def execute(self, input: ToolInput) -> ToolOutput:
        key = input.params["key"]
        action = input.params.get("action", "get")

        if action == "get":
            entry = self._store.get(key)
            if entry is None:
                return ToolOutput(result={"data": None})
            value, expires_at = entry
            if time.time() > expires_at:
                del self._store[key]
                return ToolOutput(result={"data": None})
            return ToolOutput(result={"data": value})

        elif action == "set":
            value = input.params.get("value")
            ttl = input.params.get("ttl", 3600)
            self._store[key] = (value, time.time() + ttl)
            return ToolOutput(result={"status": "ok"})

        elif action == "delete":
            self._store.pop(key, None)
            return ToolOutput(result={"status": "deleted"})

        return ToolOutput(result={}, error=f"Unknown action: {action}")
