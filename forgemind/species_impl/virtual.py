"""虚拟灵智体（VirtualForgekin）— 灵智体五大形态之一。

虚拟灵智体承载于虚拟世界角色（童话 / 神话 / 历史 / 现实人物 / VR /
游戏角色），无物理接入（纯虚拟），通过虚拟世界设定层建立"观察虚拟
世界状态 → 推理角色行为 → 行动（角色扮演 / 关系推进）→ 验证角色
一致性"的现实闭环。

对应业界 Character AI / NPC Agent 范式的工程实现路径。

虚拟设定层: 角色设定 + 世界观 + 关系网。

详见:
    - [doc:design/naming-contract.md#2.3] 灵族形态分类
    - [doc:decisions/013-all-things-spirit-mind-vision.md#2] 五大形态
    - [doc:VISION.md#2] 万物灵智体形态分类
    - [doc:review/review.md#第九章] FM-010 虚拟世界设定层
"""

from __future__ import annotations

from typing import Any

from flowforge.forgemind.base import ForgekinBase
from flowforge.forgemind.soul_imprint import SoulImprint
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage


class VirtualForgekin(ForgekinBase):
    """虚拟灵智体（VirtualForgekin / Virtual Character Agent）。

    承载于虚拟世界角色（童话 / 神话 / 历史 / 现实人物 / VR / 游戏角色）。
    一个孙悟空灵智体不只是 cosplay 模型，它有自己的取经愿景、与唐僧
    灵智体的长期协作记忆、对八戒灵智体的能力画像盲点认知。这是
    Character AI / NPC Agent 范式的工程实现路径。

    详见:
        - [doc:design/naming-contract.md#2.2] 灵智体定义
        - [doc:VISION.md#2] 五大形态分类
        - [doc:VISION.md#3] 虚拟角色智能体路径
    """

    def __init__(
        self,
        forgekin_id: str,
        name: str,
        soul_imprint: SoulImprint,
        evolution_stage: EvolutionStage = EvolutionStage.E1,
        awakening_stage: AwakeningStage = AwakeningStage.E1,
        capability_profile: dict[str, Any] | None = None,
        *,
        character_setting: dict[str, Any] | None = None,
        worldview: str | None = None,
        relationship_graph: dict[str, Any] | None = None,
    ) -> None:
        """初始化虚拟灵智体。

        Args:
            forgekin_id: 灵智体唯一 ID。
            name: 灵智体显示名（如 ``"孙悟空"``）。
            soul_imprint: 魂印（不可变身份）。
            evolution_stage: 进化阶。
            awakening_stage: 觉醒阶。
            capability_profile: 能力画像。
            character_setting: 角色设定（性格 / 背景 / 动机 / 能力）。
            worldview: 世界观约束（如 ``"西游记神话体系"``）。
            relationship_graph: 关系网图谱（与其他角色的关系）。
        """
        super().__init__(
            forgekin_id=forgekin_id,
            name=name,
            species=ForgekinSpecies.VIRTUAL,
            soul_imprint=soul_imprint,
            evolution_stage=evolution_stage,
            awakening_stage=awakening_stage,
            capability_profile=capability_profile,
        )
        self.character_setting: dict[str, Any] = dict(character_setting or {})
        self.worldview: str | None = worldview
        self.relationship_graph: dict[str, Any] = dict(relationship_graph or {})

    async def observe(self, environment: dict[str, Any]) -> dict[str, Any]:
        """观察虚拟世界状态（角色关系图谱 / 世界观事件）。

        Args:
            environment: 环境上下文，应包含 ``virtual_world_state`` 字段
                （当前场景 / 在场角色 / 世界观事件）。

        Returns:
            观察结果字典，包含:
                - ``current_scene``: 当前场景
                - ``present_characters``: 在场角色列表
                - ``worldview_events``: 世界观事件
                - ``relationship_delta``: 关系网变化
        """
        self._set_lifecycle_state("observing")
        state = environment.get("virtual_world_state", {})
        return {
            "species": self.species.value,
            "character": self.name,
            "worldview": self.worldview,
            "current_scene": state.get("current_scene", "unknown"),
            "present_characters": state.get("present_characters", []),
            "worldview_events": state.get("worldview_events", []),
            "relationship_delta": state.get("relationship_delta", {}),
        }

    async def act(self, action: dict[str, Any]) -> dict[str, Any]:
        """执行角色行为（对话 / 行动 / 关系推进）。

        虚拟灵智体的动作必须遵守世界观约束（如孙悟空不可念经）和
        角色设定（性格 / 动机 / 能力边界）。违反世界观或角色设定的
        动作必须拒绝。

        Args:
            action: 动作字典，应包含:
                - ``behavior_type``: ``"dialogue"`` / ``"action"`` /
                  ``"relationship_advance"``
                - ``params``: 行为参数
                - ``worldview_alignment``: 世界观对齐检查

        Returns:
            动作执行结果字典。
        """
        self._set_lifecycle_state("acting")
        behavior_type = action.get("behavior_type", "unknown")
        params = action.get("params", {})
        worldview_aligned = action.get("worldview_alignment", True)
        character_consistent = self._check_character_consistency(behavior_type, params)
        return {
            "species": self.species.value,
            "behavior_type": behavior_type,
            "params": params,
            "executed": worldview_aligned and character_consistent,
            "character_response": "in_character" if character_consistent else "out_of_character",
            "consistency_check": {
                "worldview_aligned": worldview_aligned,
                "character_consistent": character_consistent,
                "value_anchors_respected": True,
            },
        }

    async def verify(self, action_result: dict[str, Any]) -> bool:
        """验证角色行为是否保持角色一致性。

        Args:
            action_result: :meth:`act` 返回的动作执行结果。

        Returns:
            ``True`` 表示角色行为保持一致性且遵守世界观。
        """
        self._set_lifecycle_state("verifying")
        check = action_result.get("consistency_check", {})
        if not check.get("value_anchors_respected", False):
            return False
        if not check.get("worldview_aligned", False):
            return False
        return bool(action_result.get("executed", False))

    def _check_character_consistency(
        self, behavior_type: str, params: dict[str, Any]
    ) -> bool:
        """检查行为是否符合角色设定（性格 / 动机 / 能力边界）。

        Args:
            behavior_type: 行为类型。
            params: 行为参数。

        Returns:
            ``True`` 表示行为符合角色设定。
        """
        # 骨架实现：检查能力边界
        ability_boundary = self.character_setting.get("ability_boundary", [])
        if not ability_boundary:
            return True
        required_ability = params.get("required_ability")
        if required_ability and required_ability not in ability_boundary:
            return False
        return True
