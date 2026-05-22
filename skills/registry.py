"""Skill Registry - Dual-layer skill loading and matching.

Implements FR-CAP-02:
- Global directory (~/.flowforge/skills/) + Project directory (./.flowforge/skills/)
- Project skills override global skills with same name
- Confidence scoring for trigger matching
- Context-enhanced matching (tool call records, Solo mode)
"""

import os
from typing import Optional, Dict, Any, List
from flowforge.skills.adapter import Skill, SkillAdapter, FlowForgeAdapter, ClaudeCodeAdapter, AnthropicAdapter, TraeCNAdapter
from flowforge.core.tracing import get_logger

logger = get_logger("skills.registry")

# Default skill directories
DEFAULT_GLOBAL_DIR = os.path.expanduser("~/.flowforge/skills")
DEFAULT_PROJECT_DIR = "./.flowforge/skills"


class SkillRegistry:
    """Dual-layer skill registry.

    Loads skills from global and project directories,
    provides trigger-based matching with confidence scoring.
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or {}
        self.global_dir = self.config.get("global_dir", DEFAULT_GLOBAL_DIR)
        self.project_dir = self.config.get("project_dir", DEFAULT_PROJECT_DIR)
        self._skills: Dict[str, Skill] = {}  # name -> Skill
        self._adapters: List[SkillAdapter] = [
            FlowForgeAdapter(),
            ClaudeCodeAdapter(),
            AnthropicAdapter(),
            TraeCNAdapter(),
        ]
        self._loaded = False

    def load_skills(self):
        """Load skills from global and project directories."""
        # Load global skills first
        self._load_from_directory(self.global_dir, source="global")

        # Load project skills (override global with same name)
        self._load_from_directory(self.project_dir, source="project")

        self._loaded = True
        logger.info(f"SkillRegistry loaded {len(self._skills)} skills "
                     f"(global_dir={self.global_dir}, project_dir={self.project_dir})")

    def _load_from_directory(self, base_dir: str, source: str = "global"):
        """Load skills from a directory."""
        if not os.path.isdir(base_dir):
            return

        for entry in os.listdir(base_dir):
            entry_path = os.path.join(base_dir, entry)
            if not os.path.isdir(entry_path):
                continue

            # Try each adapter
            for adapter in self._adapters:
                if adapter.can_load(entry_path):
                    skill = adapter.load(entry_path)
                    if skill:
                        skill.metadata["source"] = source
                        self._skills[skill.name] = skill
                        logger.debug(f"Loaded skill '{skill.name}' from {entry_path} "
                                      f"(format={adapter.format_name}, source={source})")
                        break

    def match_skill(
        self,
        query: str,
        context: Optional[Dict[str, Any]] = None,
        top_k: int = 3,
    ) -> List[Dict[str, Any]]:
        """Match skills based on query and context.

        Uses confidence scoring with:
        - Trigger word length weight (longer triggers = higher confidence)
        - Context enhancement (tool call records, Solo mode)

        Returns top-k candidates with confidence scores.
        """
        if not self._loaded:
            self.load_skills()

        candidates = []
        query_lower = query.lower()

        for name, skill in self._skills.items():
            confidence = 0.0

            # Trigger matching with length weight
            for trigger in skill.triggers:
                trigger_lower = trigger.lower()
                if trigger_lower in query_lower:
                    # Longer triggers get higher confidence
                    confidence += 0.3 + (len(trigger_lower) / 100.0)
                elif query_lower in trigger_lower:
                    confidence += 0.2

            # Description matching
            if skill.description and skill.description.lower() in query_lower:
                confidence += 0.1

            # Context enhancement
            if context:
                # Tool call records boost
                recent_tools = context.get("recent_tools", [])
                if any(t in skill.required_tools for t in recent_tools):
                    confidence += 0.2

                # Solo mode boost
                if context.get("solo_mode"):
                    confidence *= 1.2

            if confidence > 0:
                candidates.append({
                    "name": name,
                    "confidence": min(confidence, 1.0),
                    "skill": skill,
                })

        # Sort by confidence and return top-k
        candidates.sort(key=lambda x: x["confidence"], reverse=True)
        return candidates[:top_k]

    def apply_skill(self, skill: Skill, ctx) -> None:
        """Apply a skill to a TaskContext.

        Injects instructions, constraints, required tools, and mode hint.
        """
        if not hasattr(ctx, 'metadata'):
            return

        # Inject instructions
        if skill.instructions:
            ctx.metadata["skill_instructions"] = skill.instructions

        # Inject constraints
        if skill.constraints:
            existing = ctx.metadata.get("constraints", [])
            ctx.metadata["constraints"] = existing + skill.constraints

        # Inject required tools
        if skill.required_tools:
            existing = ctx.metadata.get("required_tools", [])
            ctx.metadata["required_tools"] = list(set(existing + skill.required_tools))

        # Inject mode hint
        if skill.mode_hint:
            ctx.metadata["mode_hint"] = skill.mode_hint

    def get_skill(self, name: str) -> Optional[Skill]:
        """Get a skill by name."""
        if not self._loaded:
            self.load_skills()
        return self._skills.get(name)

    def list_skills(self) -> List[Dict[str, Any]]:
        """List all loaded skills."""
        if not self._loaded:
            self.load_skills()
        return [
            {
                "name": s.name,
                "description": s.description,
                "version": s.version,
                "source_format": s.source_format,
                "triggers": s.triggers,
                "source": s.metadata.get("source", "unknown"),
            }
            for s in self._skills.values()
        ]

    def get_status(self) -> dict:
        """Get skill registry status."""
        return {
            "loaded": self._loaded,
            "skill_count": len(self._skills),
            "global_dir": self.global_dir,
            "project_dir": self.project_dir,
            "adapters": [a.format_name for a in self._adapters],
        }
