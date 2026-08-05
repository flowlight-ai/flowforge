"""FlowForge Combo Skills — pipeline orchestration of multiple skills.

ComboSkill chains multiple skills in sequence.
ComboPipeline orchestrates combo execution with conditional branching,
error handling, and context passing between skills.
"""

from __future__ import annotations

from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.skills.base import (
    SkillBase,
    SkillContext,
    SkillFormat,
    SkillResult,
    SkillTrigger,
)

logger = get_logger("flowforge.skills.combo")


class ComboSkill(SkillBase):
    """A skill that chains multiple sub-skills in sequence.

    Each sub-skill's output is merged into the shared context so that
    subsequent skills can reference earlier results.

    Attributes:
        skill_names: Ordered list of skill names to execute.
        error_strategy: How to handle a sub-skill failure.
            - ``"stop"``: abort the entire combo (default)
            - ``"skip"``: skip the failed skill and continue
            - ``"retry"``: retry the failed skill up to ``max_retries``
        max_retries: Maximum retry attempts per sub-skill (when
            ``error_strategy="retry"``).
    """

    def __init__(
        self,
        name: str,
        description: str = "",
        version: str = "0.1.0",
        skill_names: list[str] | None = None,
        error_strategy: str = "stop",
        max_retries: int = 0,
        triggers: list[SkillTrigger] | None = None,
        source_path: str = "",
    ) -> None:
        super().__init__(
            name=name,
            description=description,
            version=version,
            format=SkillFormat.FLOWFORGE,
            triggers=triggers or [SkillTrigger.ON_DEMAND],
            source_path=source_path,
        )
        self.skill_names = skill_names or []
        self.error_strategy = error_strategy
        self.max_retries = max_retries

    async def execute(self, context: SkillContext) -> SkillResult:
        """Execute the combo by delegating to ComboPipeline."""
        pipeline = ComboPipeline(
            skill_names=self.skill_names,
            error_strategy=self.error_strategy,
            max_retries=self.max_retries,
        )
        return await pipeline.run(context)

    def validate(self, context: SkillContext) -> bool:
        """Validate that the context has the minimum required data."""
        return True

    def to_dict(self) -> dict[str, Any]:
        data = super().to_dict()
        data["skill_names"] = self.skill_names
        data["error_strategy"] = self.error_strategy
        data["max_retries"] = self.max_retries
        return data


class ComboPipeline:
    """Orchestrates the execution of a combo skill pipeline.

    Features:
    - Sequential execution of named skills
    - Context passing: each skill's output feeds into the next skill's state
    - Conditional branching: skip a skill if its ``condition`` evaluates falsy
    - Error handling: stop / skip / retry on sub-skill failure
    """

    def __init__(
        self,
        skill_names: list[str],
        error_strategy: str = "stop",
        max_retries: int = 0,
        skill_manager: Any | None = None,
    ) -> None:
        """
        Args:
            skill_names: Ordered list of skill names to execute.
            error_strategy: ``"stop"`` | ``"skip"`` | ``"retry"``.
            max_retries: Max retry attempts when strategy is ``"retry"``.
            skill_manager: Optional SkillManager instance for looking up
                sub-skills.  If not provided, skills must be registered
                before execution.
        """
        self.skill_names = skill_names
        self.error_strategy = error_strategy
        self.max_retries = max_retries
        self._skill_manager = skill_manager

    def set_skill_manager(self, manager: Any) -> None:
        """Set the SkillManager used to look up sub-skills."""
        self._skill_manager = manager

    async def run(self, context: SkillContext) -> SkillResult:
        """Execute the pipeline sequentially.

        Each skill receives the accumulated context.  On success, the
        skill's output is merged into ``context.state`` so that
        subsequent skills can reference earlier results.

        Returns:
            SkillResult with combined output from all sub-skills.
        """
        result = SkillResult()
        combined_output: dict[str, Any] = {}

        for skill_name in self.skill_names:
            # Look up the skill
            skill = self._resolve_skill(skill_name)
            if skill is None:
                result.steps_failed.append(skill_name)
                if self.error_strategy == "stop":
                    result.success = False
                    result.error = f"Skill not found: {skill_name}"
                    break
                elif self.error_strategy == "skip":
                    combined_output[skill_name] = {"skipped": True, "reason": "not_found"}
                    continue
                # retry won't help if the skill doesn't exist
                result.success = False
                result.error = f"Skill not found: {skill_name}"
                break

            # Check conditional execution
            if not self._check_condition(skill, context):
                combined_output[skill_name] = {"skipped": True, "reason": "condition_not_met"}
                continue

            # Execute with retry logic
            skill_result = await self._execute_with_retries(
                skill, context, skill_name
            )

            if skill_result.success:
                result.steps_completed.append(skill_name)
                combined_output[skill_name] = skill_result.output
                # Merge output into context state for subsequent skills
                context.state.update(skill_result.output)
            else:
                result.steps_failed.append(skill_name)
                if self.error_strategy == "stop":
                    result.success = False
                    result.error = (
                        f"Skill '{skill_name}' failed: {skill_result.error}"
                    )
                    break
                elif self.error_strategy == "skip":
                    combined_output[skill_name] = {
                        "skipped": True,
                        "error": skill_result.error,
                    }
                elif self.error_strategy == "retry":
                    # Already retried in _execute_with_retries
                    result.success = False
                    result.error = (
                        f"Skill '{skill_name}' failed after retries: "
                        f"{skill_result.error}"
                    )
                    break

        result.output = combined_output
        return result

    def _resolve_skill(self, name: str) -> SkillBase | None:
        """Look up a skill by name from the manager."""
        if self._skill_manager is not None:
            return self._skill_manager.get_skill(name)
        return None

    def _check_condition(self, skill: SkillBase, context: SkillContext) -> bool:
        """Check whether a skill should execute based on context conditions.

        Evaluates condition expressions stored on the skill (via a
        ``condition`` attribute) against the current context state and
        step results.

        Supported operators:
        - ``eq``  : equals
        - ``neq`` : not equals
        - ``gt``  : greater than
        - ``lt``  : less than
        - ``contains`` : string/list contains value
        - ``in``  : field value is in a comma-separated list

        Condition format: ``"field_path operator value"``
        Field paths use dot notation to traverse dicts, e.g.
        ``"state.status eq completed"`` or
        ``"step_results.research.output.score gt 0.8"``.

        If the skill has no ``condition`` attribute, returns True.
        """
        condition = getattr(skill, 'condition', None)
        if not condition:
            return True

        # Build a merged data dict for field resolution
        data = {
            "state": context.state,
            "step_results": context.step_results,
            "metadata": context.metadata,
        }

        # Parse condition: "field_path operator value"
        parts = condition.strip().split(None, 2)
        if len(parts) < 3:
            logger.warning(
                f"Invalid condition format '{condition}', expected "
                f"'field_path operator value'"
            )
            return True  # malformed condition → allow execution

        field_path, operator, expected_value = parts
        supported_ops = {"eq", "neq", "gt", "lt", "contains", "in"}
        if operator not in supported_ops:
            logger.warning(f"Unsupported condition operator: {operator}")
            return True

        # Resolve field value from data dict using dot notation
        actual_value = self._resolve_field(data, field_path)
        if actual_value is None:
            logger.debug(
                f"Condition field '{field_path}' not found in context, "
                f"condition not met"
            )
            return False

        return self._evaluate_condition(actual_value, operator, expected_value)

    @staticmethod
    def _resolve_field(data: dict, field_path: str) -> Any:
        """Resolve a dot-notated field path from a nested dict.

        Example: ``"step_results.research.output.score"`` traverses
        ``data["step_results"]["research"]["output"]["score"]``.
        """
        current: Any = data
        for key in field_path.split("."):
            if isinstance(current, dict):
                current = current.get(key)
            else:
                return None
            if current is None:
                return None
        return current

    @staticmethod
    def _evaluate_condition(
        actual: Any, operator: str, expected: str
    ) -> bool:
        """Evaluate a single condition comparison."""
        try:
            if operator == "eq":
                return str(actual) == expected
            elif operator == "neq":
                return str(actual) != expected
            elif operator == "gt":
                return float(actual) > float(expected)
            elif operator == "lt":
                return float(actual) < float(expected)
            elif operator == "contains":
                if isinstance(actual, (list, tuple)):
                    return expected in [str(item) for item in actual]
                return expected in str(actual)
            elif operator == "in":
                allowed = [v.strip() for v in expected.split(",")]
                return str(actual) in allowed
        except (ValueError, TypeError):
            return False
        return False

    async def _execute_with_retries(
        self,
        skill: SkillBase,
        context: SkillContext,
        skill_name: str,
    ) -> SkillResult:
        """Execute a skill, optionally retrying on failure."""
        last_result: SkillResult | None = None
        attempts = 1 + (self.max_retries if self.error_strategy == "retry" else 0)

        for attempt in range(attempts):
            try:
                if not skill.validate(context):
                    return SkillResult(
                        success=False,
                        error=f"Validation failed for skill '{skill_name}'",
                    )
                result = await skill.execute(context)
                if result.success:
                    return result
                last_result = result
                if attempt < attempts - 1:
                    logger.debug(
                        f"Retrying skill '{skill_name}' "
                        f"(attempt {attempt + 2}/{attempts})"
                    )
            except Exception as exc:
                last_result = SkillResult(
                    success=False, error=str(exc)
                )
                if attempt < attempts - 1:
                    logger.debug(
                        f"Retrying skill '{skill_name}' after exception: {exc}"
                    )

        return last_result or SkillResult(
            success=False, error=f"Skill '{skill_name}' produced no result"
        )
