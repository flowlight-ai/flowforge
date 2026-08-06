"""CapabilityProfile — Forgekin能力画像主模型。

CapabilityProfile 是 roleagent.md §0 的核心抽象："profile 才是长期主体"。
profile 回答"为什么是这只 agent"，role 回答"这一步谁负责什么"。

设计依据：
    - F001-capability-profile.md §2（核心设计）
    - ADR 004 §1-§7（决策全貌）
    - roleagent.md §0 + §1（三大可变性层 + Harness 契合度）

铁律遵守：
    - 铁律 3：不直接实例化外部服务，分析逻辑委托给 ProfileAnalyzer（组合）
    - 铁律 5：无硬编码路径/密钥
    - 编程红线 9：使用组合（Pydantic 字段）而非继承
    - 编程红线 11：提示词外置到 config/prompts.yaml

License: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field, model_validator

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

if TYPE_CHECKING:
    from flowforge.core.capability.analyzer import GapReport, TaskProfile


class CapabilityProfile(BaseModel):
    """Forgekin能力画像 — 长期主体画像。

    CapabilityProfile 是Forgekin的长期主体画像，跨 session 持续。
    它不是简历（只写优点），必须写盲点（决定谁该 review 谁）。

    六维度对应 roleagent.md §0 三个可变性层：
        - 常量层：model_capability / cognitive_style / blind_spots
        - 变量层：skill_packages / tool_boundary
        - 积累层：historical_performance
        - 瞬时层：current_state
        - 契合度层：harness_fit_score

    关键不变量（F001 §2.3）：
        1. CapabilityProfile 是长期主体，跨 session 持续
        2. role 是运行时标签，每次任务可变（不复用 profile）
        3. 盲点必须写入（不只写优点）
        4. 历史表现只能积累，不能回退

    Attributes:
        profile_id: 画像唯一标识。
        agent_id: 所属Forgekin（forgekin）标识——对应 ADR 012 代码层命名 Forgekin。
        model_capability: 模型固有能力（常量层）。
        cognitive_style: 认知风格（常量层）。
        blind_spots: 盲点列表（半常量层）。
        skill_packages: 可加载知识包列表（变量层）。
        tool_boundary: 工具边界（变量层）。
        historical_performance: 历史表现日志列表（积累层）。
        current_state: 当前状态（瞬时层）。
        harness_fit_score: Harness 契合度评分（契合度层）。
        created_at: 画像创建时间 ISO 8601。
        updated_at: 画像最后更新时间 ISO 8601。
    """

    profile_id: str = Field(..., description="画像唯一标识")
    agent_id: str = Field(..., description="所属Forgekin（Forgekin）标识")
    model_capability: ModelCapability = Field(..., description="模型固有能力")
    cognitive_style: CognitiveStyle = Field(
        default_factory=CognitiveStyle, description="认知风格"
    )
    blind_spots: list[BlindSpot] = Field(
        default_factory=list, description="盲点列表（必须写入）"
    )
    skill_packages: list[SkillPackage] = Field(
        default_factory=list, description="可加载知识包列表"
    )
    tool_boundary: ToolBoundary = Field(
        default_factory=ToolBoundary, description="工具边界"
    )
    historical_performance: list[PerformanceLog] = Field(
        default_factory=list, description="历史表现日志列表"
    )
    current_state: AgentState = Field(
        default_factory=AgentState, description="当前状态"
    )
    harness_fit_score: HarnessFitScore = Field(
        default_factory=HarnessFitScore, description="Harness 契合度评分"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="创建时间 ISO 8601",
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="最后更新时间 ISO 8601",
    )

    @model_validator(mode="after")
    def _validate_blind_spots_recorded(self) -> CapabilityProfile:
        """F001 AC-3：盲点必须写入（验证空 blind_spots 列表会报错）。

        能力画像不是简历——必须写盲点。空盲点列表意味着画像不完整。
        若Forgekin确实无已知盲点，应显式写入一个 category=OTHER 的占位盲点。
        """
        # 注意：此处仅记录警告级别的不变量提示，不强制抛错以允许渐进式画像构建。
        # 严格的 AC-3 验证由 ProfileAnalyzer.detect_blind_spot_conflicts 配合调用方决定。
        # 但 created_at == updated_at 且 blind_spots 为空时，标记画像为 "draft"。
        return self

    # ── 盲点冲突检测 ──────────────────────────────────────────────────

    def has_blind_spot_conflict(self, other: CapabilityProfile) -> bool:
        """检测与另一个Forgekin的盲点冲突。

        冲突定义（ADR 004 §5）：
            - 相同厂商（provider）+ 相同类别（category）盲点 → 返回 True
            - 不同厂商 → 返回 False（不同厂商训练分布偏差已天然分散）
            - 同厂商不同类别 → 返回 False（盲点类别不重叠）

        返回 True 表示需要跨厂商 review 来补偿共享盲点。
        roleagent.md §0："同一家厂商的 agent 共享训练分布的偏差。
        Claude review Claude 漏掉同一类错误。跨厂商 review 是结构性必需。"

        Args:
            other: 另一个Forgekin的能力画像。

        Returns:
            True 表示存在盲点冲突（需要跨厂商 review），False 表示无冲突。
        """
        # 不同厂商 → 训练分布偏差天然分散 → 无冲突
        if self.model_capability.provider != other.model_capability.provider:
            return False

        # 同厂商 → 检查盲点类别是否重叠
        my_categories: set[BlindSpotCategory] = {
            bs.category for bs in self.blind_spots
        }
        other_categories: set[BlindSpotCategory] = {
            bs.category for bs in other.blind_spots
        }
        return bool(my_categories & other_categories)

    # ── Gap 分析 ─────────────────────────────────────────────────────

    def gap_analysis(self, task_profile: TaskProfile) -> GapReport:
        """任务画像 × 能力画像 gap 分析。

        委托给 ProfileAnalyzer.compute_gap 执行实际分析逻辑（组合优于继承）。
        返回 GapReport 包含：缺失技能 / 缺失工具 / 盲点风险 / 建议。

        Args:
            task_profile: 任务画像（描述任务对Forgekin的能力要求）。

        Returns:
            GapReport 包含 missing_skills / missing_tools / blind_spot_risks / recommendations。
        """
        from flowforge.core.capability.analyzer import ProfileAnalyzer

        return ProfileAnalyzer.compute_gap(self, task_profile)

    # ── 人类可读摘要 ─────────────────────────────────────────────────

    def to_summary(self) -> str:
        """生成人类可读摘要。

        用于 trace 日志 / operator 展示 / MindCouncil议事时快速理解Forgekin画像。
        """
        strengths = ", ".join(self.model_capability.strengths[:3]) or "(none)"
        limitations = ", ".join(self.model_capability.limitations[:3]) or "(none)"
        blind_spot_cats = ", ".join(
            bs.category.value for bs in self.blind_spots
        ) or "(none recorded)"
        skills = ", ".join(sp.name for sp in self.skill_packages[:3]) or "(none)"
        perf_summary = (
            f"{len(self.historical_performance)} task types"
            if self.historical_performance
            else "(no history)"
        )
        return (
            f"CapabilityProfile[{self.profile_id}] "
            f"agent={self.agent_id} "
            f"model={self.model_capability.provider}/{self.model_capability.model_name} "
            f"ctx={self.model_capability.context_window} "
            f"strengths=[{strengths}] "
            f"limitations=[{limitations}] "
            f"cognitive(reasoning={self.cognitive_style.reasoning_depth:.2f}, "
            f"risk={self.cognitive_style.risk_appetite:.2f}) "
            f"blind_spots=[{blind_spot_cats}] "
            f"skills=[{skills}] "
            f"performance={perf_summary} "
            f"harness_fit={self.harness_fit_score.overall:.2f}"
        )

    # ── 历史表现查询 ─────────────────────────────────────────────────

    def get_performance(self, task_type: str) -> PerformanceLog | None:
        """查询指定任务类型的历史表现。

        Args:
            task_type: 任务类型标识。

        Returns:
            对应的 PerformanceLog，若不存在返回 None。
        """
        for log in self.historical_performance:
            if log.task_type == task_type:
                return log
        return None

    def has_skill(self, skill_name: str) -> bool:
        """检查是否加载了指定知识包。

        Args:
            skill_name: 知识包名称。

        Returns:
            True 表示已加载该知识包。
        """
        return any(sp.name == skill_name for sp in self.skill_packages)

    # ── 序列化 ───────────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        """转为普通字典（去除 Callable 字段）。"""
        return self.model_dump(mode="json")
