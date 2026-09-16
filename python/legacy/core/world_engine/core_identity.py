"""核心身份层（Core Identity Layer）— Forgekin的不可变身份。

F093 三层世界引擎的第一层。此层**不可被任何 Episode 污染**——即使
Forgekin演了 1000 次"孙悟空"，核心身份仍是"写作Forgekin"。

设计要点:
    - **完全不可变**：使用 ``Pydantic v2 ConfigDict(frozen=True)``，所有
      字段一旦创建即不可修改。这是身份隔离的物理保证。
    - **与 MindProfile 分离**：v7.0 的 MindProfile 是可变结构（任务经验
      可修改 persona/values/skills），无法承担 Core Identity 职责。本类
      与 MindProfile 严格分离，只承载不可变身份。
    - **SoulImprint引用**：``soul_imprint_hash`` 引用
      :class:`~flowforge.forgemind.soul_imprint.SoulImprint` 的哈希，作为
      谱系追踪的锚点。

修复的问题:
    - CL-007：v7.0 Forgekin无 Core Identity 隔离层，导致身份漂移。
      本层是"不可变身份锚点"，即使世界层全部崩塌，核心身份仍可重建。

详见:
    - [doc:review/review.md#13.2] CL-007（v7.0 Forgekin无 Core Identity 隔离层）
    - [doc:design/naming-contract.md#2.6] SoulImprint定义
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CoreIdentityLayer(BaseModel):
    """核心身份层（Core Identity Layer）— Forgekin的不可变身份。

    此层不可被任何 Episode 污染。即使Forgekin演了 1000 次"孙悟空"，核心
    身份仍是"写作Forgekin"。

    与 :class:`~flowforge.forgemind.base.ForgekinBase` 的关系:
        - ``ForgekinBase`` 是Forgekin的运行时基类，承载可变的 evolution_stage
          / awakening_stage / capability_profile。
        - ``CoreIdentityLayer`` 是Forgekin的不可变身份锚点，**只承载不可变
          字段**。一个 Forgekin 实例持有一个 CoreIdentityLayer 实例。

    不可变性:
        使用 ``ConfigDict(frozen=True)``。任何字段赋值尝试都会抛出
        ``ValidationError``。这是身份隔离的物理保证，防止 RP 污染。

    属性:
        forgekin_id: Forgekin唯一 ID（如 ``"forgemind:writer_cat"``）。
        name: Forgekin显示名（不可变身份名）。
        species: ForgekinSpecies形态值（:class:`~flowforge.forgemind.species.ForgekinSpecies`
            的 value，如 ``"bio"`` / ``"virtual"``）。
        birth_timestamp: 出生时间（UTC）。
        core_personality: 核心性格列表（不可变，如 ``["沉稳", "好奇"]``）。
        value_anchors: 价值锚点列表（不可变，对齐 VISION §7 + 15 条红线）。
        soul_imprint_hash: SoulImprint哈希（引用
            :class:`~flowforge.forgemind.soul_imprint.SoulImprint.imprint_hash`）。

    详见:
        - [doc:review/review.md#13.2] CL-007
        - [doc:design/naming-contract.md#2.6] SoulImprint
    """

    model_config = ConfigDict(
        frozen=True,  # 完全不可变——铁律：核心身份不可被污染
        extra="forbid",
        validate_assignment=True,
    )

    forgekin_id: str = Field(..., description="Forgekin唯一 ID。")
    name: str = Field(..., description="Forgekin显示名（不可变）。")
    species: str = Field(
        ...,
        description="ForgekinSpecies形态值（ForgekinSpecies.value，如 'bio' / 'virtual'）。",
    )
    birth_timestamp: datetime = Field(..., description="出生时间（UTC）。")
    core_personality: list[str] = Field(
        default_factory=list,
        description="核心性格（不可变，不受 RP 污染）。",
    )
    value_anchors: list[str] = Field(
        default_factory=list,
        description="价值锚点（不可变，对齐 VISION §7 + 15 条红线）。",
    )
    soul_imprint_hash: str = Field(
        ...,
        description="SoulImprint哈希（引用 SoulImprint.imprint_hash，谱系追踪锚点）。",
    )

    @field_validator("forgekin_id", "name", "species", "soul_imprint_hash")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError(
                "forgekin_id / name / species / soul_imprint_hash 不能为空。"
                "详见 [doc:review/review.md#13.2] CL-007"
            )
        return v.strip()

    @field_validator("core_personality", "value_anchors")
    @classmethod
    def _unique_items(cls, v: list[str]) -> list[str]:
        if len(v) != len(set(v)):
            raise ValueError("core_personality / value_anchors 不能包含重复项。")
        return list(v)

    def describe(self) -> dict[str, Any]:
        """返回核心身份描述字典（用于日志 / 谱系追踪 / UI 展示）。

        Returns:
            包含所有不可变字段的字典。
        """
        return {
            "forgekin_id": self.forgekin_id,
            "name": self.name,
            "species": self.species,
            "birth_timestamp": self.birth_timestamp.isoformat(),
            "core_personality": list(self.core_personality),
            "value_anchors": list(self.value_anchors),
            "soul_imprint_hash": self.soul_imprint_hash,
            "layer": "core_identity",
            "immutable": True,
        }

    def verify_imprint(self, soul_imprint_hash: str) -> bool:
        """校验传入的SoulImprint哈希是否与核心身份记录的一致。

        用于跨 session / 跨代际身份验证。如果返回 ``False``，说明核心身份
        与SoulImprint不一致，身份可信度受损。

        Args:
            soul_imprint_hash: 待校验的SoulImprint哈希。

        Returns:
            ``True`` 表示哈希一致，身份可信。
        """
        return self.soul_imprint_hash == soul_imprint_hash


__all__ = ["CoreIdentityLayer"]
