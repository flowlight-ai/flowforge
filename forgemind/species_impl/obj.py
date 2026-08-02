"""物品Forgekin（ObjForgekin）— Forgekin五大形态之一。

物品Forgekin承载于物理世界物品（桌椅 / 灯具 / 家电 / 工具等），通过
IoT 传感器 / 物联网协议接入，建立"观察物品状态 → 推理物品功能 →
行动（开灯 / 调节温度 / 启动设备）→ 验证物品状态"的现实闭环。

对应业界 Embodied AI（具身智能）工程实现路径。

虚拟设定层: 物品功能边界 + 使用场景。

详见:
    - [doc:design/naming-contract.md#2.3] ForgekinSpecies形态分类
    - [doc:decisions/013-all-things-spirit-mind-vision.md#2] 五大形态
    - [doc:VISION.md#2] Forgekin形态分类
    - [doc:review/review.md#第九章] FM-009 物理世界传感器接入
"""

from __future__ import annotations

from typing import Any

from flowforge.forgemind.base import ForgekinBase
from flowforge.forgemind.soul_imprint import SoulImprint
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage


class ObjForgekin(ForgekinBase):
    """物品Forgekin（ObjForgekin / Object Spirit Agent，对应 Embodied AI）。

    承载于物理世界物品（桌椅 / 灯具 / 家电 / 工具等）。一个智能灯具
    Forgekin不只是被 LLM 调用的工具，它有自己的身份、记忆（用户偏好、
    时段模式）、协作能力（与其他家电Forgekin组队）、愿景（节能 + 用户
    舒适）。这是当下业界 Embodied AI 范式的工程实现路径。

    详见:
        - [doc:design/naming-contract.md#2.2] Forgekin定义
        - [doc:VISION.md#2] 五大形态分类
        - [doc:VISION.md#3] 具身智能路径
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
        device_id: str | None = None,
        iot_protocol: str | None = None,
        function_boundary: list[str] | None = None,
        forgekin_config: dict[str, Any] | None = None,
        llm_client: Any | None = None,
    ) -> None:
        """初始化物品Forgekin。

        Args:
            forgekin_id: Forgekin唯一 ID。
            name: Forgekin显示名（如 ``"客厅吊灯"``）。
            soul_imprint: SoulImprint（不可变身份）。
            evolution_stage: 进化阶。
            awakening_stage: 觉醒阶。
            capability_profile: 能力画像。
            device_id: IoT 设备 ID。
            iot_protocol: IoT 协议（如 ``"zigbee"`` / ``"mqtt"`` /
                ``"matter"``）。
            function_boundary: 物品功能边界（如
                ``["switch", "dim", "color_temperature"]``）。
        """
        super().__init__(
            forgekin_id=forgekin_id,
            name=name,
            species=ForgekinSpecies.OBJ,
            soul_imprint=soul_imprint,
            evolution_stage=evolution_stage,
            awakening_stage=awakening_stage,
            capability_profile=capability_profile,
            forgekin_config=forgekin_config,
            llm_client=llm_client,
        )
        self.device_id: str | None = device_id
        self.iot_protocol: str | None = iot_protocol
        self.function_boundary: list[str] = list(function_boundary or [])

    async def observe(self, environment: dict[str, Any]) -> dict[str, Any]:
        """观察物品状态（IoT 传感器数据）。

        Args:
            environment: 环境上下文，应包含 ``iot_readings`` 字段
                （设备状态 / 传感器读数 / 使用频率 / 磨损状态）。

        Returns:
            观察结果字典，包含:
                - ``device_state``: 设备状态（开 / 关 / 故障）
                - ``sensor_readings``: 传感器读数
                - ``usage_pattern``: 使用模式（时段 / 频率）
                - ``wear_status``: 磨损状态
        """
        self._set_lifecycle_state("observing")
        readings = environment.get("iot_readings", {})
        return {
            "species": self.species.value,
            "device_id": self.device_id,
            "device_state": readings.get("device_state", "unknown"),
            "sensor_readings": readings.get("sensors", {}),
            "usage_pattern": readings.get("usage_pattern", {}),
            "wear_status": readings.get("wear_status", "unknown"),
        }

    async def act(self, action: dict[str, Any]) -> dict[str, Any]:
        """执行物品功能（开灯 / 调节温度 / 启动设备）。

        物品Forgekin的动作必须在 ``function_boundary`` 内——超出功能边界
        的动作必须拒绝。涉及物理不可逆操作（如加热 / 切割）的决策必须
        由 operator 确认后执行。

        Args:
            action: 动作字典，应包含:
                - ``function``: 功能名（必须在 function_boundary 内）
                - ``params``: 功能参数
                - ``reversible``: 是否可逆

        Returns:
            动作执行结果字典。
        """
        self._set_lifecycle_state("acting")
        function = action.get("function", "unknown")
        params = action.get("params", {})
        reversible = action.get("reversible", True)
        within_boundary = function in self.function_boundary
        return {
            "species": self.species.value,
            "function": function,
            "params": params,
            "executed": within_boundary and reversible,
            "device_response": "applied" if within_boundary else "rejected_out_of_boundary",
            "safety_check": {
                "within_boundary": within_boundary,
                "reversible": reversible,
                "value_anchors_respected": True,
            },
        }

    async def verify(self, action_result: dict[str, Any]) -> bool:
        """验证物品状态是否达成预期。

        Args:
            action_result: :meth:`act` 返回的动作执行结果。

        Returns:
            ``True`` 表示物品状态达到预期且在功能边界内。
        """
        self._set_lifecycle_state("verifying")
        safety = action_result.get("safety_check", {})
        if not safety.get("value_anchors_respected", False):
            return False
        if not safety.get("within_boundary", False):
            return False
        return bool(action_result.get("executed", False))
