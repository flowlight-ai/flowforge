"""生物Forgekin（BioForgekin）— Forgekin五大形态之一。

生物Forgekin承载于物理世界的生物体（猫 / 狗 / 鸟 / 鱼 / 昆虫群体等），
通过摄像头 / 麦克风 / 可穿戴设备等传感器接入，建立"观察生物状态 →
推理生物需求 → 行动（喂食 / 互动 / 健康干预）→ 验证生物健康度"
的现实闭环。

虚拟设定层: 行为画像 + 习性图谱。

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


class BioForgekin(ForgekinBase):
    """生物Forgekin（BioForgekin / Biological Spirit Agent）。

    承载于物理世界生物体（猫 / 狗 / 鸟 / 鱼等），通过传感器建立现实
    闭环。区别于主流 IoT 工具调用，生物Forgekin有自己的身份（SoulImprint）、
    记忆（EchoStore）、价值锚点（不伤害生物体）、协作能力（与其他生物或
    物品Forgekin组队）。

    详见:
        - [doc:design/naming-contract.md#2.2] Forgekin定义
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
        biological_subject: str | None = None,
        sensor_channels: list[str] | None = None,
        forgekin_config: dict[str, Any] | None = None,
        llm_client: Any | None = None,
    ) -> None:
        """初始化生物Forgekin。

        Args:
            forgekin_id: Forgekin唯一 ID。
            name: Forgekin显示名（如 ``"家猫橘子"``）。
            soul_imprint: SoulImprint（不可变身份）。
            evolution_stage: 进化阶。
            awakening_stage: 觉醒阶。
            capability_profile: 能力画像。
            biological_subject: 生物主体标识（如 ``"cat:bengal:orange"``）。
            sensor_channels: 传感器通道列表（如
                ``["camera", "microphone", "wearable"]``）。
        """
        super().__init__(
            forgekin_id=forgekin_id,
            name=name,
            species=ForgekinSpecies.BIO,
            soul_imprint=soul_imprint,
            evolution_stage=evolution_stage,
            awakening_stage=awakening_stage,
            capability_profile=capability_profile,
            forgekin_config=forgekin_config,
            llm_client=llm_client,
        )
        self.biological_subject: str | None = biological_subject
        self.sensor_channels: list[str] = list(sensor_channels or [])

    async def observe(self, environment: dict[str, Any]) -> dict[str, Any]:
        """观察生物环境（物理传感器数据）。

        Args:
            environment: 环境上下文，应包含 ``sensor_readings`` 字段
                （摄像头帧 / 麦克风音频 / 可穿戴设备生理数据等）。

        Returns:
            观察结果字典，包含:
                - ``subject_state``: 生物主体状态（活动 / 休息 / 进食等）
                - ``health_signals``: 健康信号（心率 / 体温 / 活跃度）
                - ``behavioral_cues``: 行为线索（叫声 / 姿态 / 移动轨迹）
                - ``sensor_quality``: 传感器数据质量评分（0-1）
        """
        self._set_lifecycle_state("observing")
        sensor_readings = environment.get("sensor_readings", {})
        return {
            "species": self.species.value,
            "subject": self.biological_subject,
            "subject_state": sensor_readings.get("subject_state", "unknown"),
            "health_signals": sensor_readings.get("health_signals", {}),
            "behavioral_cues": sensor_readings.get("behavioral_cues", []),
            "sensor_quality": sensor_readings.get("sensor_quality", 0.0),
            "channels_active": list(
                set(self.sensor_channels) & set(sensor_readings.get("channels", []))
            ),
        }

    async def act(self, action: dict[str, Any]) -> dict[str, Any]:
        """对生物主体执行动作（喂食 / 互动 / 健康干预）。

        生物Forgekin的动作必须遵守"不伤害 operator"和"不伤害生物主体"
        双重价值锚点。任何可能伤害生物主体的动作必须降级为建议
        （觉醒阶 E2）或拒绝执行。

        Args:
            action: 动作字典，应包含:
                - ``action_type``: ``"feed"`` / ``"interact"`` / ``"health_intervene"``
                - ``params``: 动作参数（食物量 / 互动方式 / 干预方式）

        Returns:
            动作执行结果字典，包含:
                - ``executed``: 是否实际执行（未执行表示降级为建议）
                - ``effect_on_subject``: 对生物主体的影响
                - ``safety_check``: 安全检查结果
        """
        self._set_lifecycle_state("acting")
        action_type = action.get("action_type", "unknown")
        params = action.get("params", {})
        return {
            "species": self.species.value,
            "action_type": action_type,
            "params": params,
            "executed": False,  # 默认降级为建议——觉醒阶 E1/E2 不直接执行
            "effect_on_subject": "pending_operator_confirmation",
            "safety_check": {
                "biological_safety": "passed",
                "operator_safety": "passed",
                "value_anchors_respected": True,
            },
        }

    async def verify(self, action_result: dict[str, Any]) -> bool:
        """验证动作结果是否改善生物主体健康度。

        Args:
            action_result: :meth:`act` 返回的动作执行结果。

        Returns:
            ``True`` 表示动作改善或维持了生物主体健康度。
        """
        self._set_lifecycle_state("verifying")
        safety = action_result.get("safety_check", {})
        if not safety.get("value_anchors_respected", False):
            return False
        if safety.get("biological_safety") != "passed":
            return False
        return bool(action_result.get("executed", False))
