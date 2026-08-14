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

import asyncio
from abc import ABC, abstractmethod
from typing import Any

import httpx

<<<<<<< HEAD
from flowforge.core.tracing import get_logger
=======
>>>>>>> feat/multi-thread-council
from flowforge.forgemind.soul_imprint import SoulImprint
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage

logger = get_logger("forgemind.base")


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
        # CLI LLM Provider 缓存（claude_code/codex/gemini/opencode）
        # 根据 llm.provider 字段延迟创建，避免每次 chat 重复初始化
        self._cli_provider_cache: Any | None = None
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
        parts.append(f"Forgekin定义：赋予灵魂和感情的智能体，具有自进化能力的 Agent。")
        parts.append(f"你的形态是 {self.species.chinese_name}（{self.species.value}）。")
        parts.append(f"你的进化阶是 {self.evolution_stage.value}（{self.evolution_stage.chinese_name}），"
                     f"觉醒阶是 {self.awakening_stage.value}（{self.awakening_stage.chinese_name}）。")

        # ── 真实项目上下文（让响应项目相关，避免泛泛而谈）──────────
        from pathlib import Path

        project_root = Path(__file__).resolve().parents[2]
        parts.append("\n## 当前项目上下文（真实信息）")
        parts.append("- 项目名: FlowForge（AI Agent OS / 灵智体锻造平台）")
        parts.append(f"- 项目根: {project_root}")
        parts.append("- 技术栈: Python 3.11+ / FastAPI / LangGraph / Next.js 14")
        parts.append("- 你的 LLM 后端: 智谱 GLM-4-Flash（真实 API 调用，非模拟）")
        parts.append("- 5个灵智体: 文心(wenxin/文档员)、夏洛克(sherlock/开发者)、鲁班(luban/架构师)、梵高(vangogh/审查员)、达芬奇(davinci/测试员)")
        parts.append("- 当用户询问系统/项目信息时，请基于上述真实信息回答")
        parts.append("- 对于一般问候或开放式问题，用你的角色定位自然回应，不要说'无法回答'")

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
        parts.append("- 回答基于真实数据和项目实际情况，但可以用自然语言解释概念")
        parts.append("- 禁止回复'无法回答'——如果不确定，请说明你需要什么信息来回答")

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

        # 根据 llm.provider 选择 LLM 后端
        provider = llm_cfg.get("provider", "trae")

        # zhipu provider：直连智谱 AI API（绕过 OpenRoute WebChat 浏览器自动化）
        # 当 OpenRoute WebChat 卡住时，这是稳定可用的后备路径
        if provider == "zhipu":
            if self._cli_provider_cache is None:
                from flowforge.llm.zhipu_client import build_zhipu_client
                model_name = llm_cfg.get("model", "glm-4-flash")
                self._cli_provider_cache = build_zhipu_client(model_name)
            if self._cli_provider_cache is not None:
                try:
                    result = await self._cli_provider_cache.chat(
                        full_messages,
                        session_id=session_id,
                        timeout=llm_cfg.get("bridge_timeout", 60),
                        **kwargs,
                    )
                    result.setdefault("forgekin_id", self.forgekin_id)
                    result.setdefault("session_id", session_id)
                    return result
                except Exception as exc:  # noqa: BLE001 — P-116: 分类后统一返回错误响应
                    # P-116: 区分可重试（超时/网络）与不可重试（配置）异常
                    return self._chat_error("ZHIPU", exc, session_id, model=provider)

        # openroute provider：通过 HTTP 调用 OpenRoute 网关（推荐，稳定快速）
        if provider == "openroute":
            if self._cli_provider_cache is None:
                from flowforge.llm.openroute_client import build_openroute_client
                model_name = llm_cfg.get("model", "Doubao-Seed2.0")
                self._cli_provider_cache = build_openroute_client(model_name)
            if self._cli_provider_cache is not None:
                try:
                    result = await self._cli_provider_cache.chat(
                        full_messages,
                        session_id=session_id,
                        timeout=llm_cfg.get("bridge_timeout", 90),
                        **kwargs,
                    )
                    result.setdefault("forgekin_id", self.forgekin_id)
                    result.setdefault("session_id", session_id)
                    return result
                except Exception as exc:  # noqa: BLE001 — P-116: 分类后统一返回错误响应
                    # P-116: 区分可重试（超时/网络）与不可重试（配置）异常
                    return self._chat_error("OpenRoute", exc, session_id, model=provider)

        # CLI provider：通过 subprocess 调用三方 Agent CLI（claude_code/codex/gemini/opencode/codebuddy/qodercli/iflow）
        if provider not in ("trae", "openroute", "zhipu"):
            if self._cli_provider_cache is None:
                from flowforge.llm.cli_provider import build_cli_provider
                self._cli_provider_cache = build_cli_provider(provider)
            if self._cli_provider_cache is not None:
                try:
                    kwargs.setdefault("model", llm_cfg.get("model"))
                    result = await self._cli_provider_cache.chat(
                        full_messages,
                        session_id=session_id,
                        timeout=llm_cfg.get("bridge_timeout", 300),
                        **kwargs,
                    )
                    result.setdefault("forgekin_id", self.forgekin_id)
                    result.setdefault("session_id", session_id)
                    return result
                except Exception as exc:  # noqa: BLE001 — P-116: 分类后统一返回错误响应
                    # P-116: 区分可重试（超时/网络）与不可重试（配置）异常
<<<<<<< HEAD
                    logger.exception("Forgekin %s CLI 调用异常", self.name)
=======
>>>>>>> feat/multi-thread-council
                    return self._chat_error("CLI", exc, session_id, model=provider)

        # 降级处理：未注入 LLM 客户端（trae 模式）
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
        except Exception as exc:  # noqa: BLE001 — P-116: 分类后统一返回错误响应
            # P-116: 区分可重试（超时/网络）与不可重试（配置）异常
            return self._chat_error("桥接", exc, session_id, model="error")

    def _chat_error(
        self, provider_label: str, exc: Exception, session_id: str, *, model: str
    ) -> dict[str, Any]:
        """构造统一的 LLM 错误响应，标注可重试性 — P-116.

        可重试异常（asyncio.TimeoutError / httpx.HTTPError 网络类）标注
        ``retryable: True``，上层可据此重试；配置类异常（ValueError/
        KeyError/TypeError）标注 ``error_type: config`` 应快速失败。
        """
        retryable = isinstance(exc, (asyncio.TimeoutError, httpx.HTTPError))
        return {
            "content": f"[{self.name} {provider_label} 异常] {type(exc).__name__}: {exc}",
            "model": model,
            "usage": {"latency_ms": 0, "error": True},
            "session_id": session_id,
            "forgekin_id": self.forgekin_id,
            "error": str(exc),
            "error_type": "retryable" if retryable else "config",
            "retryable": retryable,
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
