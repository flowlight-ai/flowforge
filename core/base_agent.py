"""Base agent interfaces for the FlowForge Agent OS.

This module defines the core abstractions that all agents must implement.
Every agent in the system inherits from BaseAgent and follows the
execute(input) -> output contract.

License: MIT
"""

from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional


class AgentInput(BaseModel):
    """Input model for agent execution.

    Attributes:
        params: Arbitrary key-value parameters for the agent.
        state: Optional shared state dict from the execution context.
    """
    params: Dict[str, Any] = Field(default_factory=dict)
    state: Optional[Dict[str, Any]] = Field(default=None)


class AgentOutput(BaseModel):
    """Output model for agent execution.

    Attributes:
        result: The primary output of the agent.
        metadata: Optional metadata (tokens used, latency, etc.).
        state_updates: Partial state updates to merge back into the task state.
    """
    result: Dict[str, Any] = Field(...)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    state_updates: Dict[str, Any] = Field(default_factory=dict)


class BaseAgent(ABC):
    """Abstract base class for all FlowForge agents.

    Every agent must implement the ``execute`` method which takes an
    AgentInput and returns an AgentOutput.  Agents are registered in
    the AgentRegistry and discovered by the executor at runtime.

    Class Attributes:
        name: Unique identifier for the agent.
        description: Human-readable description of the agent's purpose.
        default_mode: Suggested execution mode (e.g. "react", "workflow").
    """

    name: str = "base"
    description: str = ""
    default_mode: Optional[str] = "react"

    @abstractmethod
    async def execute(self, input: AgentInput) -> AgentOutput:
        """Execute the agent's core logic.

        Args:
            input: The agent input containing params and optional state.

        Returns:
            An AgentOutput with result, metadata, and optional state updates.
        """
        ...

    async def execute_with_context(self, input: AgentInput, context: 'TaskContext') -> AgentOutput:
        """Execute with full task context (optional override).

        Default implementation delegates to ``execute``.  Subclasses can
        override this to access tools, agents, event_bus, etc. from the
        task context.

        Args:
            input: The agent input.
            context: The full TaskContext for the current execution.

        Returns:
            An AgentOutput.
        """
        return await self.execute(input)

    def validate_input(self, input: AgentInput) -> bool:
        """Validate the input before execution.

        Args:
            input: The agent input to validate.

        Returns:
            True if the input is valid, False otherwise.
        """
        return True

    def get_cost_estimate(self, input: AgentInput) -> Dict[str, Any]:
        """Estimate the cost of executing this agent.

        Args:
            input: The agent input.

        Returns:
            A dict with 'estimated_tokens' and 'estimated_cost'.
        """
        return {"estimated_tokens": 0, "estimated_cost": 0.0}
