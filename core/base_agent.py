"""Base agent interfaces for the FlowForge Agent OS.

This module defines the core abstractions that all agents must implement.
Every agent in the system inherits from BaseAgent and follows the
execute(input) -> output contract.

License: MIT
"""

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from flowforge.core.task_context import TaskContext
    from flowforge.core.tool_chain_executor import ToolChainExecutor


class AgentInput(BaseModel):
    """Input model for agent execution.

    Attributes:
        params: Arbitrary key-value parameters for the agent.
        state: Optional shared state dict from the execution context.
    """
    params: dict[str, Any] = Field(default_factory=dict)
    state: dict[str, Any] | None = Field(default=None)


class AgentOutput(BaseModel):
    """Output model for agent execution.

    Attributes:
        result: The primary output of the agent.
        metadata: Optional metadata (tokens used, latency, etc.).
        state_updates: Partial state updates to merge back into the task state.
    """
    result: dict[str, Any] = Field(...)
    metadata: dict[str, Any] = Field(default_factory=dict)
    state_updates: dict[str, Any] = Field(default_factory=dict)


class BaseAgent(ABC):
    """Abstract base class for all FlowForge agents (internal).

    .. warning::
        Upper *Forge projects must NOT inherit this class directly.
        Use declarative YAML config (config/agents/*.yaml) to define
        custom agents. This class is internal to FlowForge's engine.

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
    default_mode: str | None = "react"

    def __init__(self, tool_registry=None, llm_client=None):
        self._tool_registry = tool_registry
        self._llm_client = llm_client
        self._context: TaskContext | None = None
        if 'name' not in type(self).__dict__:
            self.name = self.__class__.__name__

    async def _call_tool(self, tool_name: str, params: dict):
        """Call a tool from the registry. Returns ToolOutput."""
        from flowforge.core.base_tool import ToolInput
        tools = self._tool_registry
        if tools is None:
            raise RuntimeError(f"Tool registry not available for agent '{self.name}'")
        return await tools.execute(tool_name, ToolInput(params=params))

    async def _call_llm(self, messages: list, **kwargs) -> dict:
        """Convenience: call the LLM tool with the given messages."""
        return (await self._call_tool("llm", {"messages": messages, **kwargs})).result

    def _get_prompt(self, key: str, fallback: str = "", **kwargs) -> str:
        """Load a prompt template from PromptManager, with optional fallback."""
        try:
            from flowforge.core.prompt_manager import get_prompt
            result = get_prompt(key, **kwargs)
            if result:
                return result
        except Exception:
            pass
        if fallback and kwargs:
            try:
                return fallback.format(**kwargs)
            except (KeyError, ValueError, IndexError):
                pass
        return fallback or ""

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

        Default implementation sets up tool_registry from context and
        delegates to ``execute``.  Subclasses can override this to
        access tools, agents, event_bus, etc. from the task context.

        Args:
            input: The agent input.
            context: The full TaskContext for the current execution.

        Returns:
            An AgentOutput.
        """
        self._context = context
        if context.tools and not self._tool_registry:
            self._tool_registry = context.tools
        return await self.execute(input)

    async def execute_with_tool_chain(
        self,
        input: AgentInput,
        context: 'TaskContext',
        tool_chain_executor: 'ToolChainExecutor',
        tools: list[str] | None = None,
        system_prompt: str | None = None,
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

        state_updates: dict[str, Any] = {}
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

    def get_cost_estimate(self, input: AgentInput) -> dict[str, Any]:
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
