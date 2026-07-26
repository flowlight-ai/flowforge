"""Forgekin锻造表单（ForgekinFormData）— Forge Nurturing流水线的输入契约。

Forge Nurturing（Forge Nurturing）流水线以 :class:`ForgekinFormData` 作为输入，
通过 6 阶段锻造流程（形态定义 → 能力注入 → 记忆初始化 → 价值观对齐 →
能力验证 → 觉醒晋升）产出Forgekin实例。

表单使用 Pydantic v2 模型校验输入，保证:

    - 必填字段（``name`` / ``species`` / ``namespace``）非空
    - ForgekinSpecies枚举值合法（``bio`` / ``org`` / ``obj`` / ``virtual`` / ``hybrid``）
    - 价值锚点列表非空且无重复
    - 觉醒阶默认为 E1（全导阶），保证新锻造Forgekin从全人工起步

详见:
    - [doc:design/naming-contract.md#2.4] Forge Nurturing定义
    - [doc:design/naming-contract.md#2.6] SoulImprint定义
    - [doc:review/review.md#第九章] FM-006 锻造流水线 6 阶段
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage


class ForgekinFormData(BaseModel):
    """Forgekin锻造表单 — Forge Nurturing流水线的标准输入。

    表单描述"想锻造一个什么样的Forgekin"，由 :class:`ForgePipeline` 消费
    并产出 :class:`~flowforge.forgemind.base.ForgekinBase` 实例。

    属性:
        name: Forgekin显示名（如 ``"孙悟空"`` / ``"客厅吊灯"``）。
        species: ForgekinSpecies形态（bio / org / obj / virtual / hybrid）。
        namespace: 命名空间（如 ``"forgemind"`` / ``"contentforge"``）。
        requirement: 锻造需求描述（自然语言）。
        seed_params: 初始种子参数（写入SoulImprint，作为谱系锚点）。
        value_anchors: 价值锚点（对齐 VISION §7 + 15 条红线）。
        capability_profile: 能力画像初始值（可选）。
        evolution_stage: 初始进化阶（默认 E1 萌芽阶）。
        awakening_stage: 初始觉醒阶（默认 E1 全导阶）。
        operator_id: 锻造发起者（operator 命名空间 ID，可选）。

    详见:
        - [doc:design/naming-contract.md#2.4] Forge Nurturing定义
        - [doc:design/naming-contract.md#2.6] SoulImprint seed_params
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    name: str = Field(
        ...,
        min_length=1,
        description="Forgekin显示名（如 '孙悟空' / '客厅吊灯'）。",
    )
    species: ForgekinSpecies = Field(
        ...,
        description="ForgekinSpecies形态（bio / org / obj / virtual / hybrid）。",
    )
    namespace: str = Field(
        ...,
        min_length=1,
        description="命名空间（如 'forgemind' / 'contentforge'）。",
    )
    requirement: str = Field(
        default="",
        description="锻造需求描述（自然语言，供形态定义阶段消费）。",
    )
    seed_params: dict[str, Any] = Field(
        default_factory=dict,
        description="初始种子参数（写入SoulImprint，作为谱系锚点）。",
    )
    value_anchors: list[str] = Field(
        default_factory=list,
        description="价值锚点（对齐 VISION §7 + 15 条红线）。",
    )
    capability_profile: dict[str, Any] = Field(
        default_factory=dict,
        description="能力画像初始值（可选，由能力注入阶段补充）。",
    )
    evolution_stage: EvolutionStage = Field(
        default=EvolutionStage.E1,
        description="初始进化阶（默认 E1 萌芽阶）。",
    )
    awakening_stage: AwakeningStage = Field(
        default=AwakeningStage.E1,
        description="初始觉醒阶（默认 E1 全导阶）。",
    )
    operator_id: str | None = Field(
        default=None,
        description="锻造发起者（operator 命名空间 ID，可选）。",
    )

    @field_validator("namespace")
    @classmethod
    def _namespace_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("namespace 不能为空。")
        return v.strip()

    @field_validator("value_anchors")
    @classmethod
    def _value_anchors_unique(cls, v: list[str]) -> list[str]:
        if len(v) != len(set(v)):
            raise ValueError("value_anchors 不能包含重复项。")
        return list(v)

    @field_validator("name")
    @classmethod
    def _name_stripped(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("name 不能为空白字符。")
        return stripped

    def to_imprint_seed(self) -> dict[str, Any]:
        """生成用于SoulImprint计算的种子参数字典。

        将表单核心字段合并为SoulImprint种子，确保谱系可追溯。``seed_params``
        字段优先，表单核心字段（``name`` / ``species`` / ``namespace``）
        作为基础。
        """
        return {
            "name": self.name,
            "species": self.species.value,
            "namespace": self.namespace,
            "operator_id": self.operator_id,
            **self.seed_params,
        }
