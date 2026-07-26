"""ForgeMind 应用层（v7.0 Forge Nurturing体系的Forgekin应用层）。

forgemind 是 FlowForge v7.0 的应用层项目，用来实践"万物锻造Forgekin"——
把ForgeMind（ForgeMind）锻造进物理世界和虚拟世界的万事万物。

这是 operator 第 8/9 条指令的核心: flowforge 是自进化框架核心（提供
自进化的基础核心和框架能力），forgemind 是 FlowForge 的应用层项目
（Forge Nurturing所有代码存放的地方——v7.0 命名: "养灵"已废弃为"Forge Nurturing"，
详见 [doc:design/naming-contract.md#2.4]）。

三层架构:
    - **核心框架层** ``flowforge/``（除 forgemind）— 自进化核心 + 基础框架能力
    - **应用层**     ``flowforge/forgemind/``       — Forgekin应用实践
    - **垂直业务层** ``contentforge/`` / ``devforge/`` 等 — 垂直领域Forgekin

包含的核心模块:
    - :class:`~flowforge.forgemind.species.ForgekinSpecies` — ForgekinSpecies五大形态枚举
    - :class:`~flowforge.forgemind.stages.EvolutionStage`   — 进化阶 E1-E6
    - :class:`~flowforge.forgemind.stages.AwakeningStage`   — 觉醒阶 E1-E6
    - :class:`~flowforge.forgemind.soul_imprint.SoulImprint` — SoulImprint（不可变身份）
    - :class:`~flowforge.forgemind.base.ForgekinBase`       — Forgekin抽象基类
    - :class:`~flowforge.forgemind.forms.ForgekinFormData`  — 锻造表单
    - :class:`~flowforge.forgemind.forging.pipeline.ForgePipeline` — Forge Nurturing流水线
    - :class:`~flowforge.forgemind.plugins.ForgeMindPlugin` — Plugin V3 注册入口

5 种形态Forgekin（详见 :mod:`flowforge.forgemind.species_impl`）:
    - :class:`~flowforge.forgemind.species_impl.bio.BioForgekin`
    - :class:`~flowforge.forgemind.species_impl.org.OrgForgekin`
    - :class:`~flowforge.forgemind.species_impl.obj.ObjForgekin`
    - :class:`~flowforge.forgemind.species_impl.virtual.VirtualForgekin`
    - :class:`~flowforge.forgemind.species_impl.hybrid.HybridForgekin`

详见:
    - [doc:design/naming-contract.md] 12 核心概念命名表
    - [doc:decisions/005-forgemind-application-layer.md] forgemind 应用层 ADR
    - [doc:decisions/013-all-things-spirit-mind-vision.md] Forgekin愿景 ADR
    - [doc:VISION.md] Forgekin愿景声明
    - [doc:review/review.md#第九章] forgemind 补审意见 32 项
"""

from flowforge.forgemind.base import ForgekinBase
from flowforge.forgemind.forms import ForgekinFormData
from flowforge.forgemind.forging.pipeline import ForgePipeline
from flowforge.forgemind.forging.stages import ForgingStage, ForgingStageResult
from flowforge.forgemind.plugins import ForgeMindPlugin
from flowforge.forgemind.soul_imprint import SoulImprint
from flowforge.forgemind.species import ForgekinSpecies
from flowforge.forgemind.species_impl import (
    BioForgekin,
    HybridForgekin,
    ObjForgekin,
    OrgForgekin,
    VirtualForgekin,
)
from flowforge.forgemind.stages import AwakeningStage, EvolutionStage

__version__ = "0.1.0"

__all__ = [
    # 顶层元数据
    "__version__",
    # 核心抽象
    "ForgekinBase",
    "ForgekinSpecies",
    "EvolutionStage",
    "AwakeningStage",
    "SoulImprint",
    "ForgekinFormData",
    # Forge Nurturing流水线
    "ForgePipeline",
    "ForgingStage",
    "ForgingStageResult",
    # 5 种形态实现
    "BioForgekin",
    "OrgForgekin",
    "ObjForgekin",
    "VirtualForgekin",
    "HybridForgekin",
    # Plugin V3 注册入口
    "ForgeMindPlugin",
]
