from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional


class ToolInput(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict)


class ToolOutput(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = Field(default=None)


class BaseTool(ABC):
    name: str = "base"
    description: str = ""
    parameters_schema: Dict[str, Any] = {}
    safety_level: str = "normal"
    is_concurrency_safe: bool = True

    @abstractmethod
    async def execute(self, input: ToolInput) -> ToolOutput:
        ...

    def validate_params(self, params: Dict[str, Any]) -> bool:
        required = self.parameters_schema.get("required", [])
        for field in required:
            if field not in params:
                return False
        return True
