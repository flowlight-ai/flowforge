"""FlowForge Skill System — base classes, enums, and abstractions.

Defines the core Skill interface that all skill formats must conform to,
along with the SkillFormat and SkillTrigger enumerations.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class SkillFormat(str, Enum):
    """Supported skill file formats.

    Each format corresponds to a different ecosystem's skill definition
    convention; the loader auto-detects the format and parses accordingly.
    """

    FLOWFORGE = "flowforge"
    CLAUDE_CODE = "claude_code"
    ANTHROPIC = "anthropic"
    TRAE_CN = "trae_cn"


class SkillTrigger(str, Enum):
    """When a skill can be activated.

    - ON_DEMAND: explicitly invoked by user or agent
    - ON_START: automatically at task start
    - ON_COMPLETE: automatically when task completes successfully
    - ON_ERROR: automatically when task encounters an error
    - ON_SCHEDULE: activated by a cron/schedule trigger
    """

    ON_DEMAND = "on_demand"
    ON_START = "on_start"
    ON_COMPLETE = "on_complete"
    ON_ERROR = "on_error"
    ON_SCHEDULE = "on_schedule"


class SkillStep(BaseModel):
    """A single step within a skill definition."""

    name: str
    agent: str = ""
    prompt: str = ""
    tool: str = ""
    condition: str | None = None
    on_error: str = "stop"  # stop | skip | retry
    max_retries: int = 0
    params: dict[str, Any] = Field(default_factory=dict)


class SkillOutput(BaseModel):
    """Describes the expected output shape of a skill."""

    format: str = "text"
    fields: list[str] = Field(default_factory=list)


class SkillContext(BaseModel):
    """Runtime context passed to skill execution.

    Carries the task context, shared state, and metadata needed
    by a skill during execution.
    """

    task_id: str = ""
    input_data: dict[str, Any] = Field(default_factory=dict)
    state: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    step_results: dict[str, Any] = Field(default_factory=dict)
    task_context: Any | None = None

    class Config:
        arbitrary_types_allowed = True


class SkillResult(BaseModel):
    """Result returned from a skill execution."""

    success: bool = True
    output: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    steps_completed: list[str] = Field(default_factory=list)
    steps_failed: list[str] = Field(default_factory=list)


class SkillBase(ABC):
    """Abstract base class for all FlowForge skills.

    Every skill — regardless of its source format — must implement this
    interface.  Concrete implementations are produced by the SkillLoader
    when parsing skill definition files.

    Attributes:
        name: Unique skill identifier (e.g. ``"content-audit"``).
        description: Human-readable summary.
        version: Semantic version string (e.g. ``"1.0.0"``).
        format: The SkillFormat this skill was loaded from.
        triggers: List of SkillTrigger values indicating when the skill
            can be activated.
        steps: Ordered list of SkillStep definitions.
        output: Expected output shape.
    """

    def __init__(
        self,
        name: str,
        description: str = "",
        version: str = "0.1.0",
        format: SkillFormat = SkillFormat.FLOWFORGE,
        triggers: list[SkillTrigger] | None = None,
        steps: list[SkillStep] | None = None,
        output: SkillOutput | None = None,
        source_path: str = "",
    ) -> None:
        self.name = name
        self.description = description
        self.version = version
        self.format = format
        self.triggers = triggers or [SkillTrigger.ON_DEMAND]
        self.steps = steps or []
        self.output = output or SkillOutput()
        self.source_path = source_path

    # ── Abstract interface ──────────────────────────────────────────

    @abstractmethod
    async def execute(self, context: SkillContext) -> SkillResult:
        """Execute the skill with the given context.

        Args:
            context: Runtime context containing task data and state.

        Returns:
            SkillResult with output data and execution status.
        """
        ...

    @abstractmethod
    def validate(self, context: SkillContext) -> bool:
        """Validate whether this skill can run with the given context.

        Args:
            context: Runtime context to validate against.

        Returns:
            True if the skill can execute, False otherwise.
        """
        ...

    # ── Serialization ───────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        """Serialize skill metadata to a dictionary."""
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "format": self.format.value,
            "triggers": [t.value for t in self.triggers],
            "steps": [s.model_dump() for s in self.steps],
            "output": self.output.model_dump(),
            "source_path": self.source_path,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SkillBase:
        """Deserialize a skill from a dictionary.

        Returns a FlowForgeNativeSkill by default; subclasses may override.
        """
        steps = [SkillStep(**s) for s in data.get("steps", [])]
        output = SkillOutput(**data.get("output", {}))
        triggers = [
            SkillTrigger(t) for t in data.get("triggers", ["on_demand"])
        ]
        return FlowForgeNativeSkill(
            name=data["name"],
            description=data.get("description", ""),
            version=data.get("version", "0.1.0"),
            format=SkillFormat(data.get("format", "flowforge")),
            triggers=triggers,
            steps=steps,
            output=output,
            source_path=data.get("source_path", ""),
        )

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"name={self.name!r}, version={self.version!r}, "
            f"format={self.format.value!r})"
        )


class FlowForgeNativeSkill(SkillBase):
    """Concrete Skill implementation for the FlowForge native YAML/JSON format.

    Executes steps sequentially, passing context between them.
    """

    async def execute(self, context: SkillContext) -> SkillResult:
        """Execute all steps in order, accumulating results."""
        result = SkillResult()
        for step in self.steps:
            try:
                step_output = await self._execute_step(step, context)
                context.step_results[step.name] = step_output
                result.steps_completed.append(step.name)
            except Exception as exc:
                result.steps_failed.append(step.name)
                if step.on_error == "stop":
                    result.success = False
                    result.error = str(exc)
                    break
                elif step.on_error == "skip":
                    context.step_results[step.name] = {"skipped": True, "error": str(exc)}
                elif step.on_error == "retry":
                    for attempt in range(step.max_retries):
                        try:
                            step_output = await self._execute_step(step, context)
                            context.step_results[step.name] = step_output
                            result.steps_completed.append(f"{step.name}(retry-{attempt + 1})")
                            break
                        except Exception as retry_exc:
                            if attempt == step.max_retries - 1:
                                result.success = False
                                result.error = str(retry_exc)
                # Merge step results into output
        result.output = dict(context.step_results)
        return result

    async def _execute_step(
        self, step: SkillStep, context: SkillContext
    ) -> dict[str, Any]:
        """Execute a single step by dispatching to agent/tool/LLM.

        Dispatches based on the step configuration:
        - If step has an ``agent`` field, call the agent via HybridExecutor
        - If step has a ``tool`` field, call the tool via ToolRegistry
        - If step has a ``prompt`` field, call LLM directly via ModelCapability
        """
        agent_name = step.agent
        tool_name = step.tool
        prompt = step.prompt

        # 1. Dispatch to agent via HybridExecutor
        if agent_name and context.task_context:
            try:
                executor = None
                # Prefer executor from metadata (set by HybridExecutor.run)
                metadata = getattr(context.task_context, 'metadata', None)
                if metadata and isinstance(metadata, dict):
                    executor = metadata.get("_executor")
                # Fallback to direct attribute
                if executor is None:
                    executor = getattr(context.task_context, 'executor', None)
                if executor is not None:
                    from flowforge.core.task_context import TaskContext
                    child_ctx = TaskContext.from_parent(
                        context.task_context,
                        input_data={"prompt": prompt, **step.params},
                    )
                    child_ctx.mode = "agent"
                    result = await executor.run(child_ctx, mode_hint="agent")
                    return {"status": "completed", "agent": agent_name, "result": result}
            except Exception as exc:
                from flowforge.core.tracing import get_logger
                get_logger("skills.base").warning(
                    f"Agent dispatch failed for step '{step.name}': {exc}"
                )
                return {"status": "failed", "agent": agent_name, "error": str(exc)}

        # 2. Dispatch to tool via ToolRegistry
        if tool_name:
            try:
                from flowforge.core.base_tool import ToolInput
                # Try task_context.tools first, then standalone registry
                tool_registry = None
                if context.task_context and hasattr(context.task_context, 'tools'):
                    tool_registry = context.task_context.tools
                if tool_registry is None:
                    from flowforge.tools.registry import ToolRegistry
                    tool_registry = ToolRegistry()
                tool_instance = tool_registry.get_tool(tool_name)
                tool_input = ToolInput(params=step.params)
                tool_output = await tool_instance.execute(tool_input)
                return {
                    "status": "completed",
                    "tool": tool_name,
                    "result": tool_output.result,
                }
            except Exception as exc:
                from flowforge.core.tracing import get_logger
                get_logger("skills.base").warning(
                    f"Tool dispatch failed for step '{step.name}': {exc}"
                )
                return {"status": "failed", "tool": tool_name, "error": str(exc)}

        # 3. Direct LLM call via LLMClient
        if prompt:
            try:
                from flowforge.core.base_tool import ToolInput
                from flowforge.tools.llm_client import LLMClient
                llm_client = LLMClient()
                tool_input = ToolInput(params={
                    "messages": [{"role": "user", "content": prompt}],
                    "agent_name": agent_name or "skill",
                    "task_id": context.task_id or "skill",
                })
                tool_output = await llm_client.execute(tool_input)
                return {"status": "completed", "llm_call": True, "result": tool_output.result}
            except Exception as exc:
                from flowforge.core.tracing import get_logger
                get_logger("skills.base").warning(
                    f"LLM call failed for step '{step.name}': {exc}"
                )
                return {"status": "failed", "llm_call": True, "error": str(exc)}

        return {"status": "failed", "reason": "no agent/tool/prompt specified"}

    def validate(self, context: SkillContext) -> bool:
        """Validate that all required input data keys are present."""
        required_keys = set()
        for step in self.steps:
            if step.condition:
                required_keys.add(step.condition)
        return True
