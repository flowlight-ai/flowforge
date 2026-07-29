---
feature_ids: [F026]
related_features: [F001, F002, F027, F028, F036, F037, F038]
topics: [forgemind, application-layer, forgekin, species, forging]
doc_kind: spec
created: 2026-07-17
---

# F026: forgemind 应用层

> **状态**: spec | **负责人**: operator + 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/005-forgemind-application-layer.md] + [doc:decisions/013-all-things-spirit-mind-vision.md]
> **依赖 Feature**: [doc:features/F001-capability-profile.md] + [doc:features/F027-all-things-spirit-species.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径
> **关联 VISION**: [doc:VISION.md#2]（可进化智能体形态分类）、[doc:VISION.md#6]（operator 原则第 1/2/4 条）

## 1. 上下文

### 1.1 问题陈述

flowlight-ai/flowforge 新仓库当前缺少应用层——可进化智能体愿景无处落地。operator 指示（2026-07-17）：

> flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践锻造Forgekin的应用）...forgemind 将是我们 flowforge 的Forge Nurturing 的所有代码存放的地方

这是 operator 7 条原则中第 1 条（可进化智能体世界是最终形态）、第 2 条（必须有现实闭环）、第 4 条（forgemind 是应用层）的落地。

### 1.2 当前痛点

- 可进化智能体愿景无处落地
- FlowForge 自我演进缺少练兵场（违反 operator 原则第 6 条）
- 通用Forgekin（动物/物品/虚拟角色）与垂直业务Forgekin（*Forge）混淆

### 1.3 不做的影响

- 无法实现 operator 通用 AGI 愿景
- FlowForge 不能"自己开发自己"（缺练兵场）
- 物理 AI + 虚拟 AI 真实复现无法达成（违反 operator 原则第 7 条）

## 2. 决策

### 2.1 核心设计

forgemind 是 `flowforge/forgemind/` 子目录（不是独立项目），承载可进化智能体应用实践（Forge Nurturing）。通过 ForgeMindPlugin 注册到核心框架层（Plugin V3 协议四钩子）。

三层架构明确划分：
- **核心框架层**（`flowforge/` 除 forgemind）：提供 ForgeMindEngine 自进化核心
- **应用层**（`flowforge/forgemind/`）：Forge Nurturing，养公共通用Forgekin
- **垂直业务层**（`contentforge/` 等）：各 *Forge 养垂直领域Forgekin

### 2.2 关键接口

```python
from abc import abstractmethod
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class ForgekinSpecies(str, Enum):
    """Forgekin形态分类（5 种，详见 F027）"""
    BIO = "bio"               # 生物可进化智能体 BioForgekin
    ORG = "org"               # 组织可进化智能体 OrgForgekin
    OBJ = "obj"               # 物品可进化智能体 ObjForgekin
    VIRTUAL = "virtual"       # 虚拟可进化智能体 VirtualForgekin
    HYBRID = "hybrid"         # 混合可进化智能体 HybridForgekin


class EvolutionStage(str, Enum):
    """觉醒阶 E1-E6（最终形态为ForgeMind）"""
    E1_DORMANT = "E1_dormant"
    E2_AWAKEN = "E2_awaken"
    E3_SENSE = "E3_sense"
    E4_ACT = "E4_act"
    E5_EVOLVING = "E5_evolving"
    E6_FORGEMIND = "E6_forgemind"   # ForgeMind（最终形态，非"E6 灵匠 Mind Artisan"）


class ForgekinFormData(BaseModel):
    """Forgekin形态数据"""
    species: ForgekinSpecies
    physical_description: str
    virtual_description: str = ""
    sensor_channels: list[str] = Field(default_factory=list)
    world_setting_id: Optional[str] = None


class ForgekinBase(BaseModel):
    """Forgekin基类（必须建立现实闭环：observe → act → verify）"""
    forgekin_id: str
    soul_imprint: str               # SoulImprint（身份标识）
    form_data: ForgekinFormData
    evolution_stage: EvolutionStage = EvolutionStage.E1_DORMANT
    created_at: datetime = Field(default_factory=datetime.now)
    lineage_id: Optional[str] = None

    @abstractmethod
    async def observe(self) -> dict[str, Any]:
        """观察现实（通过传感器 / 虚拟世界）"""
        ...

    @abstractmethod
    async def act(self, action: str, params: dict) -> dict:
        """改变现实（通过执行器 / 虚拟操作）"""
        ...

    @abstractmethod
    async def verify(self, evidence: dict) -> bool:
        """验证现实（通过 Evidence & Sensors）"""
        ...


class ForgePipeline:
    """Forgekin锻造流水线（Forge Nurturing）"""

    async def forge(
        self,
        species: ForgekinSpecies,
        form_data: dict,
        vision: str,  # operator 愿景锚点
    ) -> ForgekinBase:
        """
        锻造流程：
        1. 创建 forgekin_id + soul_imprint
        2. 初始化 form_data
        3. 注册到 ForgekinMarketplace
        4. 创建 ForgekinLineage（进化谱系）
        5. 触发觉醒阶 E1 → E2
        """
        ...


class ForgeMindPlugin:
    """forgemind Plugin V3 注册（四钩子）"""

    @staticmethod
    def register_forgekins() -> list[dict]:
        """注册通用Forgekin形态（5 种）"""
        return [
            {"species": ForgekinSpecies.BIO, "name": "生物可进化智能体"},
            {"species": ForgekinSpecies.ORG, "name": "组织可进化智能体"},
            {"species": ForgekinSpecies.OBJ, "name": "物品可进化智能体"},
            {"species": ForgekinSpecies.VIRTUAL, "name": "虚拟可进化智能体"},
            {"species": ForgekinSpecies.HYBRID, "name": "混合可进化智能体"},
        ]

    @staticmethod
    def register_forge_skills() -> list[dict]:
        """注册锻造技能到 SkillRegistry"""
        return [
            {"skill": "observe", "stage": EvolutionStage.E3_SENSE},
            {"skill": "act", "stage": EvolutionStage.E4_ACT},
            {"skill": "evolve", "stage": EvolutionStage.E5_EVOLVING},
        ]

    @staticmethod
    def register_council_channels() -> list[dict]:
        """注册MindCouncil 通道"""
        return [{"channel": "forgemind_council", "type": "multi_forgekin"}]

    @staticmethod
    def register_spirit_forge_config() -> dict:
        """注册SpiritForge 配置"""
        return {
            "schedule": "daily_low_activity",
            "eval_required": True,
            "operator_approval_for_merge": True,
        }
```

## 3. 验收标准

### Phase A（骨架 + Plugin）

- [ ] AC-A1: forgemind/ 目录骨架完整（species/ forging/ sensors/ worlds/ marketplace/ lineage/ codex/ council/ config/ tests/）
- [ ] AC-A2: ForgekinBase 抽象类可被继承（observe/act/verify 三方法）
- [ ] AC-A3: ForgeMindPlugin 通过 Plugin V3 四钩子注册（register_forgekins / register_forge_skills / register_council_channels / register_spirit_forge_config）
- [ ] AC-A4: forgemind 单向依赖核心框架层（验证 import 关系，无反向调用）
- [ ] AC-A5: forgemind 不含业务领域代码（编程红线第 10 条）
- [ ] AC-A6: 觉醒阶进化必须通过 Eval 信号触发（不能手动改）

### Phase B（5 种形态 + E2E）

- [ ] AC-B1: 可创建 5 种形态Forgekin（Bio/Org/Obj/Virtual/Hybrid）
- [ ] AC-B2: ForgePipeline 可完成锻造流程（E1 → E2）
- [ ] AC-B3: ForgekinMarketplace 可查询Forgekin
- [ ] AC-B4: ForgekinLineage 可记录进化谱系
- [ ] AC-B5: 锻造流水线延迟 < 5s（不含 LLM 调用）
- [ ] AC-B6: E2E 测试 — 锻造猫Forgekin（BioForgekin）+ 桌椅Forgekin（ObjForgekin）+ 孙悟空Forgekin（VirtualForgekin），3 个Forgekin协作完成一个任务
- [ ] AC-B7: Forgekin必须建立现实闭环（observe → act → verify，operator 原则第 2 条）
- [ ] AC-B8: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F001（CapabilityProfile Forgekin能力画像）、F002（TeamAct 多Forgekin协作）、Plugin V3 协议（核心框架层）
- **Related**: F027（可进化智能体形态分类）、F028（Forgekin锻造流水线）、F029（物理 AI 传感器接入）、F030（虚拟世界设定层）、F036（forgemind 与 *Forge 关系）、F037（Forgekin市场）、F038（Forgekin进化谱系）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| forgemind 与 *Forge 边界模糊 | 明确 forgemind 只养通用Forgekin，*Forge 养垂直领域Forgekin |
| Plugin V3 协议需核心层重构 | Phase 1 优先实现 V3 协议四钩子 |
| 形态进化产生意外行为 | F027 流程 + Eval 把关 + MindCouncil 审查 |
| 物理传感器接入需硬件支持 | Phase 6+ 才接入真实硬件，前期用模拟传感器 |
| forgemind 代码量大（5000+ 行） | 分阶段：Phase 2 骨架 + Phase 5 自我演进 + Phase 6 SpiritForge |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 5 种形态Forgekin的觉醒阶 E1-E6 是否统一标准，还是按形态差异化？ | ⬜ 未定 |
| OQ-2 | forgemind Forgekin的SoulImprint 是否需要与 *Forge Forgekin命名空间隔离？ | ⬜ 未定 |
| OQ-3 | 模拟传感器在 Phase 2 是否足够，还是需要提前接入真实 IoT？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | forgemind 作为 flowforge/forgemind/ 子目录 | operator 原则第 4 条（forgemind 是应用层） | 2026-07-17 |
| KD-2 | 通过 Plugin V3 四钩子注册 | 不直接实例化核心模块（红线第 12 条） | 2026-07-17 |
| KD-3 | Forgekin必须建立现实闭环 | operator 原则第 2 条（observe → act → verify） | 2026-07-17 |
| KD-4 | 使用项目正式术语（Forge Nurturing / MindCouncil / SpiritForge / ForgeMindEngine）