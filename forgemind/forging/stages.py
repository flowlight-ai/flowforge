"""育灵锻造阶段定义 — 6 阶段流水线的阶段枚举与结果模型。

按 [doc:review/review.md#第九章] FM-006 定义 6 阶段:

    1. 形态定义（species_definition）— 确定灵族 species
    2. 能力注入（capability_injection）— 加载 CapabilityProfile
    3. 记忆初始化（memory_seeding）— 初始化魂忆 EchoStore
    4. 价值观对齐（value_alignment）— 注入价值锚点
    5. 能力验证（capability_verification）— Eval 验证（min_quality_score=0.85）
    6. 觉醒晋升（awakening_promotion）— 初始觉醒阶 E1

每个阶段都有 ``required`` / ``timeout_seconds`` / ``retry`` 配置项，
配置驱动（详见 ``config/forging.yaml``）。

详见:
    - [doc:design/naming-contract.md#2.4] 育灵定义
    - [doc:review/review.md#第九章] FM-006 锻造流水线 6 阶段
    - [doc:rules.md#红线2] 质量分阈值 0.85
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ForgingStage(str, Enum):
    """育灵锻造阶段枚举 — 6 阶段流水线。

    阶段顺序固定为 ``SPECIES_DEFINITION → CAPABILITY_INJECTION →
    MEMORY_SEEDING → VALUE_ALIGNMENT → CAPABILITY_VERIFICATION →
    AWAKENING_PROMOTION``，不可调换。

    详见 [doc:review/review.md#第九章] FM-006。
    """

    SPECIES_DEFINITION = "species_definition"
    CAPABILITY_INJECTION = "capability_injection"
    MEMORY_SEEDING = "memory_seeding"
    VALUE_ALIGNMENT = "value_alignment"
    CAPABILITY_VERIFICATION = "capability_verification"
    AWAKENING_PROMOTION = "awakening_promotion"

    @classmethod
    def ordered(cls) -> list["ForgingStage"]:
        """返回按流水线顺序排列的阶段列表。"""
        return [
            cls.SPECIES_DEFINITION,
            cls.CAPABILITY_INJECTION,
            cls.MEMORY_SEEDING,
            cls.VALUE_ALIGNMENT,
            cls.CAPABILITY_VERIFICATION,
            cls.AWAKENING_PROMOTION,
        ]

    @property
    def chinese_name(self) -> str:
        """返回该阶段的中文名。"""
        return _STAGE_CHINESE_NAMES[self]

    @property
    def description(self) -> str:
        """返回该阶段的描述（用于日志 / UI 展示）。"""
        return _STAGE_DESCRIPTIONS[self]


_STAGE_CHINESE_NAMES: dict[ForgingStage, str] = {
    ForgingStage.SPECIES_DEFINITION: "形态定义",
    ForgingStage.CAPABILITY_INJECTION: "能力注入",
    ForgingStage.MEMORY_SEEDING: "记忆初始化",
    ForgingStage.VALUE_ALIGNMENT: "价值观对齐",
    ForgingStage.CAPABILITY_VERIFICATION: "能力验证",
    ForgingStage.AWAKENING_PROMOTION: "觉醒晋升",
}

_STAGE_DESCRIPTIONS: dict[ForgingStage, str] = {
    ForgingStage.SPECIES_DEFINITION: "确定灵族 species（bio/org/obj/virtual/hybrid）",
    ForgingStage.CAPABILITY_INJECTION: "加载能力画像 CapabilityProfile",
    ForgingStage.MEMORY_SEEDING: "初始化魂忆 EchoStore 种子记忆",
    ForgingStage.VALUE_ALIGNMENT: "注入价值锚点（VISION §7 + 15 条红线）",
    ForgingStage.CAPABILITY_VERIFICATION: "Eval 验证（min_quality_score=0.85）",
    ForgingStage.AWAKENING_PROMOTION: "确认初始觉醒阶 E1（全导阶）",
}


class ForgingStageResult(BaseModel):
    """单个锻造阶段的执行结果。

    每个阶段执行后产出此模型，用于流水线状态追踪和审计。

    属性:
        stage: 阶段枚举值。
        passed: 是否通过（``False`` 表示阶段失败，流水线应中止）。
        quality_score: 质量评分（0-1，仅 ``capability_verification``
            阶段强制 ≥ 0.85）。
        output: 阶段输出数据（结构由各阶段约定）。
        error: 失败时的错误信息（``passed=True`` 时为 ``None``）。
        duration_seconds: 阶段执行耗时（秒）。
    """

    model_config = ConfigDict(extra="forbid")

    stage: ForgingStage = Field(..., description="阶段枚举值。")
    passed: bool = Field(..., description="是否通过。")
    quality_score: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="质量评分（0-1），仅 capability_verification 阶段强制 ≥ 0.85。",
    )
    output: dict[str, Any] = Field(
        default_factory=dict,
        description="阶段输出数据（结构由各阶段约定）。",
    )
    error: str | None = Field(
        default=None,
        description="失败时的错误信息。",
    )
    duration_seconds: float = Field(
        default=0.0,
        ge=0.0,
        description="阶段执行耗时（秒）。",
    )
