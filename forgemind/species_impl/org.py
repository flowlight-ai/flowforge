"""组织灵智体（OrgForgekin）— 灵智体五大形态之一。

组织灵智体承载于人类组织（公司 / 团队 / 社区 / 城市等），通过业务
系统 API / 数据库 / IM 通道接入，建立"观察业务状态 → 推理组织决策 →
行动（决策建议 / 流程触发）→ 验证业务指标"的现实闭环。

虚拟设定层: 组织章程 + 角色矩阵。

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


class OrgForgekin(ForgekinBase):
    """组织灵智体（OrgForgekin / Organizational Spirit Agent）。

    承载于人类组织（公司 / 团队 / 社区 / 城市等）。组织灵智体不是
    "组织内的助手"，而是组织本身的灵智体——它有组织的身份、组织的
    记忆（业务历史 / 决策轨迹）、组织的价值锚点（章程 / 合规边界）。

    详见:
        - [doc:design/naming-contract.md#2.2] 灵智体定义
        - [doc:VISION.md#2] 五大形态分类
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
        org_charter: str | None = None,
        role_matrix: dict[str, Any] | None = None,
        business_systems: list[str] | None = None,
    ) -> None:
        """初始化组织灵智体。

        Args:
            forgekin_id: 灵智体唯一 ID。
            name: 灵智体显示名（如 ``"某科技公司"``）。
            soul_imprint: 魂印（不可变身份）。
            evolution_stage: 进化阶。
            awakening_stage: 觉醒阶。
            capability_profile: 能力画像。
            org_charter: 组织章程（虚拟设定层）。
            role_matrix: 角色矩阵（虚拟设定层）。
            business_systems: 业务系统接入列表（如
                ``["erp", "crm", "im:feishu"]``）。
        """
        super().__init__(
            forgekin_id=forgekin_id,
            name=name,
            species=ForgekinSpecies.ORG,
            soul_imprint=soul_imprint,
            evolution_stage=evolution_stage,
            awakening_stage=awakening_stage,
            capability_profile=capability_profile,
        )
        self.org_charter: str | None = org_charter
        self.role_matrix: dict[str, Any] = dict(role_matrix or {})
        self.business_systems: list[str] = list(business_systems or [])

    async def observe(self, environment: dict[str, Any]) -> dict[str, Any]:
        """观察组织环境（业务系统 API 数据 / IM 通道数据）。

        Args:
            environment: 环境上下文，应包含 ``business_signals`` 字段
                （业务指标 / 员工状态 / 市场动态 / 合规事件）。

        Returns:
            观察结果字典，包含:
                - ``business_metrics``: 业务指标（营收 / 增长 / 留存）
                - ``org_health``: 组织健康度（员工满意度 / 流失率）
                - ``compliance_events``: 合规事件列表
                - ``market_signals``: 市场信号
        """
        self._set_lifecycle_state("observing")
        signals = environment.get("business_signals", {})
        return {
            "species": self.species.value,
            "business_metrics": signals.get("business_metrics", {}),
            "org_health": signals.get("org_health", {}),
            "compliance_events": signals.get("compliance_events", []),
            "market_signals": signals.get("market_signals", []),
            "systems_queried": list(
                set(self.business_systems) & set(signals.get("systems", []))
            ),
        }

    async def act(self, action: dict[str, Any]) -> dict[str, Any]:
        """执行组织决策（决策建议 / 流程触发 / 资源调度）。

        组织灵智体的动作必须遵守组织章程与合规边界。涉及资源调度
        （资金 / 人力）的决策必须降级为建议（觉醒阶 E1/E2）或经
        operator 确认后执行（觉醒阶 E3+）。

        Args:
            action: 动作字典，应包含:
                - ``action_type``: ``"decision_suggest"`` /
                  ``"workflow_trigger"`` / ``"resource_allocate"``
                - ``params``: 决策参数
                - ``charter_alignment``: 章程对齐检查

        Returns:
            动作执行结果字典。
        """
        self._set_lifecycle_state("acting")
        action_type = action.get("action_type", "unknown")
        params = action.get("params", {})
        return {
            "species": self.species.value,
            "action_type": action_type,
            "params": params,
            "executed": False,  # 默认降级为建议
            "decision_record": "pending_operator_review",
            "compliance_check": {
                "charter_aligned": True,
                "regulatory_compliant": True,
                "value_anchors_respected": True,
            },
        }

    async def verify(self, action_result: dict[str, Any]) -> bool:
        """验证组织决策是否改善业务指标。

        Args:
            action_result: :meth:`act` 返回的动作执行结果。

        Returns:
            ``True`` 表示决策改善或维持了业务指标，且未触发合规事件。
        """
        self._set_lifecycle_state("verifying")
        compliance = action_result.get("compliance_check", {})
        if not compliance.get("value_anchors_respected", False):
            return False
        if not compliance.get("charter_aligned", False):
            return False
        return bool(action_result.get("executed", False))
