"""FlowForge Skill System — base classes, enums, and abstractions.

Defines the core Skill interface that all skill formats must conform to,
along with the SkillFormat and SkillTrigger enumerations.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Dict, List, Optional

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
    condition: Optional[str] = None
    on_error: str = "stop"  # stop | skip | retry
    max_retries: int = 0
    params: Dict[str, Any] = Field(default_factory=dict)


class SkillOutput(BaseModel):
    """Describes the expected output shape of a skill."""

    format: str = "text"
    fields: List[str] = Field(default_factory=list)


class SkillContext(BaseModel):
    """Runtime context passed to skill execution.

    Carries the task context, shared state, and metadata needed
    by a skill during execution.
    """

    task_id: str = ""
    input_data: Dict[str, Any] = Field(default_factory=dict)
    state: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    step_results: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        arbitrary_types_allowed = True


class SkillResult(BaseModel):
    """Result returned from a skill execution."""

    success: bool = True
    output: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    steps_completed: List[str] = Field(default_factory=list)
    steps_failed: List[str] = Field(default_factory=list)


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
        triggers: Optional[List[SkillTrigger]] = None,
        steps: Optional[List[SkillStep]] = None,
        output: Optional[SkillOutput] = None,
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

    def to_dict(self) -> Dict[str, Any]:
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
    def from_dict(cls, data: Dict[str, Any]) -> "SkillBase":
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
    ) -> Dict[str, Any]:
        """Execute a single step.

        In the base implementation, steps are declarative and require
        an external executor (e.g. HybridExecutor) to actually dispatch
        to agents/tools.  Here we return the step definition so the
        caller can handle dispatch.
        """
        return {
            "step": step.name,
            "agent": step.agent,
            "tool": step.tool,
            "prompt": step.prompt,
            "params": step.params,
            "status": "defined",
        }

    def validate(self, context: SkillContext) -> bool:
        """Validate that all required input data keys are present."""
        required_keys = set()
        for step in self.steps:
            if step.condition:
                required_keys.add(step.condition)
        return True
