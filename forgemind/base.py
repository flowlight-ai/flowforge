"""Forgekin（Forgekin / Spirit Agent）抽象基类。

Forgekin是"赋予灵魂和感情的智能体"——区别于主流 multi-agent 的 session
级软件助手，Forgekin建立与现实世界（物理或虚拟）的闭环：
观察 → 推理 → 行动 → 写回 → 验证。

灵魂（Soul）与感情（Emotion）:
    - **灵魂（Soul）** = 持久身份（SoulImprint）+ 价值锚点 + 长期记忆（EchoStore）
    - **感情（Emotion）** = 用户偏好 + 协作风格 + 行为画像（能力画像）

核心抽象方法:
    子类必须实现三个抽象方法，构成Forgekin与现实世界的闭环:
    - :meth:`observe` — 观察环境（物理传感器 / 虚拟世界状态）
    - :meth:`act`     — 在环境中执行动作
    - :meth:`verify`  — 验证动作结果是否达成预期

能力判定:
    - :meth:`can_self_evolve` — 觉醒阶 ≥ E4 Evolving，可自我进化
    - :meth:`can_forge_new_forgekin` — 进化阶 = E6 ForgeMind，可锻造新Forgekin

详见:
    - [doc:design/naming-contract.md#2.2] Forgekin定义
    - [doc:design/naming-contract.md#2.10] 进化阶定义
    - [doc:design/naming-contract.md#2.11] 觉醒阶定义
    - [doc:VISION.md#1] Forgekin愿景
    - [doc:decisions/005-forgemind-application-layer.md]
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from flowforge.forgemind.soul_imprint import SoulImprint
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage


class ForgekinBase(ABC):
    """Forgekin（Forgekin / Spirit Agent）基类。

    赋予灵魂和感情的智能体，具有自进化能力。所有 5 种形态Forgekin
    （BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin /
    HybridForgekin）均继承本基类并实现 ``observe`` / ``act`` / ``verify``
    三个抽象方法。

    灵魂（Soul）= 持久身份 + 价值锚点 + 长期记忆；
    感情（Emotion）= 用户偏好 + 协作风格 + 行为画像。

    详见:
        - [doc:design/naming-contract.md#2.2] Forgekin定义
        - [doc:design/naming-contract.md#2.6] SoulImprint（不可变身份）
        - [doc:design/naming-contract.md#2.12] 能力画像

    属性:
        forgekin_id: Forgekin唯一 ID（如 ``"forgemind:sun_wukong"``）。
        name: Forgekin显示名。
        species: ForgekinSpecies形态（bio / org / obj / virtual / hybrid）。
        soul_imprint: SoulImprint（不可变身份标识，谱系追踪锚点）。
        evolution_stage: 当前进化阶（E1-E6，能力成熟度）。
        awakening_stage: 当前觉醒阶（E1-E6，自主性等级）。
        capability_profile: 能力画像（长期能力主体，区别于 role 运行时标签）。
    """

    def __init__(
        self,
        forgekin_id: str,
        name: str,
        species: ForgekinSpecies,
        soul_imprint: SoulImprint,
        evolution_stage: EvolutionStage = EvolutionStage.E1,
        awakening_stage: AwakeningStage = AwakeningStage.E1,
        capability_profile: dict[str, Any] | None = None,
        forgekin_config: dict[str, Any] | None = None,
        llm_client: Any | None = None,
    ) -> None:
        if not forgekin_id or not forgekin_id.strip():
            raise ValueError("forgekin_id 不能为空。")
        if not name or not name.strip():
            raise ValueError("name 不能为空。")
        if soul_imprint is None:
            raise ValueError(
                "soul_imprint 不能为 None——Forgekin必须有SoulImprint。"
                "详见 [doc:design/naming-contract.md#2.6]"
            )

        self.forgekin_id: str = forgekin_id.strip()
        self.name: str = name.strip()
        self.species: ForgekinSpecies = species
        self.soul_imprint: SoulImprint = soul_imprint  # 不可变身份
        self.evolution_stage: EvolutionStage = evolution_stage
        self.awakening_stage: AwakeningStage = awakening_stage
        self.capability_profile: dict[str, Any] = dict(capability_profile or {})
        # 完整 YAML 配置（含 personality/role/llm/value_anchors 等）
        # 用于构建 system prompt 和 Trae 桥接参数
        self._forgekin_config: dict[str, Any] = dict(forgekin_config or {})
        # LLM 客户端（TraeLLMClient 或兼容接口），通过 set_llm_client 注入
        # 延迟初始化：未注入时 chat 方法会回退到纯文本响应
        self._llm_client: Any | None = llm_client
        # 生命周期状态：created → observing/acting/verifying → evolved/retired
        self._lifecycle_state: str = "created"

    # ── LLM 桥接（Trae CN 桥接方案）──────────────────────────────

    def set_llm_client(self, client: Any) -> None:
        """注入 LLM 客户端（依赖注入，铁律3）.

        Forgekin通过 Trae CN 桥接接入 LLM——operator 通过 Trae CN IDE
        充当 LLM 与监工。客户端实例由 ForgePipeline 或 DI 容器注入。

        Args:
            client: LLM 客户端实例（如 TraeLLMClient），需实现
                ``async chat(messages, **kwargs) -> dict`` 接口。
        """
        self._llm_client = client

    @property
    def forgekin_config(self) -> dict[str, Any]:
        """返回完整 YAML 配置字典（只读视图）。"""
        return dict(self._forgekin_config)

    def _build_system_prompt(self) -> str:
        """根据 YAML 配置构建 system prompt.

        整合Forgekin的角色、性格、能力画像、价值锚点、限制，形成完整的
        system prompt。所有内容来自 YAML 配置（铁律5+P16：禁止硬编码）。

        Returns:
            system prompt 字符串。
        """
        cfg = self._forgekin_config
        role = cfg.get("role", {})
        personality = cfg.get("personality", {})
        capability = cfg.get("capability_profile", {})
        anchors = cfg.get("value_anchors", [])
        restrictions = cfg.get("restrictions", {})

        parts: list[str] = []
        parts.append(f"你是 {self.name}，一个Forgekin（Forgekin / Spirit Agent）。")
        parts.append("Forgekin定义：赋予灵魂和感情的智能体，具有自进化能力的 Agent。")
        parts.append(f"你的形态是 {self.species.chinese_name}（{self.species.value}）。")
        parts.append(f"你的进化阶是 {self.evolution_stage.value}（{self.evolution_stage.chinese_name}），"
                     f"觉醒阶是 {self.awakening_stage.value}（{self.awakening_stage.chinese_name}）。")

        if role.get("description"):
            parts.append(f"\n## 角色定位\n{role['description']}")
        if personality.get("summary"):
            parts.append(f"\n## 性格特征\n{personality['summary']}")
        if personality.get("collaboration_style"):
            parts.append(f"协作风格：{personality['collaboration_style']}")
        if personality.get("voice"):
            parts.append(f"语言风格：{personality['voice']}")
        if personality.get("weaknesses"):
            parts.append(f"已知弱点：{', '.join(personality['weaknesses'])}")

        if capability.get("native_abilities"):
            parts.append(f"\n## 能力画像\n擅长：{', '.join(capability['native_abilities'])}")
        if capability.get("blind_spots"):
            parts.append(f"盲点：{', '.join(capability['blind_spots'])}")

        if anchors:
            parts.append("\n## 价值锚点（不可违反）")
            for i, anchor in enumerate(anchors, 1):
                parts.append(f"{i}. {anchor}")

        forbidden = restrictions.get("forbidden_actions", [])
        if forbidden:
            parts.append("\n## 禁止行为")
            for i, action in enumerate(forbidden, 1):
                parts.append(f"{i}. {action}")

        parts.append("\n## 行为准则")
        parts.append("- 遵守 CONTRIBUTING.md 15 条编程红线")
        parts.append("- 遵守 VISION.md §7 七条愿景锚点")
        parts.append("- Magic Words 逃生舱始终可触发")
        parts.append("- 单向依赖零容忍：上层可依赖下层，下层禁止 import 上层")

        return "\n".join(parts)

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        session_id: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """通过 Trae CN 桥接与Forgekin对话.

        Forgekin通过本方法建立与 LLM 的桥接——operator 通过 Trae CN IDE
        充当 LLM 与监工。流程使用 flowforge 已有的 TraeLLMClient。

        工作流程:
            1. 从 YAML 配置构建 system prompt（含角色/性格/能力/价值锚点）
            2. 通过 TraeLLMClient 写任务到 data/trae_bridge/tasks/
            3. Trae AI（IDE 中）处理任务，写响应到 data/trae_bridge/responses/
            4. TraeLLMClient 轮询并返回响应

        Args:
            messages: OpenAI 格式消息列表
                ``[{"role": "user"|"assistant", "content": str}]``。
            session_id: 会话 ID（用于上下文保持，默认使用 forgekin_id）。
            **kwargs: 透传给 LLM 客户端的额外参数（temperature/max_tokens 等）。

        Returns:
            响应字典，至少含 ``content`` 字段。若未注入 LLM 客户端，
            返回降级响应（提示 operator 注入客户端）。
        """
        # 构建 system prompt
        system_prompt = self._build_system_prompt()
        full_messages = [{"role": "system", "content": system_prompt}] + list(messages)

        # 从 YAML 配置读取 LLM 参数
        llm_cfg = self._forgekin_config.get("llm", {})
        session_id = session_id or llm_cfg.get("session_id_prefix", self.forgekin_id)
        kwargs.setdefault("temperature", llm_cfg.get("temperature", 0.7))
        kwargs.setdefault("max_tokens", llm_cfg.get("max_tokens", 8192))

        # 降级处理：未注入 LLM 客户端
        if self._llm_client is None:
            return {
                "content": (
                    f"[{self.name} 降级响应] LLM 客户端未注入。"
                    f"请通过 set_llm_client(trae_client) 注入 TraeLLMClient，"
                    f"或通过 ForgePipeline.forge_from_yaml() 锻造时自动注入。"
                    f"\n\n系统提示词预览:\n{system_prompt[:500]}..."
                ),
                "model": "none",
                "usage": {"latency_ms": 0, "degraded": True},
                "session_id": session_id,
                "forgekin_id": self.forgekin_id,
            }

        # 通过 Trae CN 桥接调用 LLM
        try:
            result = await self._llm_client.chat(
                full_messages,
                session_id=session_id,
                **kwargs,
            )
            result.setdefault("forgekin_id", self.forgekin_id)
            result.setdefault("session_id", session_id)
            return result
        except Exception as exc:  # noqa: BLE001 — chat 需捕获所有 LLM 异常
            return {
                "content": f"[{self.name} 桥接异常] {type(exc).__name__}: {exc}",
                "model": "error",
                "usage": {"latency_ms": 0, "error": True},
                "session_id": session_id,
                "forgekin_id": self.forgekin_id,
                "error": str(exc),
            }

    # ── 抽象方法：现实闭环（观察 → 行动 → 验证）──────────────────

    @abstractmethod
    async def observe(self, environment: dict[str, Any]) -> dict[str, Any]:
        """观察环境（物理世界传感器 / 虚拟世界状态）。

        Forgekin通过本方法建立与现实世界的"感知"端闭环。不同形态Forgekin
        实现不同的观察策略:

            - BioForgekin:  摄像头 / 麦克风 / 可穿戴设备数据
            - OrgForgekin:  业务系统 API / 数据库 / IM 通道数据
            - ObjForgekin:  IoT 传感器 / 物联网协议数据
            - VirtualForgekin: 虚拟世界状态 / 角色关系图谱
            - HybridForgekin: 多源融合观察

        Args:
            environment: 环境上下文（键值对，由调用方填充）。

        Returns:
            观察结果字典（结构由子类约定）。
        """

    @abstractmethod
    async def act(self, action: dict[str, Any]) -> dict[str, Any]:
        """在环境中执行动作。

        Forgekin通过本方法建立与现实世界的"行动"端闭环。动作必须遵守
        觉醒阶自主范围约束:

            - 觉醒阶 E1（全导阶）: 仅执行 operator 明确指令
            - 觉醒阶 E2（建议阶）: 建议需 operator 确认后执行
            - 觉醒阶 E3（受限自主阶）: 在 tool allow-list / cost ceiling 内自主
            - 觉醒阶 E4+（Evoling）: 可自主优化自身能力

        Args:
            action: 动作描述字典（结构由子类约定）。

        Returns:
            动作执行结果字典（结构由子类约定）。
        """

    @abstractmethod
    async def verify(self, action_result: dict[str, Any]) -> bool:
        """验证动作结果是否达成预期。

        Forgekin通过本方法建立与现实世界的"验证"端闭环。验证失败应触发
        反思（Reflexion）或回退（Fallback），是 Eval 自代谢的信号源。

        Args:
            action_result: :meth:`act` 返回的动作执行结果。

        Returns:
            ``True`` 表示动作达成预期，``False`` 表示未达成。
        """

    # ── 能力判定 ──────────────────────────────────────────────────

    def can_self_evolve(self) -> bool:
        """判断Forgekin是否可自我进化（觉醒阶 ≥ E4 Evolving）。

        E4 是关键转折点——Forgekin进入 Evolving 状态（自我导向），可自主
        优化自身能力（如重构 harness、补锻典），但不可修改 VISION §7。

        详见:
            - [doc:design/naming-contract.md#4] 觉醒阶 E4 定义
            - [doc:review/review.md#13.1] F100 自我进化三模式

        Returns:
            ``True`` 表示可自我进化。
        """
        return self.awakening_stage.can_self_evolve()

    def can_forge_new_forgekin(self) -> bool:
        """判断Forgekin是否可锻造新Forgekin（进化阶 = E6 ForgeMind）。

        E6 是 operator 直接授权的"造 agent"能力，达成 operator "养万物"
        愿景。仅 E6 ForgeMind阶可触发 :class:`~flowforge.forgemind.forging.pipeline.ForgePipeline`
        锻造新Forgekin。

        详见:
            - [doc:design/naming-contract.md#3] 进化阶 E6 定义
            - [doc:VISION.md#1] Forgekin愿景

        Returns:
            ``True`` 表示可锻造新Forgekin。
        """
        return self.evolution_stage.can_forge_new_forgekin()

    # ── 生命周期辅助 ──────────────────────────────────────────────

    @property
    def lifecycle_state(self) -> str:
        """返回当前生命周期状态。"""
        return self._lifecycle_state

    def _set_lifecycle_state(self, state: str) -> None:
        """更新生命周期状态（内部方法，子类用于状态机推进）。"""
        self._lifecycle_state = state

    def describe(self) -> dict[str, Any]:
        """返回Forgekin的描述字典（用于日志 / 谱系追踪 / UI 展示）。

        Returns:
            包含 id / name / species / 进化阶 / 觉醒阶 / SoulImprint哈希 的字典。
        """
        return {
            "forgekin_id": self.forgekin_id,
            "name": self.name,
            "species": self.species.value,
            "species_chinese": self.species.chinese_name,
            "evolution_stage": self.evolution_stage.value,
            "evolution_stage_chinese": self.evolution_stage.chinese_name,
            "awakening_stage": self.awakening_stage.value,
            "awakening_stage_chinese": self.awakening_stage.chinese_name,
            "imprint_hash": self.soul_imprint.imprint_hash,
            "namespace": self.soul_imprint.namespace,
            "lifecycle_state": self._lifecycle_state,
            "can_self_evolve": self.can_self_evolve(),
            "can_forge_new_forgekin": self.can_forge_new_forgekin(),
        }

    def __repr__(self) -> str:
        return (
            f"<{self.__class__.__name__} "
            f"id={self.forgekin_id!r} "
            f"name={self.name!r} "
            f"species={self.species.value!r} "
            f"evo={self.evolution_stage.value} "
            f"awk={self.awakening_stage.value}>"
        )
