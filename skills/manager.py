"""FlowForge Skill Manager — dual-layer loading, lookup, and execution.

Manages the lifecycle of skills loaded from global and project directories.
Handles version conflict resolution (newer version wins) and trigger matching.
"""

from __future__ import annotations

from flowforge.core.tracing import get_logger
from flowforge.skills.base import (
    SkillBase,
    SkillContext,
    SkillFormat,
    SkillResult,
    SkillTrigger,
)
from flowforge.skills.loader import SkillLoader

logger = get_logger("flowforge.skills.manager")


def _parse_version(version_str: str) -> tuple:
    """Parse a semantic version string into a comparable tuple.

    Examples:
        "1.0" -> (1, 0, 0)
        "1.2.3" -> (1, 2, 3)
        "0.1.0" -> (0, 1, 0)
    """
    parts = version_str.split(".")
    result: list[int] = []
    for part in parts[:3]:
        try:
            result.append(int(part))
        except ValueError:
            result.append(0)
    while len(result) < 3:
        result.append(0)
    return tuple(result)


class SkillManager:
    """Central manager for the FlowForge Skill system.

    Provides:
    - Dual-layer loading: global skills + project skills
    - Skill lookup by name
    - Trigger matching
    - Skill execution
    - Version conflict resolution (newer version wins)
    """

    def __init__(self) -> None:
        self._skills: dict[str, SkillBase] = {}
        self._loader = SkillLoader()

    # ── Loading ─────────────────────────────────────────────────────

    def load_skills(
        self,
        global_dir: str | None = None,
        project_dir: str | None = None,
    ) -> int:
        """Load skills from global and project directories.

        Global skills are loaded first; project skills are loaded second
        and override global skills with the same name if the project
        version is newer or equal.

        Args:
            global_dir: Path to global skills directory
                (e.g. ``~/.flowforge/skills/``).
            project_dir: Path to project skills directory
                (e.g. ``./.flowforge/skills/``).

        Returns:
            Total number of skills loaded.
        """
        loaded_count = 0

        # Load global skills first
        if global_dir:
            global_skills = self._loader.load_from_directory(global_dir)
            for skill in global_skills:
                self._register_skill(skill)
                loaded_count += 1
            logger.info(
                f"Loaded {len(global_skills)} global skills from {global_dir}"
            )

        # Load project skills (override globals if version >=)
        if project_dir:
            project_skills = self._loader.load_from_directory(project_dir)
            for skill in project_skills:
                self._register_skill(skill)
                loaded_count += 1
            logger.info(
                f"Loaded {len(project_skills)} project skills from {project_dir}"
            )

        return loaded_count

    def _register_skill(self, skill: SkillBase) -> None:
        """Register a skill, resolving version conflicts.

        If a skill with the same name already exists, the newer version
        wins.  If versions are equal, the incoming skill replaces the
        existing one (project overrides global).
        """
        existing = self._skills.get(skill.name)

        if existing is None:
            self._skills[skill.name] = skill
            return

        # Compare versions — newer wins
        existing_ver = _parse_version(existing.version)
        new_ver = _parse_version(skill.version)

        if new_ver >= existing_ver:
            logger.debug(
                f"Skill '{skill.name}' v{skill.version} replaces "
                f"v{existing.version} (from {existing.source_path})"
            )
            self._skills[skill.name] = skill
        else:
            logger.debug(
                f"Skill '{skill.name}' v{skill.version} skipped — "
                f"existing v{existing.version} is newer"
            )

    # ── Lookup ──────────────────────────────────────────────────────

    def get_skill(self, name: str) -> SkillBase | None:
        """Look up a skill by name.

        Args:
            name: The unique skill identifier.

        Returns:
            The SkillBase instance, or None if not found.
        """
        return self._skills.get(name)

    def list_skills(self) -> list[SkillBase]:
        """List all loaded skills.

        Returns:
            List of all registered SkillBase instances.
        """
        return list(self._skills.values())

    def list_skills_by_format(self, format: SkillFormat) -> list[SkillBase]:
        """List skills filtered by format."""
        return [s for s in self._skills.values() if s.format == format]

    # ── Trigger matching ────────────────────────────────────────────

    def match_triggers(self, trigger: SkillTrigger) -> list[SkillBase]:
        """Find all skills that match a given trigger.

        Args:
            trigger: The trigger type to match against.

        Returns:
            List of skills whose triggers include the given type.
        """
        return [
            skill
            for skill in self._skills.values()
            if trigger in skill.triggers
        ]

    # ── Execution ───────────────────────────────────────────────────

    async def execute_skill(
        self, name: str, context: SkillContext
    ) -> SkillResult:
        """Execute a skill by name.

        Args:
            name: The unique skill identifier.
            context: Runtime context for the skill execution.

        Returns:
            SkillResult with output data and execution status.

        Raises:
            KeyError: If no skill with the given name is found.
        """
        skill = self._skills.get(name)
        if skill is None:
            raise KeyError(f"Skill not found: {name}")

        if not skill.validate(context):
            return SkillResult(
                success=False,
                error=f"Skill '{name}' validation failed for context",
            )

        logger.info(f"Executing skill: {name} (v{skill.version})")
        result = await skill.execute(context)
        logger.info(
            f"Skill '{name}' completed: success={result.success}, "
            f"steps_completed={len(result.steps_completed)}, "
            f"steps_failed={len(result.steps_failed)}"
        )
        return result

    # ── Utility ─────────────────────────────────────────────────────

    def skill_count(self) -> int:
        """Return the number of loaded skills."""
        return len(self._skills)

    def has_skill(self, name: str) -> bool:
        """Check if a skill with the given name is loaded."""
        return name in self._skills

    def clear(self) -> None:
        """Remove all loaded skills."""
        self._skills.clear()
