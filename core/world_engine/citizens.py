"""世界层 9 个一等公民（First-class Citizens）Pydantic 模型。

F093 定义世界层的 9 个一等公民：

    1. World（世界设定）
    2. Character（角色）
    3. Scene（场景）
    4. Canon Decision（典藏决策，世界级不可推翻）
    5. Relationship（关系）
    6. Artifact（造物）
    7. Round（回合）
    8. Branch（分支）
    9. Turn（轮次）

铁律:
    - ``Turn.is_canon`` 默认 ``False``——"RP 台词不自动入典"（CL-010）。
      只有经过 :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
      显式确认的 Turn 才能置为 ``True``。
    - 所有写入世界层的操作必须通过 :class:`CanonDecision` 才能影响 Canon 记忆。

详见:
    - [doc:review/review.md#13.2] CL-008（9 个一等公民未建模）
    - [doc:design/naming-contract.md#2] 12 核心概念命名
    - [doc:features/F093-cats-and-u-world-engine.md] 世界引擎 Feature 规格
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class World(BaseModel):
    """世界设定（World）— 一等公民 1/9。

    一个虚拟世界的完整设定层（如"西游世界"、"现代办公室"）。每个世界由
    :class:`~flowforge.core.world_engine.driver.WorldDriver` 驱动自转。

    属性:
        world_id: 世界唯一 ID。
        name: 世界名称（如 ``"西游记"`` / ``"现代办公室"``）。
        setting: 世界观描述（自由文本）。
        rules: 世界规则列表（如 ``["法术不跨越三界", "因果不灭"]``）。
    """

    model_config = ConfigDict(extra="forbid")

    world_id: str = Field(..., description="世界唯一 ID。")
    name: str = Field(..., description="世界名称。")
    setting: str = Field(..., description="世界观描述。")
    rules: list[str] = Field(default_factory=list, description="世界规则列表。")

    @field_validator("world_id", "name")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("world_id / name 不能为空。")
        return v.strip()


class Character(BaseModel):
    """角色（Character）— 一等公民 2/9。

    世界中的角色定义。一个 :class:`~flowforge.forgemind.base.ForgekinBase`
    灵智体在不同世界中可扮演不同 Character，但其 Core Identity 不变
    （CL-007）。

    属性:
        character_id: 角色唯一 ID（世界内唯一）。
        name: 角色名（如 ``"孙悟空"``）。
        role: 角色定位（如 ``"主角"`` / ``"NPC"`` / ``"反派"``）。
        world_id: 归属世界 ID。
    """

    model_config = ConfigDict(extra="forbid")

    character_id: str = Field(..., description="角色唯一 ID。")
    name: str = Field(..., description="角色名。")
    role: str = Field(..., description="角色定位。")
    world_id: str = Field(..., description="归属世界 ID。")


class Scene(BaseModel):
    """场景（Scene）— 一等公民 3/9。

    世界中的具体场景（时间 + 地点）。一个 Scene 是一组 :class:`Round`
    的容器。

    属性:
        scene_id: 场景唯一 ID。
        world_id: 归属世界 ID。
        location: 地点（如 ``"花果山水帘洞"``）。
        time: 时间（自由格式，如 ``"贞观十三年秋"``）。
    """

    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(..., description="场景唯一 ID。")
    world_id: str = Field(..., description="归属世界 ID。")
    location: str = Field(..., description="地点。")
    time: str = Field(..., description="时间（自由格式）。")


class CanonDecision(BaseModel):
    """典藏决策（Canon Decision）— 一等公民 4/9。

    世界级不可推翻的决策。一旦入典，所有灵智体在该世界中的行为必须遵守。

    **铁律**：Canon Decision 的写入必须经过
    :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
    显式确认（CL-010）。任何 RP 台词不可自动入典。

    属性:
        decision_id: 决策唯一 ID。
        world_id: 归属世界 ID。
        decision: 决策内容（自由文本）。
        decided_by: 决策者（``"operator"`` / ``"canon_driver"`` / ``"council"``）。
        timestamp: 决策时间（UTC）。
    """

    model_config = ConfigDict(extra="forbid")

    decision_id: str = Field(..., description="决策唯一 ID。")
    world_id: str = Field(..., description="归属世界 ID。")
    decision: str = Field(..., description="决策内容。")
    decided_by: str = Field(..., description="决策者。")
    timestamp: datetime = Field(..., description="决策时间（UTC）。")

    @field_validator("decided_by")
    @classmethod
    def _valid_decider(cls, v: str) -> str:
        allowed = {"operator", "canon_driver", "council"}
        if v not in allowed:
            raise ValueError(
                f"decided_by 必须是 {allowed} 之一，收到: {v!r}。"
                "详见 [doc:review/review.md#13.2] CL-010"
            )
        return v


class Relationship(BaseModel):
    """关系（Relationship）— 一等公民 5/9。

    世界中两个角色之间的关系。关系存储在
    :class:`~flowforge.core.world_engine.relational_memory.RelationalMemory`。

    属性:
        relationship_id: 关系唯一 ID。
        character_a: 角色 A 的 ID。
        character_b: 角色 B 的 ID。
        relation_type: 关系类型（如 ``"朋友"`` / ``"敌人"`` / ``"师徒"``）。
    """

    model_config = ConfigDict(extra="forbid")

    relationship_id: str = Field(..., description="关系唯一 ID。")
    character_a: str = Field(..., description="角色 A 的 ID。")
    character_b: str = Field(..., description="角色 B 的 ID。")
    relation_type: str = Field(..., description="关系类型。")


class Artifact(BaseModel):
    """造物（Artifact）— 一等公民 6/9。

    世界中的重要物品（如 ``"金箍棒"`` / ``"紧箍咒"``）。

    属性:
        artifact_id: 造物唯一 ID。
        name: 造物名称。
        world_id: 归属世界 ID。
        properties: 造物属性（自由 dict）。
    """

    model_config = ConfigDict(extra="forbid")

    artifact_id: str = Field(..., description="造物唯一 ID。")
    name: str = Field(..., description="造物名称。")
    world_id: str = Field(..., description="归属世界 ID。")
    properties: dict[str, Any] = Field(
        default_factory=dict, description="造物属性。"
    )


class Round(BaseModel):
    """回合（Round）— 一等公民 7/9。

    一个 :class:`Scene` 中的一个交互回合，包含若干 :class:`Turn`。

    属性:
        round_id: 回合唯一 ID。
        scene_id: 归属场景 ID。
        sequence: 回合序号（在同一 Scene 内递增）。
    """

    model_config = ConfigDict(extra="forbid")

    round_id: str = Field(..., description="回合唯一 ID。")
    scene_id: str = Field(..., description="归属场景 ID。")
    sequence: int = Field(..., ge=0, description="回合序号（≥0）。")


class Branch(BaseModel):
    """分支（Branch）— 一等公民 8/9。

    剧情分支。从一个 :class:`Round` 分叉出多个可能的发展路径。

    属性:
        branch_id: 分支唯一 ID。
        parent_round_id: 父回合 ID。
        description: 分支描述。
    """

    model_config = ConfigDict(extra="forbid")

    branch_id: str = Field(..., description="分支唯一 ID。")
    parent_round_id: str = Field(..., description="父回合 ID。")
    description: str = Field(..., description="分支描述。")


class Turn(BaseModel):
    """轮次（Turn）— 一等公民 9/9。

    单次角色发言/动作。是 RP（Role Play）的最小单位。

    **铁律**：``is_canon`` 默认 ``False``——"RP 台词不自动入典"（CL-010）。
    只有经过
    :class:`~flowforge.core.world_engine.canon_sync.CanonSyncProtocol`
    显式确认的 Turn 才能置为 ``True``，并写入
    :class:`~flowforge.core.world_engine.canon_memory.CanonMemory`。

    属性:
        turn_id: 轮次唯一 ID。
        round_id: 归属回合 ID。
        character_id: 发言角色 ID。
        content: 轮次内容（台词/动作描述）。
        is_canon: 是否已入典。默认 ``False``（铁律 CL-010）。
    """

    model_config = ConfigDict(extra="forbid")

    turn_id: str = Field(..., description="轮次唯一 ID。")
    round_id: str = Field(..., description="归属回合 ID。")
    character_id: str = Field(..., description="发言角色 ID。")
    content: str = Field(..., description="轮次内容（台词/动作）。")
    is_canon: bool = Field(
        default=False,
        description="是否已入典。默认 False（铁律：RP 台词不自动入典，CL-010）。",
    )


__all__ = [
    "World",
    "Character",
    "Scene",
    "CanonDecision",
    "Relationship",
    "Artifact",
    "Round",
    "Branch",
    "Turn",
]
