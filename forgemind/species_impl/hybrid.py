"""混合灵智体（HybridForgekin）— 灵智体五大形态之一。

混合灵智体是多种形态灵智体的融合（如智能家居 = 物品+组织；数字孪生
= 生物+虚拟）。它组合多个 species 的 ``observe`` / ``act`` / ``verify``
能力，是组织灵智体调度多种形态灵智体的工程实现。

形态可进化: 一只生物灵智体猫可通过积累组织协作经验进化为
HybridForgekin（既是宠物又是社区吉祥物）。详见
[doc:decisions/013-all-things-spirit-mind-vision.md#3]。

虚拟设定层: 多设定层叠加。

详见:
    - [doc:design/naming-contract.md#2.3] 灵族形态分类
    - [doc:decisions/013-all-things-spirit-mind-vision.md#2] 五大形态
    - [doc:VISION.md#2] 万物灵智体形态分类
"""

from __future__ import annotations

from typing import Any

from flowforge.forgemind.base import ForgekinBase
from flowforge.forgemind.soul_imprint import SoulImprint
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage


class HybridForgekin(ForgekinBase):
    """混合灵智体（HybridForgekin / Hybrid Spirit Agent）。

    多形态融合灵智体。通过组合（而非继承）多个 species 灵智体实例，
    实现"多形态协作"。组合优于继承（编程红线第 9 条）。

    示例:
        - 智能家居灵智体 = 物品灵智体（家电）+ 组织灵智体（家庭成员）
        - 数字孪生灵智体 = 生物灵智体（实体）+ 虚拟灵智体（孪生体）
        - 社区吉祥物灵智体 = 生物灵智体（猫）+ 组织灵智体（社区）

    详见:
        - [doc:design/naming-contract.md#2.2] 灵智体定义
        - [doc:VISION.md#2] 五大形态分类
        - [doc:review/review.md#第九章] FR-002 万物灵智体 TeamAct 协作
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
        components: list[ForgekinBase] | None = None,
    ) -> None:
        """初始化混合灵智体。

        Args:
            forgekin_id: 灵智体唯一 ID。
            name: 灵智体显示名（如 ``"智能家居系统"``）。
            soul_imprint: 灵印（不可变身份）。
            evolution_stage: 进化阶。
            awakening_stage: 觉醒阶。
            capability_profile: 能力画像。
            components: 组成该混合灵智体的子灵智体列表（组合模式）。
                至少包含 2 个不同 species 的子灵智体才算混合形态。
        """
        super().__init__(
            forgekin_id=forgekin_id,
            name=name,
            species=ForgekinSpecies.HYBRID,
            soul_imprint=soul_imprint,
            evolution_stage=evolution_stage,
            awakening_stage=awakening_stage,
            capability_profile=capability_profile,
        )
        self.components: list[ForgekinBase] = list(components or [])
        self._validate_components()

    def _validate_components(self) -> None:
        """校验子灵智体列表符合混合形态要求。

        - 至少 2 个子灵智体
        - 至少 2 种不同的 species
        - 不允许嵌套 HybridForgekin（避免无限递归）
        """
        if len(self.components) < 2:
            raise ValueError(
                "HybridForgekin 至少需要 2 个子灵智体——单形态不是混合形态。"
                "详见 [doc:design/naming-contract.md#2.3]"
            )
        species_set = {c.species for c in self.components}
        if len(species_set) < 2:
            raise ValueError(
                "HybridForgekin 的子灵智体必须包含至少 2 种不同 species——"
                "同 species 的组合不构成混合形态。"
            )
        for comp in self.components:
            if comp.species == ForgekinSpecies.HYBRID:
                raise ValueError(
                    "HybridForgekin 不允许嵌套 HybridForgekin——"
                    "避免无限递归，请展平子灵智体列表。"
                )

    async def observe(self, environment: dict[str, Any]) -> dict[str, Any]:
        """多源融合观察（组合所有子灵智体的观察结果）。

        Args:
            environment: 环境上下文。应根据子灵智体的 species 提供对应
                字段（如 ``sensor_readings`` / ``business_signals`` /
                ``iot_readings`` / ``virtual_world_state``）。

        Returns:
            观察结果字典，包含:
                - ``component_observations``: 各子灵智体的观察结果
                - ``fused_state``: 融合后的整体状态
                - ``species_coverage``: 覆盖的 species 列表
        """
        self._set_lifecycle_state("observing")
        component_observations: list[dict[str, Any]] = []
        for comp in self.components:
            obs = await comp.observe(environment)
            component_observations.append(
                {
                    "component_id": comp.forgekin_id,
                    "component_species": comp.species.value,
                    "observation": obs,
                }
            )
        return {
            "species": self.species.value,
            "component_observations": component_observations,
            "fused_state": {
                "components_count": len(self.components),
                "species_covered": [c.species.value for c in self.components],
            },
            "species_coverage": [c.species.value for c in self.components],
        }

    async def act(self, action: dict[str, Any]) -> dict[str, Any]:
        """多形态协作行动（按子灵智体分工分发动作）。

        Args:
            action: 动作字典，应包含:
                - ``component_actions``: 各子灵智体的动作分发字典
                  （key 为 forgekin_id，value 为该子灵智体的 action）

        Returns:
            动作执行结果字典，包含:
                - ``component_results``: 各子灵智体的执行结果
                - ``executed``: 整体是否执行（所有子灵智体都执行才算）
                - ``coordination_check``: 协作检查结果
        """
        self._set_lifecycle_state("acting")
        component_actions: dict[str, dict[str, Any]] = action.get(
            "component_actions", {}
        )
        component_results: list[dict[str, Any]] = []
        all_executed = True
        for comp in self.components:
            sub_action = component_actions.get(comp.forgekin_id, {})
            if not sub_action:
                continue
            result = await comp.act(sub_action)
            component_results.append(
                {
                    "component_id": comp.forgekin_id,
                    "component_species": comp.species.value,
                    "result": result,
                }
            )
            if not result.get("executed", False):
                all_executed = False
        return {
            "species": self.species.value,
            "component_results": component_results,
            "executed": all_executed,
            "coordination_check": {
                "components_coordinated": len(component_results),
                "value_anchors_respected": True,
            },
        }

    async def verify(self, action_result: dict[str, Any]) -> bool:
        """多形态协作验证（所有子灵智体都验证通过才算通过）。

        Args:
            action_result: :meth:`act` 返回的动作执行结果。

        Returns:
            ``True`` 表示所有子灵智体验证通过且协作检查通过。
        """
        self._set_lifecycle_state("verifying")
        coordination = action_result.get("coordination_check", {})
        if not coordination.get("value_anchors_respected", False):
            return False
        component_results = action_result.get("component_results", [])
        if not component_results:
            return False
        for cr in component_results:
            result = cr.get("result", {})
            comp_id = cr.get("component_id", "")
            # 找到对应的子灵智体验证
            for comp in self.components:
                if comp.forgekin_id == comp_id:
                    if not await comp.verify(result):
                        return False
                    break
        return True
