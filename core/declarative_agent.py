"""Declarative Agent Definition — No inheritance, pure configuration.

Inspired by OpenAI Agents SDK's approach: agents are defined through
declarative configuration rather than class inheritance. This reduces
boilerplate and makes agent definitions portable.

Usage:
    from flowforge.core.declarative_agent import agent, DeclarativeAgent

    # Method 1: Decorator
    @agent(
        name="content_writer",
        description="Writes high-quality content articles",
        model="DeepSeek-V4-Pro",
        tools=["web_search", "rag_search"],
        handoffs=["review_agent", "seo_agent"],
        guardrails=["content_safety"],
    )
    async def write_content(task: str, style: str = "professional") -> str:
        '''Write content based on the task.'''
        # The function body is the agent's execute logic
        ...

    # Method 2: Config dict
    writer = DeclarativeAgent.from_config({
        "name": "content_writer",
        "description": "Writes high-quality content articles",
        "model": "DeepSeek-V4-Pro",
        "tools": ["web_search", "rag_search"],
        "instructions": "You are a professional content writer...",
        "handoffs": ["review_agent", "seo_agent"],
    })

    # Method 3: YAML file
    writer = DeclarativeAgent.from_yaml("agents/content_writer.yaml")
"""

from __future__ import annotations

import asyncio
import functools
import inspect
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.base_agent import AgentInput, AgentOutput, BaseAgent
from flowforge.core.tracing import get_logger

logger = get_logger("declarative_agent")


# ── Configuration model ──────────────────────────────────────────────


class AgentConfig(BaseModel):
    """Declarative agent configuration.

    All fields are optional at the Pydantic level so that partial
    configs (e.g. from a YAML file) can be loaded and merged.
    However, ``name`` is required for a usable agent.

    Attributes:
        name: Unique agent identifier.
        description: Human-readable purpose description.
        model: Preferred LLM model (provider/model_id or short name).
        tools: List of tool names this agent can use.
        instructions: System prompt / instructions for LLM-based execution.
        handoffs: List of agent names this agent can delegate to.
        guardrails: List of guardrail names to enforce.
        metadata: Arbitrary metadata for plugins and extensions.
    """

    name: str = Field(..., description="Unique agent identifier")
    description: str = Field(default="", description="Agent purpose")
    model: Optional[str] = Field(
        default=None, description="Preferred LLM model"
    )
    tools: List[str] = Field(
        default_factory=list, description="Tool names this agent can use"
    )
    instructions: Optional[str] = Field(
        default=None, description="System prompt for LLM-based execution"
    )
    handoffs: List[str] = Field(
        default_factory=list,
        description="Agent names this agent can delegate to",
    )
    guardrails: List[str] = Field(
        default_factory=list, description="Guardrail names to enforce"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Arbitrary metadata"
    )


# ── DeclarativeAgent ─────────────────────────────────────────────────


class DeclarativeAgent(BaseAgent):
    """A BaseAgent driven purely by declarative configuration.

    If an ``execute_fn`` is provided (e.g. from the ``@agent`` decorator),
    it is used directly.  Otherwise, a default LLM-based execution is
    used: the agent's ``instructions`` and the task input are composed
    into messages and sent through :class:`ModelCapability`.

    Attributes:
        config: The :class:`AgentConfig` driving this agent.
        _execute_fn: Optional custom execute function.
        _is_async: Whether the custom execute function is async.
    """

    def __init__(
        self,
        config: AgentConfig,
        execute_fn: Optional[Callable] = None,
    ) -> None:
        self.config = config
        self.name = config.name
        self.description = config.description
        self.default_mode = None
        self._execute_fn = execute_fn
        self._is_async = (
            asyncio.iscoroutinefunction(execute_fn)
            if execute_fn is not None
            else False
        )

    async def execute(self, input: AgentInput) -> AgentOutput:
        """Execute the agent logic.

        If a custom ``execute_fn`` was provided, it is called with the
        input params as keyword arguments.  Otherwise, the default
        LLM-based execution path is used.
        """
        if self._execute_fn is not None:
            return await self._execute_custom(input)
        return await self._execute_llm(input)

    # ── Custom execution ────────────────────────────────────────────

    async def _execute_custom(self, input: AgentInput) -> AgentOutput:
        """Delegate to the user-provided execute function."""
        try:
            if self._is_async:
                result = await self._execute_fn(**input.params)
            else:
                result = self._execute_fn(**input.params)

            if isinstance(result, AgentOutput):
                return result
            if isinstance(result, dict):
                return AgentOutput(result=result)
            return AgentOutput(
                result={"result": result} if result is not None else {}
            )
        except Exception as e:
            logger.error(
                f"DeclarativeAgent '{self.name}' custom execution failed: {e}"
            )
            return AgentOutput(result={"error": str(e)})

    # ── Default LLM-based execution ─────────────────────────────────

    async def _execute_llm(self, input: AgentInput) -> AgentOutput:
        """Default execution: build messages and call LLMClient."""
        from flowforge.core.base_tool import ToolInput
        from flowforge.core.model_capability import ModelCapability

        instructions = self.config.instructions or self.description or (
            f"You are the {self.name} agent."
        )

        # Build the user message from input params
        task = input.params.get("task", input.params.get("intent", ""))
        if not task:
            task = str(input.params)[:2000]

        messages: list[dict[str, str]] = [
            {"role": "system", "content": instructions},
            {"role": "user", "content": task},
        ]

        mc = ModelCapability()
        model = self.config.model or ""

        llm_result = await mc.chat(
            prompt=task,
            system=instructions,
            model=model,
            agent_name=self.name,
        )

        result: Dict[str, Any] = {
            "content": llm_result.get("content", ""),
            "provider": llm_result.get("provider", ""),
            "model": llm_result.get("model", ""),
        }

        metadata: Dict[str, Any] = {
            "tokens": llm_result.get("tokens", 0),
            "agent_type": "declarative",
            "config_model": self.config.model,
        }

        return AgentOutput(result=result, metadata=metadata)

    # ── Factory methods ─────────────────────────────────────────────

    @classmethod
    def from_config(
        cls,
        config: dict[str, Any],
        execute_fn: Optional[Callable] = None,
    ) -> DeclarativeAgent:
        """Create a DeclarativeAgent from a config dict.

        Args:
            config: Dict matching :class:`AgentConfig` fields.
            execute_fn: Optional custom execute function.

        Returns:
            A ready-to-use :class:`DeclarativeAgent`.
        """
        agent_config = AgentConfig(**config)
        return cls(config=agent_config, execute_fn=execute_fn)

    @classmethod
    def from_yaml(
        cls,
        path: str | Path,
        execute_fn: Optional[Callable] = None,
    ) -> DeclarativeAgent:
        """Create a DeclarativeAgent from a YAML file.

        The YAML file should map directly to :class:`AgentConfig` fields.

        Args:
            path: Path to the YAML configuration file.
            execute_fn: Optional custom execute function.

        Returns:
            A ready-to-use :class:`DeclarativeAgent`.
        """
        yaml_path = Path(path)
        with open(yaml_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)

        if not isinstance(raw, dict):
            raise ValueError(
                f"YAML file {yaml_path} must contain a mapping at the top level"
            )

        agent_config = AgentConfig(**raw)
        return cls(config=agent_config, execute_fn=execute_fn)


# ── @agent decorator ─────────────────────────────────────────────────

# Module-level registry used by the @agent decorator to auto-register
# agents.  Populated by the decorator, consumed by the SDK.
_decorator_agents: Dict[str, DeclarativeAgent] = {}


def get_decorator_agents() -> Dict[str, DeclarativeAgent]:
    """Return all agents registered via the ``@agent`` decorator."""
    return dict(_decorator_agents)


def agent(
    *,
    name: str,
    description: str = "",
    model: Optional[str] = None,
    tools: Optional[List[str]] = None,
    instructions: Optional[str] = None,
    handoffs: Optional[List[str]] = None,
    guardrails: Optional[List[str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Callable:
    """Decorator that registers a function as a DeclarativeAgent.

    The decorated function becomes the agent's ``execute_fn``.  If the
    function body is a placeholder (``...``), the agent falls back to
    default LLM-based execution.

    Args:
        name: Unique agent identifier.
        description: Human-readable purpose.
        model: Preferred LLM model.
        tools: Tool names this agent can use.
        instructions: System prompt for LLM-based execution.
        handoffs: Agent names this agent can delegate to.
        guardrails: Guardrail names to enforce.
        metadata: Arbitrary metadata.

    Returns:
        The original function (unchanged), with a ``_declarative_agent``
        attribute attached for introspection.

    Example::

        @agent(name="writer", description="Content writer", model="DeepSeek-V4-Pro")
        async def write(task: str, style: str = "professional") -> str:
            ...
    """

    def decorator(func: Callable) -> Callable:
        # Detect placeholder body (Ellipsis / pass-only)
        source = inspect.getsource(func).strip()
        has_body = not (
            source.endswith("...") or source.endswith("pass")
        )

        execute_fn = func if has_body else None

        config = AgentConfig(
            name=name,
            description=description or inspect.getdoc(func) or "",
            model=model,
            tools=tools or [],
            instructions=instructions,
            handoffs=handoffs or [],
            guardrails=guardrails or [],
            metadata=metadata or {},
        )

        da = DeclarativeAgent(config=config, execute_fn=execute_fn)

        # Attach to the function for introspection
        func._declarative_agent = da  # type: ignore[attr-defined]

        # Register in the module-level registry
        _decorator_agents[name] = da
        logger.info(f"Declarative agent registered via @agent: {name}")

        return func

    return decorator
