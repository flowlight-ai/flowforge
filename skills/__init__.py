"""FlowForge Skill System — extensible Agent capability framework.

Supports four skill formats: FlowForge native, Claude Code, Anthropic, Trae CN.
Dual-layer loading: global skills + project skills.
Combo Skills: pipeline orchestration of multiple skills.
"""
from flowforge.skills.base import SkillBase, SkillFormat, SkillTrigger
from flowforge.skills.combo import ComboPipeline, ComboSkill
from flowforge.skills.loader import SkillLoader
from flowforge.skills.manager import SkillManager

__all__ = [
    "SkillBase", "SkillFormat", "SkillTrigger",
    "SkillManager", "ComboSkill", "ComboPipeline", "SkillLoader",
]
