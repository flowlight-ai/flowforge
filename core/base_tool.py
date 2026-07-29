from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional


class ToolInput(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict)


class ToolOutput(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = Field(default=None)


class BaseTool(ABC):
    """Base class for FlowForge tools (internal).

    .. warning::
        Upper *Forge projects must NOT inherit this class directly.
        Use declarative YAML config (config/tools/*.yaml) or MCP Server
        protocol to define custom tools.
    """
    name: str = "base"
    description: str = ""
    parameters_schema: Dict[str, Any] = {}
    safety_level: str = "normal"
    is_concurrency_safe: bool = True

    @abstractmethod
    async def execute(self, input: ToolInput) -> ToolOutput:
        ...

    def to_function_call(self) -> Dict[str, Any]:
        """转换为LLM function calling格式（OpenAI tools schema）。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters_schema or {
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            },
        }

    def validate_params(self, params: Dict[str, Any]) -> bool:
        required = self.parameters_schema.get("required", [])
        for field in required:
            if field not in params:
                return False
        return True
