"""FlowForge Skill System — extensible Agent capability framework.

Supports four skill formats: FlowForge native, Claude Code, Anthropic, Trae CN.
Dual-layer loading: global skills + project skills.
Combo Skills: pipeline orchestration of multiple skills.
"""
from flowforge.skills.base import SkillBase, SkillFormat, SkillTrigger
from flowforge.skills.manager import SkillManager
from flowforge.skills.combo import ComboSkill, ComboPipeline
from flowforge.skills.loader import SkillLoader

__all__ = [
    "SkillBase", "SkillFormat", "SkillTrigger",
    "SkillManager", "ComboSkill", "ComboPipeline", "SkillLoader",
]
