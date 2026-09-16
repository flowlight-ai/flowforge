"""ForgeMind 应用层 Plugin — 注册Forgekin到 FlowForge 核心。

:class:`ForgeMindPlugin` 实现 Plugin V3 协议的四个 v7.0 Forge Nurturing体系钩子:

    - :meth:`register_forgekins`           — 注册通用Forgekin模板
    - :meth:`register_forge_skills`        — 注册通用锻造技能
    - :meth:`register_council_channels`    — 注册MindCouncil渠道
    - :meth:`register_auto_forge_config`   — 注册自我进化配置

forgemind 通过本 Plugin 注册到 FlowForge 核心框架层，单向依赖核心层
（编程红线第 10 / 12 条），不直接实例化核心模块，不写死业务领域代码。

详见:
    - [doc:decisions/005-forgemind-application-layer.md] forgemind 应用层 ADR
    - [doc:design/naming-contract.md#2.2] Forgekin定义
    - [doc:review/review.md#第九章] FM-001~FM-012
    - [doc:project_rules.md#红线10] 禁止在 flowforge 中写死业务领域代码
    - [doc:project_rules.md#红线12] 禁止绕过 DI 容器直接实例化
"""

from __future__ import annotations

from typing import Any

from flowforge.core.plugin_protocol import (
    FlowForgePlugin,
    PluginManifest,
)
from flowforge.forgemind.forms import ForgekinFormData
from flowforge.forgemind.forging.pipeline import ForgePipeline
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage


# ── 通用Forgekin模板（forgemind 应用层默认Forge Nurturing清单）──────────────────
# 详见 [doc:decisions/005-forgemind-application-layer.md#4]
# 详见 [doc:VISION.md#2] Forgekin形态分类
_DEFAULT_FORGEKIN_TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "孙悟空",
        "species": ForgekinSpecies.VIRTUAL,
        "requirement": "西游记神话角色，取经愿景，与唐僧/八戒Forgekin长期协作",
        "worldview": "西游记神话体系",
    },
    {
        "name": "家猫橘子",
        "species": ForgekinSpecies.BIO,
        "requirement": "宠物猫，需要健康监测、喂食互动、行为画像",
        "biological_subject": "cat:bengal:orange",
    },
    {
        "name": "客厅吊灯",
        "species": ForgekinSpecies.OBJ,
        "requirement": "智能灯具，节能+用户舒适愿景，与家电Forgekin组队",
        "iot_protocol": "matter",
        "function_boundary": ["switch", "dim", "color_temperature"],
    },
    {
        "name": "某科技公司",
        "species": ForgekinSpecies.ORG,
        "requirement": "组织Forgekin，业务决策+组织健康+合规治理",
        "org_charter": "科技创新、合规经营、员工成长",
    },
]


class ForgeMindPlugin(FlowForgePlugin):
    """ForgeMind 应用层 Plugin — 注册Forgekin到 FlowForge 核心。

    本 Plugin 是 forgemind 应用层与 FlowForge 核心框架层的唯一桥接点。
    通过 Plugin V3 协议四钩子注册Forgekin相关能力，单向依赖核心层
    （编程红线第 10 / 12 条）。

    注册内容:
        - 通用Forgekin模板（孙悟空 / 家猫橘子 / 客厅吊灯 / 某科技公司）
        - 通用锻造技能（observe / act / verify / forge_new_forgekin）
        - MindCouncil渠道（Forgekin议事厅）
        - 自我进化配置（F100 Mode A/B/C，详见 review.md §13.1）

    详见:
        - [doc:decisions/005-forgemind-application-layer.md]
        - [doc:design/naming-contract.md#2.2] Forgekin定义
        - [doc:review/review.md#第九章] FM-001~FM-012
    """

    manifest = PluginManifest(
        name="forgemind",
        version="0.1.0",
        description="Forgekin应用层 — 锻造万事万物ForgeMind（v7.0 Forge Nurturing体系）",
        author="FlowForge Team",
        # V3 ForgeMind / Forgekin fields
        forgekin_species="virtual",  # 默认形态: 虚拟Forgekin
        evolution_stage="E1",        # 默认进化阶: 萌芽阶
        awakening_stage="E1",        # 默认觉醒阶: 全导阶
        # 资源目录（相对于 flowforge 包根）
        forgekins_dir="forgemind/species_impl",
        codex_dir="forgemind/codex",       # Phase 6 锻典
        council_dir="forgemind/council",   # Phase 6 MindCouncil
        auto_forge_dir="forgemind/config", # 自我进化配置
    )

    def __init__(self) -> None:
        super().__init__()
        # Forge Nurturing流水线实例（延迟初始化，避免在 import 时加载 YAML）
        self._pipeline: ForgePipeline | None = None

    @property
    def pipeline(self) -> ForgePipeline:
        """返回Forge Nurturing流水线实例（延迟初始化）。"""
        if self._pipeline is None:
            self._pipeline = ForgePipeline()
        return self._pipeline

    # ── Plugin V3 四钩子实现（v7.0 Forge Nurturing体系）──────────────────────

    def register_forgekins(self, forgekin_registry: Any) -> None:
        """注册通用Forgekin模板（猫 / 公司 / 桌椅 / 孙悟空等）。

        forgemind 应用层养"通用Forgekin"——区别于 *Forge 的"垂直业务Forgekin"。
        本方法将预定义的Forgekin模板注册到Forgekin注册表，供 operator 通过
        :class:`ForgePipeline` 锻造实例。

        详见:
            - [doc:decisions/005-forgemind-application-layer.md#2] 三层架构
            - [doc:design/naming-contract.md#2.2] Forgekin定义
        """
        for template in _DEFAULT_FORGEKIN_TEMPLATES:
            template_id = f"forgemind:template:{template['name']}"
            forgekin_registry.register(
                name=template_id,
                species=template["species"],
                evolution_stage=EvolutionStage.E1,
                awakening_stage=AwakeningStage.E1,
                template=template,
                namespace="forgemind",
            )
            self._track_forgekin(template_id)

    def register_forge_skills(self, skill_registry: Any) -> None:
        """注册通用锻造技能。

        通用锻造技能是所有Forgekin可加载的基础能力包，包括:
            - ``forgemind:observe``  — 观察环境（5 形态通用入口）
            - ``forgemind:act``      — 执行动作（遵守觉醒阶约束）
            - ``forgemind:verify``   — 验证动作结果
            - ``forgemind:forge_new``— 锻造新Forgekin（仅 E6 ForgeMind阶可用）

        详见:
            - [doc:design/naming-contract.md#2.7] SpiritForge定义
            - [doc:design/naming-contract.md#2.8] 锻典定义
            - [doc:review/review.md#13.3] F241 Agent Provider Plugin
        """
        forge_skills = [
            {
                "name": "forgemind:observe",
                "skill_type": "native",
                "description": "观察环境（5 形态通用入口，详见 ForgekinBase.observe）",
                "awakening_min": AwakeningStage.E1.value,
            },
            {
                "name": "forgemind:act",
                "skill_type": "native",
                "description": "执行动作（遵守觉醒阶自主范围约束）",
                "awakening_min": AwakeningStage.E1.value,
            },
            {
                "name": "forgemind:verify",
                "skill_type": "native",
                "description": "验证动作结果（Eval 自代谢信号源）",
                "awakening_min": AwakeningStage.E1.value,
            },
            {
                "name": "forgemind:forge_new",
                "skill_type": "native",
                "description": "锻造新Forgekin（仅 E6 ForgeMind阶可用，达成 operator 养万物愿景）",
                "evolution_min": EvolutionStage.E6.value,
                "awakening_min": AwakeningStage.E4.value,
            },
        ]
        for skill in forge_skills:
            skill_registry.register(
                name=skill["name"],
                forgekin_id="forgemind:*",  # 通用技能，所有 forgemind Forgekin可加载
                skill_type=skill["skill_type"],
                manifest=skill,
            )
            self._track_forge_skill(skill["name"])

    def register_council_channels(self, council_registry: Any) -> None:
        """注册MindCouncil渠道（Forgekin议事）。

        MindCouncil是多Forgekin议事机制，用于解决跨Forgekin冲突、复杂决策、愿景方向
        校准。本方法注册 forgemind 应用层的默认MindCouncil渠道。

        详见:
            - [doc:design/naming-contract.md#2.9] MindCouncil定义
            - [doc:review/review.md#13.1] F100 自我进化三模式（Mode A Scope Guard）
            - [doc:roleagent.md#第7章] 伙伴系统数学
        """
        council_channels = [
            {
                "name": "forgemind:vision_review",
                "channel_type": "vision_alignment",
                "description": "Forgekin愿景对齐MindCouncil——校准 VISION §7 七条锚点",
                "participants": ["forgemind:template:*"],
                "readonly_paths": ["VISION.md#7", "rules.md#红线"],
            },
            {
                "name": "forgemind:cross_species_coordination",
                "channel_type": "cross_species_review",
                "description": "跨ForgekinSpecies协作MindCouncil——BioForgekin 与 OrgForgekin 等",
                "participants": ["forgemind:template:*"],
                "readonly_paths": [],
            },
        ]
        for channel in council_channels:
            council_registry.register_channel(
                name=channel["name"],
                channel_type=channel["channel_type"],
                participants=channel["participants"],
                scope_guard={
                    "readonly_paths": channel["readonly_paths"],
                    "writable_paths": ["forgemind/config/prompts.yaml"],
                },
            )
            self._track_council_channel(channel["name"])

    def register_auto_forge_config(self, auto_forge_engine: Any) -> None:
        """注册自我进化配置（F100 Mode A/B/C）。

        F100 自我进化三模式（详见 [doc:review/review.md#13.1]）:
            - Mode A — Scope Guard（范围守卫）: 防止Forgekin越权修改愿景/规范/架构
            - Mode B — Process Evolution（流程进化）: 改进Forgekin自身工作方式
            - Mode C — Knowledge Evolution（知识进化）: 蒸馏新知识到锻典

        新锻造Forgekin默认仅启用 Mode A（范围守卫），Mode B/C 需觉醒阶 ≥ E4
        后由 operator 显式授权。

        详见:
            - [doc:review/review.md#13.1] F100 自我进化三模式（CL-001~CL-006）
            - [doc:decisions/009-eval-self-metabolism.md]
            - [doc:design/naming-contract.md#2.10] 进化阶定义
            - [doc:design/naming-contract.md#2.11] 觉醒阶定义
        """
        auto_forge_configs = [
            {
                "forgekin_id": "forgemind:template:*",
                "scope_guard": {
                    "readonly_paths": [
                        "VISION.md#7",
                        "rules.md#红线",
                        "decisions/013-all-things-spirit-mind-vision.md",
                    ],
                    "writable_paths": [
                        "forgemind/config/prompts.yaml",
                        "forgemind/species_impl/",
                    ],
                },
                "evolution_modes": ["ModeA_ScopeGuard"],  # 默认仅启用 Mode A
                "eval_ledger_policy": {
                    "replay_ab_required": True,
                    "min_net_gain": 0.05,
                },
                "awakening_min_for_mode_b": AwakeningStage.E4.value,
                "awakening_min_for_mode_c": AwakeningStage.E4.value,
            },
        ]
        for config in auto_forge_configs:
            auto_forge_engine.register_config(
                forgekin_id=config["forgekin_id"],
                scope_guard=config["scope_guard"],
                evolution_modes=config["evolution_modes"],
                eval_ledger_policy=config["eval_ledger_policy"],
            )
            self._track_auto_forge_config(config["forgekin_id"])

    # ── 辅助 API ─────────────────────────────────────────────────

    async def forge_from_template(
        self,
        template_name: str,
        namespace: str = "forgemind",
        operator_id: str | None = None,
    ) -> Any:
        """从预定义模板锻造Forgekin实例（便捷入口）。

        Args:
            template_name: 模板中的Forgekin名（如 ``"孙悟空"``）。
            namespace: 命名空间（默认 ``"forgemind"``）。
            operator_id: 锻造发起者 ID（可选）。

        Returns:
            :class:`~flowforge.forgemind.base.ForgekinBase` 子类实例。

        Raises:
            KeyError: 模板名不存在。
        """
        template = next(
            (t for t in _DEFAULT_FORGEKIN_TEMPLATES if t["name"] == template_name),
            None,
        )
        if template is None:
            available = ", ".join(t["name"] for t in _DEFAULT_FORGEKIN_TEMPLATES)
            raise KeyError(
                f"未找到Forgekin模板: {template_name!r}（可用模板: {available}）"
            )
        # 从模板构造表单（剥离 species / requirement 之外的形态专属字段）
        form = ForgekinFormData(
            name=template["name"],
            species=template["species"],
            namespace=namespace,
            requirement=template.get("requirement", ""),
            seed_params={
                k: v for k, v in template.items()
                if k not in ("name", "species", "requirement")
            },
            operator_id=operator_id,
        )
        return await self.pipeline.forge(form)
