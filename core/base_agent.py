from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional


class AgentInput(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict)
    state: Optional[Dict[str, Any]] = Field(default=None)


class AgentOutput(BaseModel):
    result: Dict[str, Any] = Field(...)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    state_updates: Dict[str, Any] = Field(default_factory=dict)


class BaseAgent(ABC):
    name: str = "base"
    description: str = ""
    default_mode: Optional[str] = "react"

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        pass

    async def execute_with_context(self, input: AgentInput, context: 'TaskContext') -> AgentOutput:
        return await self.execute(input)

    def validate_input(self, input: AgentInput) -> bool:
        return True

    def get_cost_estimate(self, input: AgentInput) -> Dict[str, Any]:
        return {"estimated_tokens": 0, "estimated_cost": 0.0}
