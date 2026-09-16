"""ProfileAnalyzer — 能力画像分析器。

实现任务画像 × 能力画像的 gap 分析、盲点冲突检测、跨厂商配对推荐。
对应 ADR 004 §4（动态路由）+ §5（跨厂商 review）。

设计依据：
    - F001-capability-profile.md §2.2
    - ADR 004 §4-§5
    - roleagent.md §0 + §1

铁律遵守：
    - 铁律 3：分析器是静态方法组合，不持有可变状态，不直接实例化外部服务
    - 编程红线 9：使用组合（静态方法 + 数据模型）而非继承
    - 编程红线 11：推荐文案模板外置到 config/prompts.yaml

License: MIT
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field

from flowforge.core.capability.models import BlindSpotCategory
from flowforge.core.capability.profile import CapabilityProfile
from flowforge.core.tracing import get_logger

logger = get_logger("capability.analyzer")


# ──────────────────────────────────────────────────────────────────────────────
# 任务画像（输入）
# ──────────────────────────────────────────────────────────────────────────────


class TaskProfile(BaseModel):
    """任务画像——描述任务对Forgekin的能力要求。

    对应 ADR 004 §4：动态路由基于能力画像 × 任务画像的匹配度。

    Attributes:
        task_id: 任务唯一标识。
        task_type: 任务类型（如 code_generation / review / writing）。
        required_skills: 任务需要的知识包名称列表。
        required_tools: 任务需要的工具列表。
        forbidden_blind_spot_categories: 任务禁忌盲点类别列表
            （若Forgekin在该类别有盲点，标记为风险）。
        preferred_cognitive_styles: 期望的解释风格列表
            （如 ["structured", "concise"]）。
        min_context_window: 最小上下文窗口要求（token 数，None 表示不限制）。
    """

    task_id: str = Field(..., description="任务唯一标识")
    task_type: str = Field(..., description="任务类型")
    required_skills: list[str] = Field(
        default_factory=list, description="需要的知识包名称列表"
    )
    required_tools: list[str] = Field(
        default_factory=list, description="需要的工具列表"
    )
    forbidden_blind_spot_categories: list[BlindSpotCategory] = Field(
        default_factory=list, description="任务禁忌盲点类别列表"
    )
    preferred_cognitive_styles: list[str] = Field(
        default_factory=list, description="期望解释风格列表"
    )
    min_context_window: Optional[int] = Field(
        default=None, gt=0, description="最小上下文窗口要求"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Gap 报告（输出）
# ──────────────────────────────────────────────────────────────────────────────


class GapReport(BaseModel):
    """Gap 分析报告——任务画像 × 能力画像 gap 分析结果。

    对应 F001 §2.2：gap_analysis 返回需要扩展的能力列表 + 风险评估。

    Attributes:
        missing_skills: 缺失的知识包名称列表
            （任务要求但Forgekin未加载）。
        missing_tools: 缺失的工具列表
            （任务要求但Forgekin未被授权）。
        blind_spot_risks: 盲点风险列表
            （每项是 (category, description) 元组，表示任务禁忌盲点与Forgekin盲点重叠）。
        context_window_insufficient: 上下文窗口是否不足。
        cognitive_style_mismatch: 认知风格是否不匹配。
        recommendations: 建议文案列表（人类可读）。
    """

    missing_skills: list[str] = Field(
        default_factory=list, description="缺失的知识包名称"
    )
    missing_tools: list[str] = Field(default_factory=list, description="缺失的工具")
    blind_spot_risks: list[tuple[str, str]] = Field(
        default_factory=list,
        description="盲点风险 (category, description) 元组列表",
    )
    context_window_insufficient: bool = Field(
        default=False, description="上下文窗口是否不足"
    )
    cognitive_style_mismatch: bool = Field(
        default=False, description="认知风格是否不匹配"
    )
    recommendations: list[str] = Field(
        default_factory=list, description="建议文案列表"
    )

    @property
    def has_critical_gap(self) -> bool:
        """是否存在关键 gap（缺失技能/工具 或 盲点风险）。"""
        return bool(
            self.missing_skills
            or self.missing_tools
            or self.blind_spot_risks
            or self.context_window_insufficient
        )


# ──────────────────────────────────────────────────────────────────────────────
# 提示词模板加载（铁律 5+P16：禁止硬编码提示词）
# ──────────────────────────────────────────────────────────────────────────────


# 默认提示词模板路径——通过参数注入，禁止硬编码调用（铁律 5）。
_DEFAULT_PROMPTS_RELATIVE_PATH = Path("core") / "capability" / "config" / "prompts.yaml"


def _load_recommendation_templates(prompts_path: Optional[Path]) -> dict[str, str]:
    """加载推荐文案模板。

    铁律 5+P16：禁止硬编码提示词。模板从 config/prompts.yaml 加载。
    若路径为 None 或加载失败，返回空 dict（调用方走 fallback 默认逻辑）。

    Args:
        prompts_path: prompts.yaml 绝对路径。None 表示未注入。

    Returns:
        模板字典 {key: template_str}。
    """
    if prompts_path is None:
        return {}
    try:
        path = Path(prompts_path)
        if not path.exists():
            logger.debug(f"prompts.yaml not found at {path}, using fallback")
            return {}
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return dict(data.get("recommendations", {}))
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Failed to load prompts.yaml: {e}")
        return {}


def _format_recommendation(
    template: Optional[str], fallback: str, **kwargs: Any
) -> str:
    """格式化推荐文案——优先用模板，失败回退到 fallback。"""
    if template:
        try:
            return template.format(**kwargs)
        except (KeyError, ValueError, IndexError):
            pass
    return fallback.format(**kwargs) if kwargs else fallback


# ──────────────────────────────────────────────────────────────────────────────
# ProfileAnalyzer 静态分析器
# ──────────────────────────────────────────────────────────────────────────────


class ProfileAnalyzer:
    """能力画像分析器——静态方法组合，无可变状态。

    实现三个核心分析能力：
        1. compute_gap: 任务画像 × 能力画像 gap 分析
        2. detect_blind_spot_conflicts: 多Forgekin盲点冲突检测
        3. recommend_pairing: 跨厂商 review 配对推荐

    设计原则（编程红线 9）：
        - 不持有可变状态，所有方法纯函数式
        - 不继承任何基类，通过静态方法提供能力
        - 通过 prompts_path 参数注入提示词模板路径（铁律 5）
    """

    @staticmethod
    def compute_gap(
        profile: CapabilityProfile,
        task_profile: TaskProfile,
        prompts_path: Optional[Path] = None,
    ) -> GapReport:
        """任务画像 × 能力画像 gap 分析。

        分析四类 gap：
            1. 缺失技能：任务要求但Forgekin未加载的知识包
            2. 缺失工具：任务要求但Forgekin未被授权的工具
            3. 盲点风险：任务禁忌盲点类别与Forgekin盲点重叠
            4. 上下文窗口不足 + 认知风格不匹配

        Args:
            profile: Forgekin能力画像。
            task_profile: 任务画像。
            prompts_path: 提示词模板路径（铁律 5，可选注入）。

        Returns:
            GapReport 包含 missing_skills / missing_tools / blind_spot_risks / recommendations。
        """
        templates = _load_recommendation_templates(prompts_path)

        # 1. 缺失技能
        loaded_skills = {sp.name for sp in profile.skill_packages}
        missing_skills = [
            s for s in task_profile.required_skills if s not in loaded_skills
        ]

        # 2. 缺失工具
        allowed = set(profile.tool_boundary.allowed_tools)
        forbidden = set(profile.tool_boundary.forbidden_tools)
        missing_tools = [
            t
            for t in task_profile.required_tools
            if t not in allowed or t in forbidden
        ]

        # 3. 盲点风险：任务禁忌类别 ∩ Forgekin盲点类别
        my_blind_categories = {bs.category for bs in profile.blind_spots}
        forbidden_set = set(task_profile.forbidden_blind_spot_categories)
        risky_categories = my_blind_categories & forbidden_set
        blind_spot_risks: list[tuple[str, str]] = []
        for cat in risky_categories:
            for bs in profile.blind_spots:
                if bs.category == cat:
                    blind_spot_risks.append(
                        (cat.value, bs.description)
                    )

        # 4. 上下文窗口
        context_insufficient = (
            task_profile.min_context_window is not None
            and profile.model_capability.context_window
            < task_profile.min_context_window
        )

        # 5. 认知风格
        style_mismatch = False
        if (
            task_profile.preferred_cognitive_styles
            and profile.cognitive_style.explanation_style
            not in task_profile.preferred_cognitive_styles
        ):
            style_mismatch = True

        # 6. 拼装建议文案
        recommendations: list[str] = []
        for skill in missing_skills:
            recommendations.append(
                _format_recommendation(
                    templates.get("missing_skill"),
                    fallback="建议加载技能包: {skill}",
                    skill=skill,
                )
            )
        for tool in missing_tools:
            recommendations.append(
                _format_recommendation(
                    templates.get("missing_tool"),
                    fallback="建议授权工具: {tool}",
                    tool=tool,
                )
            )
        for cat, desc in blind_spot_risks:
            recommendations.append(
                _format_recommendation(
                    templates.get("blind_spot_risk"),
                    fallback=(
                        "警告: 任务禁忌盲点类别 '{category}' 与当前Forgekin盲点重叠"
                        "（{desc}），建议跨厂商 review"
                    ),
                    category=cat,
                    desc=desc,
                )
            )
        if context_insufficient:
            recommendations.append(
                _format_recommendation(
                    templates.get("context_window_insufficient"),
                    fallback=(
                        "上下文窗口不足: 需要 {required}, 实际 {actual}"
                    ),
                    required=task_profile.min_context_window,
                    actual=profile.model_capability.context_window,
                )
            )
        if style_mismatch:
            recommendations.append(
                _format_recommendation(
                    templates.get("cognitive_mismatch"),
                    fallback=(
                        "认知风格不匹配: 期望 {preferred}, 实际 {actual}"
                    ),
                    preferred="/".join(task_profile.preferred_cognitive_styles),
                    actual=profile.cognitive_style.explanation_style,
                )
            )

        return GapReport(
            missing_skills=missing_skills,
            missing_tools=missing_tools,
            blind_spot_risks=blind_spot_risks,
            context_window_insufficient=context_insufficient,
            cognitive_style_mismatch=style_mismatch,
            recommendations=recommendations,
        )

    @staticmethod
    def detect_blind_spot_conflicts(
        candidates: list[CapabilityProfile],
    ) -> list[tuple[str, str, str]]:
        """检测候选Forgekin集合中的盲点冲突。

        遍历候选列表中所有 (i, j) 配对，返回存在盲点冲突的配对。
        用于跨厂商 review 必要性批量判断。

        Args:
            candidates: 候选Forgekin列表。

        Returns:
            冲突列表 [(profile_id_a, profile_id_b, conflict_category), ...]。
            仅返回同厂商 + 同类别盲点的冲突。
        """
        conflicts: list[tuple[str, str, str]] = []
        n = len(candidates)
        for i in range(n):
            for j in range(i + 1, n):
                a, b = candidates[i], candidates[j]
                # 不同厂商无冲突
                if (
                    a.model_capability.provider
                    != b.model_capability.provider
                ):
                    continue
                cat_a = {bs.category for bs in a.blind_spots}
                cat_b = {bs.category for bs in b.blind_spots}
                overlap = cat_a & cat_b
                for cat in overlap:
                    conflicts.append((a.profile_id, b.profile_id, cat.value))
        return conflicts

    @staticmethod
    def recommend_pairing(
        author: CapabilityProfile,
        candidates: list[CapabilityProfile],
    ) -> Optional[CapabilityProfile]:
        """为作者推荐跨厂商 reviewer。

        策略（ADR 004 §5）：
            1. 优先选择不同厂商（结构性消除同厂商盲点）
            2. 在不同厂商中，选择盲点类别与作者不重叠的
            3. 若无可行 reviewer，返回 None（调用方需升级 operator）

        Args:
            author: 作者Forgekin画像。
            candidates: 候选 reviewer 画像列表。

        Returns:
            推荐的 reviewer 画像，若无可行返回 None。
        """
        author_vendor = author.model_capability.provider
        author_blind_cats = {bs.category for bs in author.blind_spots}

        # 1. 不同厂商候选
        cross_vendor = [
            c
            for c in candidates
            if c.model_capability.provider != author_vendor
            and c.profile_id != author.profile_id
        ]
        if not cross_vendor:
            logger.warning(
                f"No cross-vendor reviewer available for author "
                f"{author.profile_id} (vendor={author_vendor})"
            )
            return None

        # 2. 在跨厂商候选中选盲点不重叠的
        non_overlapping = [
            c
            for c in cross_vendor
            if not ({bs.category for bs in c.blind_spots} & author_blind_cats)
        ]
        if non_overlapping:
            # 选 harness_fit_score.overall 最高的
            return max(
                non_overlapping,
                key=lambda c: c.harness_fit_score.overall,
            )

        # 3. 退而求其次：选盲点重叠最少的跨厂商 reviewer
        def _overlap_count(c: CapabilityProfile) -> int:
            return len(
                {bs.category for bs in c.blind_spots} & author_blind_cats
            )

        return min(cross_vendor, key=_overlap_count)
