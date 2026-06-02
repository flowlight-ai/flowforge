"""Base agent interfaces for the FlowForge Agent OS.

This module defines the core abstractions that all agents must implement.
Every agent in the system inherits from BaseAgent and follows the
execute(input) -> output contract.

License: MIT
"""

from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from flowforge.core.task_context import TaskContext
    from flowforge.core.tool_chain_executor import ToolChainExecutor


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

    async def execute_with_tool_chain(
        self,
        input: AgentInput,
        context: 'TaskContext',
        tool_chain_executor: 'ToolChainExecutor',
        tools: Optional[List[str]] = None,
        system_prompt: Optional[str] = None,
    ) -> AgentOutput:
        prompt = system_prompt
        if not prompt:
            prompt = self.description or f"You are the {self.name} agent."
            if tools is None and context.tools:
                tool_names = [t for t in context.tools.list_tools() if t != "llm"][:5]
            elif tools:
                tool_names = tools
            else:
                tool_names = []
            if tool_names:
                prompt += "\n\nYou have access to the following tools: " + ", ".join(tool_names)
                prompt += ". Use them as needed. IMPORTANT: Give your final answer directly, do not loop."

        user_content = input.params.get("task", input.params.get("intent", ""))
        if not user_content:
            user_content = str(input.params)[:2000]

        messages = [{"role": "user", "content": user_content}]

        model_hint = context.metadata.get("model", "auto") if context.metadata else "auto"

        chain_result = await tool_chain_executor.execute(
            task_id=context.task_id,
            messages=messages,
            tools=tools[:5] if tools else None,
            system_prompt=prompt,
            model=model_hint,
            persona=context.persona or "default",
            agent_name=self.name,
        )

        result = {
            "content": chain_result.get("content", ""),
            "provider": chain_result.get("provider", ""),
            "model": chain_result.get("model", ""),
        }

        metadata = {
            "iterations": chain_result.get("iterations", 0),
            "total_tokens": chain_result.get("total_tokens", 0),
            "tool_calls_made": len(chain_result.get("execution_trace", [])),
        }

        state_updates: Dict[str, Any] = {}
        if chain_result.get("execution_trace"):
            state_updates["tool_execution_trace"] = chain_result["execution_trace"]

        return AgentOutput(result=result, metadata=metadata, state_updates=state_updates)

    def validate_input(self, input: AgentInput) -> bool:
        if not isinstance(input.params, dict) or not input.params:
            return False
        has_valid_field = False
        for key in ("task", "intent"):
            value = input.params.get(key)
            if isinstance(value, str) and value.strip():
                has_valid_field = True
                break
        if not has_valid_field:
            for value in input.params.values():
                if isinstance(value, str) and value.strip():
                    has_valid_field = True
                    break
        return has_valid_field

    def get_cost_estimate(self, input: AgentInput) -> Dict[str, Any]:
        import re
        total_chars = 0
        for value in input.params.values():
            if isinstance(value, str):
                total_chars += len(value)
            elif isinstance(value, dict):
                total_chars += len(str(value))
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', str(input.params)))
        english_words = len(re.findall(r'[a-zA-Z]+', str(input.params)))
        estimated_tokens = int(chinese_chars / 2 + english_words)
        estimated_cost = round(estimated_tokens * 0.002 / 1000, 6)
        return {"estimated_tokens": estimated_tokens, "estimated_cost": estimated_cost}
