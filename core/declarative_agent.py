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

        When config declares guardrails, they are checked before and
        after execution.  When config declares tools, they are resolved
        from ToolRegistry and passed to the LLM as function-calling
        tools.  When config declares handoffs, the LLM response is
        inspected for handoff signals and delegated accordingly.
        """
        # ── Input guardrails ──────────────────────────────────────
        if self.config.guardrails:
            input_text = input.params.get("task", input.params.get("intent", ""))
            if not input_text:
                input_text = str(input.params)[:2000]
            guardrail_block = await self._run_input_guardrails(input_text, input.params)
            if guardrail_block is not None:
                return guardrail_block

        # ── Core execution ────────────────────────────────────────
        if self._execute_fn is not None:
            output = await self._execute_custom(input)
        else:
            output = await self._execute_llm(input)

        # ── Output guardrails ─────────────────────────────────────
        if self.config.guardrails:
            output_text = output.result.get("content", "") if output.result else ""
            guardrail_block = await self._run_output_guardrails(output_text, output.result)
            if guardrail_block is not None:
                return guardrail_block

        # ── Handoff check ─────────────────────────────────────────
        if self.config.handoffs:
            handoff_output = await self._check_and_execute_handoff(output, input)
            if handoff_output is not None:
                return handoff_output

        return output

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
        """Default execution: build messages and call LLMClient.

        If config.tools is set, resolves each tool from ToolRegistry
        and passes their schemas as function-calling tools to the LLM.
        If the LLM returns tool_calls, executes them via ToolRegistry.
        """
        from flowforge.core.base_tool import ToolInput
        from flowforge.core.model_capability import ModelCapability

        instructions = self.config.instructions or self.description or (
            f"You are the {self.name} agent."
        )

        # Append handoff prompt to instructions if handoffs are configured
        if self.config.handoffs:
            handoff_prompt = self._build_handoff_prompt()
            if handoff_prompt:
                instructions = instructions + "\n\n" + handoff_prompt

        # Build the user message from input params
        task = input.params.get("task", input.params.get("intent", ""))
        if not task:
            task = str(input.params)[:2000]

        mc = ModelCapability()
        model = self.config.model or ""

        # Resolve tool schemas from ToolRegistry if config.tools is set
        tools_schema: Optional[list] = None
        if self.config.tools:
            tools_schema = self._resolve_tools_schema()

        llm_result = await mc.chat(
            prompt=task,
            system=instructions,
            model=model,
            agent_name=self.name,
            tools=tools_schema,
        )

        # Handle tool_calls from LLM response
        tool_calls = llm_result.get("tool_calls", [])
        tool_results: List[Dict[str, Any]] = []
        if tool_calls:
            tool_results = await self._execute_tool_calls(tool_calls)

        result: Dict[str, Any] = {
            "content": llm_result.get("content", ""),
            "provider": llm_result.get("provider", ""),
            "model": llm_result.get("model", ""),
        }
        if tool_results:
            result["tool_results"] = tool_results

        metadata: Dict[str, Any] = {
            "tokens": llm_result.get("tokens", 0),
            "agent_type": "declarative",
            "config_model": self.config.model,
        }
        if tool_calls:
            metadata["tool_calls_count"] = len(tool_calls)
        if tool_results:
            metadata["tool_results_count"] = len(tool_results)

        return AgentOutput(result=result, metadata=metadata)

    # ── Tools resolution and execution ──────────────────────────────

    def _resolve_tools_schema(self) -> list:
        """Resolve tool names from config into OpenAI function-calling schemas.

        Looks up each tool name in the ToolRegistry and extracts its
        parameters_schema.  Tools that are not found are skipped with a
        warning.
        """
        from flowforge.tools.registry import ToolRegistry

        schemas: list = []
        try:
            registry = ToolRegistry()
        except Exception:
            logger.warning(f"Agent '{self.name}': ToolRegistry not available for tool resolution")
            return schemas

        for tool_name in self.config.tools:
            try:
                tool = registry.get_tool(tool_name)
                schema = {
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "description": getattr(tool, "description", ""),
                        "parameters": getattr(tool, "parameters_schema", {}),
                    },
                }
                schemas.append(schema)
            except Exception:
                logger.warning(f"Agent '{self.name}': tool '{tool_name}' not found in ToolRegistry, skipping")

        return schemas

    async def _execute_tool_calls(self, tool_calls: list) -> List[Dict[str, Any]]:
        """Execute tool_calls returned by the LLM via ToolRegistry.

        Args:
            tool_calls: List of tool call dicts with 'name' and 'arguments'.

        Returns:
            List of result dicts from each tool execution.
        """
        from flowforge.core.base_tool import ToolInput
        from flowforge.tools.registry import ToolRegistry

        results: List[Dict[str, Any]] = []
        try:
            registry = ToolRegistry()
        except Exception:
            logger.warning(f"Agent '{self.name}': ToolRegistry not available for tool execution")
            return results

        for tc in tool_calls:
            tool_name = tc.get("name", "")
            arguments = tc.get("arguments", {})
            if isinstance(arguments, str):
                import json
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {}

            try:
                output = await registry.execute(tool_name, ToolInput(params=arguments))
                results.append({
                    "tool": tool_name,
                    "result": output.result,
                    "error": output.error,
                })
            except Exception as e:
                logger.warning(f"Agent '{self.name}': tool '{tool_name}' execution failed: {e}")
                results.append({
                    "tool": tool_name,
                    "result": {},
                    "error": str(e),
                })

        return results

    # ── Handoff support ─────────────────────────────────────────────

    def _build_handoff_prompt(self) -> str:
        """Build a prompt snippet describing available handoff targets.

        This is appended to the system instructions so the LLM knows
        when it can delegate tasks to other agents.
        """
        lines = ["You can delegate tasks to the following specialized agents:", ""]
        for target_name in self.config.handoffs:
            lines.append(f"- {target_name}")
        lines.append("")
        lines.append(
            "To delegate a task, include a line in your response in the format: "
            "[HANDOFF_TO: agent_name] followed by the task description."
        )
        return "\n".join(lines)

    async def _check_and_execute_handoff(
        self, output: AgentOutput, input: AgentInput
    ) -> Optional[AgentOutput]:
        """Check if the LLM response indicates a handoff and execute it.

        Looks for the pattern ``[HANDOFF_TO: agent_name]`` in the
        response content.  If found and the target is in config.handoffs,
        delegates execution to that agent via HandoffManager.

        Returns:
            An AgentOutput from the target agent if handoff was executed,
            or None if no handoff was detected.
        """
        import re
        from flowforge.core.handoff import Handoff, HandoffManager
        from flowforge.core.agent_registry import AgentRegistry

        content = output.result.get("content", "") if output.result else ""
        match = re.search(r"\[HANDOFF_TO:\s*(\w[\w\-]*)\]", content)
        if not match:
            return None

        target_agent = match.group(1).strip()
        if target_agent not in self.config.handoffs:
            logger.warning(
                f"Agent '{self.name}': LLM requested handoff to '{target_agent}' "
                f"but it is not in configured handoffs {self.config.handoffs}"
            )
            return None

        try:
            agent_registry = AgentRegistry()
            hm = HandoffManager(agent_registry=agent_registry)

            # Register handoffs so HandoffManager can validate
            handoffs = [Handoff(target=t, condition=f"delegated by {self.name}")
                        for t in self.config.handoffs]
            hm.register_handoffs(self.name, handoffs)

            # Extract task from content (everything after the handoff marker)
            task = content[match.end():].strip()
            if not task:
                task = input.params.get("task", input.params.get("intent", ""))

            context = dict(input.params)
            context.pop("task", None)
            context.pop("intent", None)

            result = await hm.execute_handoff(
                source_agent=self.name,
                target_agent=target_agent,
                task=task,
                context=context,
            )
            # Tag the result as coming from a handoff
            result.metadata["handoff_from"] = self.name
            result.metadata["handoff_to"] = target_agent
            return result
        except Exception as e:
            logger.error(
                f"Agent '{self.name}': handoff to '{target_agent}' failed: {e}"
            )
            return None

    # ── Guardrail support ────────────────────────────────────────────

    async def _run_input_guardrails(
        self, input_text: str, context: dict
    ) -> Optional[AgentOutput]:
        """Run input guardrails from config.guardrails.

        Returns:
            An AgentOutput with error if any guardrail blocks, or None
            if all guardrails pass.
        """
        from flowforge.core.guardrails import GuardrailRegistry, GuardrailExecutor

        try:
            registry = GuardrailRegistry()
        except Exception:
            return None

        # Filter to only the guardrails named in config
        input_guardrails = []
        for name in self.config.guardrails:
            g = registry._input_guardrails.get(name)
            if g is not None:
                input_guardrails.append(g)

        if not input_guardrails:
            return None

        executor = GuardrailExecutor(registry)
        results = await executor.run_input_guardrails(input_text, context)

        for gr in results:
            if gr.status == "blocked":
                logger.warning(
                    f"Agent '{self.name}': input blocked by guardrail: {gr.message}"
                )
                return AgentOutput(
                    result={"error": f"Input blocked by guardrail: {gr.message}", "status": "blocked"},
                    metadata={"guardrail_status": "blocked"},
                )
        return None

    async def _run_output_guardrails(
        self, output_text: str, context: dict
    ) -> Optional[AgentOutput]:
        """Run output guardrails from config.guardrails.

        Returns:
            An AgentOutput with error if any guardrail blocks, or None
            if all guardrails pass.
        """
        from flowforge.core.guardrails import GuardrailRegistry, GuardrailExecutor

        try:
            registry = GuardrailRegistry()
        except Exception:
            return None

        # Filter to only the guardrails named in config
        output_guardrails = []
        for name in self.config.guardrails:
            g = registry._output_guardrails.get(name)
            if g is not None:
                output_guardrails.append(g)

        if not output_guardrails:
            return None

        executor = GuardrailExecutor(registry)
        results = await executor.run_output_guardrails(output_text, context)

        for gr in results:
            if gr.status == "blocked":
                logger.warning(
                    f"Agent '{self.name}': output blocked by guardrail: {gr.message}"
                )
                return AgentOutput(
                    result={"error": f"Output blocked by guardrail: {gr.message}", "status": "blocked"},
                    metadata={"guardrail_status": "blocked"},
                )
        return None

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
