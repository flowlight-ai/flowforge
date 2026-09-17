"""FlowForge CapabilityProfile 模块 — Forgekin能力画像。

提供Forgekin长期主体画像（CapabilityProfile）的数据模型、分析器、加载器。
对应 roleagent.md §0："profile 才是长期主体"。

公开 API:
    - CapabilityProfile: 能力画像主模型
    - ModelCapability / CognitiveStyle / BlindSpot / SkillPackage /
      ToolBoundary / PerformanceLog / AgentState / HarnessFitScore:
      六维度数据模型
    - BlindSpotCategory: 盲点类别枚举
    - ProfileAnalyzer: 能力画像分析器（静态方法）
    - TaskProfile: 任务画像（gap 分析输入）
    - GapReport: gap 分析报告
    - ProfileLoader: YAML 加载器（async + DI）

设计依据:
    - features/F001-capability-profile.md
    - decisions/004-capability-profile-routing.md
    - decisions/012-naming-fusion.md（Forgekin 代码层命名）
    - roleagent.md §0 + §1

License: MIT
"""

from __future__ import annotations

from flowforge.core.capability.analyzer import (
    GapReport,
    ProfileAnalyzer,
    TaskProfile,
)
from flowforge.core.capability.loader import ProfileLoader
from flowforge.core.capability.models import (
    AgentState,
    BlindSpot,
    BlindSpotCategory,
    CognitiveStyle,
    HarnessFitScore,
    ModelCapability,
    PerformanceLog,
    SkillPackage,
    ToolBoundary,
)
from flowforge.core.capability.profile import CapabilityProfile

__all__ = [
    # 主模型
    "CapabilityProfile",
    # 六维度数据模型
    "ModelCapability",
    "CognitiveStyle",
    "BlindSpot",
    "BlindSpotCategory",
    "SkillPackage",
    "ToolBoundary",
    "PerformanceLog",
    "AgentState",
    "HarnessFitScore",
    # 分析器
    "ProfileAnalyzer",
    "TaskProfile",
    "GapReport",
    # 加载器
    "ProfileLoader",
]

__version__ = "0.1.0"
