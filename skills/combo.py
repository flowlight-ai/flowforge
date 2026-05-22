"""Combo Engine - Declarative skill pipeline orchestration.

Implements FR-CAP-02: Combo Skills allow chaining multiple
skills in a pipeline with variable passing.
"""

from typing import Optional, Dict, Any, List
from flowforge.core.tracing import get_logger

logger = get_logger("skills.combo")


class ComboEngine:
    """Declarative skill pipeline engine.

    Executes a sequence of skill steps defined in YAML,
    supporting variable passing between steps.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self._combos: Dict[str, Dict[str, Any]] = {}

    def register_combo(self, name: str, steps: List[Dict[str, Any]]):
        """Register a combo skill.

        Args:
            name: Combo name
            steps: List of step dicts, each with:
                - skill: skill name
                - output_key: key to store output
                - depends_on: list of step names this depends on
                - variables: dict of template variables
        """
        self._combos[name] = {
            "name": name,
            "steps": steps,
        }
        logger.debug(f"Registered combo '{name}' with {len(steps)} steps")

    async def execute_combo(
        self,
        name: str,
        skill_registry=None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Execute a combo skill pipeline.

        Args:
            name: Combo name
            skill_registry: SkillRegistry to resolve skills
            context: Execution context with variables

        Returns:
            Dict with outputs from each step
        """
        combo = self._combos.get(name)
        if not combo:
            return {"error": f"Combo '{name}' not found"}

        outputs: Dict[str, Any] = {}
        context = context or {}

        for step in combo["steps"]:
            step_name = step.get("name", step.get("skill", "unknown"))
            skill_name = step.get("skill", "")
            output_key = step.get("output_key", step_name)

            # Check dependencies
            depends_on = step.get("depends_on", [])
            if depends_on and not all(d in outputs for d in depends_on):
                logger.warning(f"Combo step '{step_name}' skipped: dependency not met")
                outputs[output_key] = {"skipped": True, "reason": "dependency_not_met"}
                continue

            # Resolve template variables
            variables = step.get("variables", {})
            resolved_vars = self._resolve_variables(variables, context, outputs)

            # Execute skill (if registry available)
            if skill_registry:
                skill = skill_registry.get_skill(skill_name)
                if skill:
                    logger.debug(f"Combo step '{step_name}': executing skill '{skill_name}'")
                    # Skill execution is handled by the caller
                    outputs[output_key] = {
                        "skill": skill_name,
                        "instructions": skill.instructions,
                        "variables": resolved_vars,
                    }
                else:
                    outputs[output_key] = {"error": f"Skill '{skill_name}' not found"}
            else:
                outputs[output_key] = {
                    "skill": skill_name,
                    "variables": resolved_vars,
                }

        return outputs

    def _resolve_variables(
        self,
        variables: Dict[str, Any],
        context: Dict[str, Any],
        outputs: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Resolve template variables like {{var}} from context and outputs."""
        resolved = {}
        for key, value in variables.items():
            if isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
                var_name = value[2:-2].strip()
                # Try outputs first, then context
                if var_name in outputs:
                    resolved[key] = outputs[var_name]
                elif var_name in context:
                    resolved[key] = context[var_name]
                else:
                    resolved[key] = value  # Keep as-is if not resolved
            else:
                resolved[key] = value
        return resolved

    def list_combos(self) -> List[Dict[str, Any]]:
        """List all registered combos."""
        return [
            {"name": c["name"], "steps": len(c["steps"])}
            for c in self._combos.values()
        ]

    def get_status(self) -> dict:
        """Get combo engine status."""
        return {
            "combo_count": len(self._combos),
            "combos": self.list_combos(),
        }
