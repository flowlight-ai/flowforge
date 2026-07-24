# A026: forgemind 应用层架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.8]（FR-CORE-008）
> **对应 arch.md**: [doc:../arch.md#§3.8]
> **对应 design.md**: [doc:../design.md#§3.8]（待创建）
> **对应 Feature**: [doc:../features/F026-forgemind-app-layer.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D026-forgemind-app-layer.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 三层架构（应用层 / 指挥中枢层 / 专家执行层）此前缺少 Layer 2 应用层的具体落点，导致 operator 通用智能体（General-Purpose Agent）愿景与"自进化框架"实践场无处承载。本架构在 FlowForge 三层架构中确定 forgemind 子模块的层位置、依赖方向、Plugin 注册方式与跨层调用契约，解决以下架构层问题：

1. **多形态智能体（Multi-Form Agent）实践场缺失**：BIO/ORG/OBJ/VIRTUAL/HYBRID 五种形态Forgekin无统一承载目录，散落在 *Forge 业务项目中。
2. **FlowForge 自我演进练兵场缺失**：FlowForge 无法"自己开发自己"，缺少一个承载Forge Nurturing（Forge Nurturing）全流程代码的应用层。
3. **通用Forgekin与垂直业务Forgekin边界模糊**：未明确 forgemind（养通用Forgekin）与 *Forge（养垂直业务Forgekin）的架构边界，存在反向依赖风险。
4. **Plugin V3 协议落地缺载体**：四钩子（forgekins / forge_skills / council_channels / auto_forge_config）无具体注册示例。

### 1.2 架构约束

- **单向依赖约束**：forgemind 必须单向依赖核心框架层（`flowforge/core/`），核心框架层严禁反向 `import flowforge.forgemind.*`（架构红线第 12 条 + 编程红线第 10 条）。
- **DI 容器约束**：forgemind 内所有 Forgekin 实例必须通过 DI 容器注入依赖，禁止 `ForgekinBase` 直接实例化（编程红线第 12 条）。
- **Repository 层约束**：forgemind 的SoulImprint（SoulImprint）、EchoStore（EchoStore）写入必须通过 Repository 层，禁止 `cursor.execute` 直接操作数据库（架构红线第 4 条）。
- **配置驱动约束**：5 种形态定义、锻造流水线阶段、预置Forgekin描述必须 YAML 外置到 `forgemind/config/*.yaml`，禁止 .py 文件硬编码（架构红线第 5 条 + P16）。
- **业务领域代码零容忍**：forgemind 严禁包含内容创作/小说/电商/开发等垂直业务领域代码（编程红线第 10 条），垂直业务必须放到对应 *Forge 子项目。
- **Plugin V3 协议约束**：forgemind 通过 `ForgeMindPlugin` 实现四钩子注册到 FlowForge Plugin Registry，不直接调用 Plugin Registry 内部 API。

### 1.3 架构影响

- **对核心框架层的影响**：要求核心框架层暴露 Plugin V3 四钩子注册点（`register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config`），并保证 ForgekinEngine 可加载 forgemind 注册的Forgekin。
- **对 *Forge 子项目的影响**：明确 *Forge 不再承载通用Forgekin代码，*Forge 只保留垂直业务 Plugin，复用 forgemind 提供的 ForgekinBase / ForgePipeline / SensorAdapter / WorldSetting 抽象。
- **对 Eval 自代谢系统的影响**：forgemind 触发的觉醒阶晋升必须经 Eval Contract 五问（F018）评估通过，Eval 信号回流到 forgemind 形成自进化闭环。
- **对持久状态层的影响**：forgemind 的SoulImprint、形态进化记录、锻造清单必须写入 F008 Durable State Surfaces，作为 Forgekin 不可变身份锚点。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |            应用层（Layer 2: forgemind）          |
                    |                                                 |
                    |  +------------------+  +------------------+    |
                    |  | ForgeMindPlugin  |  | ForgekinBase     |    |
                    |  | (Plugin V3 四钩)  |->| (observe/act/    |    |
                    |  +------------------+  |  verify 三方法)  |    |
                    |                        +--------+---------+    |
                    |                                 |              |
                    |  +------------------+  +--------v---------+    |
                    |  | ForgePipeline    |  | SpeciesRegistry  |    |
                    |  | (6 步锻造流水线)  |<-| (5 形态注册表)    |    |
                    |  +--------+---------+  +------------------+    |
                    |           |                                     |
                    |  +--------v---------+  +------------------+    |
                    |  | ForgekinEngine   |  | ForgekinMarketplace|   |
                    |  | (Forgekin执行引擎)  |->| (Forgekin市场)       |   |
                    |  +--------+---------+  +------------------+    |
                    |           |                                     |
                    |  +--------v---------+  +------------------+    |
                    |  | ForgekinLineage  |  | MindCouncil      |    |
                    |  | (进化谱系)        |  | (MindCouncil,多 Forgekin)|   |
                    |  +------------------+  +------------------+    |
                    +-------------------------------------------------+
                                          |
                                          | 单向依赖（DI 注入）
                                          v
                    +-------------------------------------------------+
                    |       指挥中枢层 + 专家执行层（Layer 3+）        |
                    |                                                 |
                    |  +------------------+  +------------------+    |
                    |  | HarnessOrchestr- |  | ForgekinEngine   |    |
                    |  | ator (七层表面)   |  | Host Runtime     |    |
                    |  +------------------+  +------------------+    |
                    |  +------------------+  +------------------+    |
                    |  | CapabilityProfile|  | DurableStateSurf |    |
                    |  | Repository (F001)|  | aces (F008)      |    |
                    |  +------------------+  +------------------+    |
                    |  +------------------+  +------------------+    |
                    |  | EchoStore Repo   |  | Eval Contract    |    |
                    |  | (F014)           |  | (F018)           |    |
                    |  +------------------+  +------------------+    |
                    +-------------------------------------------------+
                                          ^
                                          | 反向依赖零容忍（架构红线）
                                          |
                          禁止：core/ import forgemind/
```

### 2.2 关键架构决策

- **决策 1：forgemind 作为 flowforge 子目录而非独立项目**
  operator 指示（2026-07-17）明确 forgemind 是 FlowForge 应用层，承载多形态智能体Forge Nurturing代码。作为子目录可使 FlowForge 自我演进直接复用核心框架层能力，避免通用Forgekin与 *Forge 垂直业务混淆。未选"独立项目"是因为会失去 FlowForge 自我演进滋养；未选"分散到 *Forge"是因为违反"通用 vs 垂直"边界。

- **决策 2：双轨命名策略（产品层 ForgeMind / 代码层 Forgekin）**
  产品层对外宣称"ForgeMind（ForgeMind）"作为体系名用于社区社交沟通，代码层与对外技术文档统一使用 AI 业界术语 Forgekin / ForgeMind / CapabilityProfile 等。这与 naming-contract.md §3"AI 术语优先"一致，避免"万物"虚幻用语，使用"多形态智能体（Multi-Form Agent）"。

- **决策 3：ForgekinBase 三方法契约（observe/act/verify）对应 Harness 七层**
  observe 对应 Evidence & Sensors (L3)；act 对应 Tool Mediation (L2)；verify 对应 Governance Boundary (L4)。三方法契约使任何形态Forgekin必须建立现实闭环，避免"有 persona 无闭环"的虚幻智能体。

- **决策 4：Plugin V3 四钩子注册而非直接实例化**
  forgemind 通过 `ForgeMindPlugin` 四钩子（forgekins / forge_skills / council_channels / auto_forge_config）注册到 FlowForge Plugin Registry，由 ForgekinEngine 在运行时按需加载。这满足 DI 容器约束（编程红线第 12 条）+ 配置驱动约束（架构红线第 5 条）。

- **决策 5：forgemind 不含业务领域代码**
  forgemind 仅承载通用Forgekin抽象 + 5 种形态Forgekin + 锻造流水线 + 传感器/世界设定层抽象。垂直业务Forgekin（如 `<forge_project_id>` 的垂直Forgekin）必须放到 *Forge 子项目并通过 Plugin V3 注册。这避免 FlowForge 反向依赖业务模块（架构红线第 12 条 + 编程红线第 10 条）。

### 2.3 架构不变量

- forgemind 必须单向依赖核心框架层，核心框架层严禁反向 import forgemind 任何模块。
- forgemind 必须通过 Plugin V3 四钩子注册到 FlowForge Plugin Registry，禁止直接调用 Plugin Registry 内部 API。
- forgemind 内所有 Forgekin 实例必须通过 DI 容器注入依赖，禁止直接 `ForgekinBase` 实例化。
- forgemind 的SoulImprint（SoulImprint）必须通过 Repository 层写入 F008 Durable State Surfaces，禁止直接操作数据库。
- forgemind 必须不含任何垂直业务领域代码（内容创作 / 小说 / 电商 / 开发等），违反即编程红线第 10 条。
- forgemind Forgekin必须建立现实闭环（observe -> act -> verify），缺一即架构契约违反。
- forgemind 觉醒阶（Awakening Stage）E1-E6 必须通过 Eval 信号触发晋升，禁止跳级。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 依赖方向 |
|------|------|------|---------|
| ForgeMindPlugin | `forgemind/plugins.py` | Plugin V3 四钩子注册入口 | -> core/plugin |
| ForgekinBase | `forgemind/base.py` | Forgekin抽象基类（observe/act/verify 三方法契约） | -> core/interfaces |
| SpeciesRegistry | `forgemind/species.py` | 5 种形态枚举 + 形态注册表 + 形态进化路径 | -> core/config |
| ForgePipeline | `forgemind/forging/pipeline.py` | 6 步锻造流水线编排 | -> F001/F008/F018 |
| ForgekinEngine | `forgemind/engine.py` | Forgekin执行引擎宿主（与 HarnessOrchestrator 对接） | -> core/harness |
| ForgekinMarketplace | `forgemind/marketplace/` | Forgekin市场（注册/查询/上架） | -> F037 |
| ForgekinLineage | `forgemind/lineage/` | 进化谱系（血缘追踪） | -> F038 |
| SensorAdapter | `forgemind/sensors/` | 物理 AI 传感器适配（F029 落地） | -> F029 |
| WorldSetting | `forgemind/worlds/` | 虚拟世界设定层（F030 落地） | -> F030 |
| MindCodex | `forgemind/codex/` | MindCodex（MindCodex）可检索知识库 | -> F039 |
| MindCouncil | `forgemind/council/` | MindCouncil 多 Forgekin 协作 | -> F002 |
| ForgekinsConfig | `forgemind/forgekins/*.yaml` | 5 个预置Forgekin YAML 配置 | -> core/config |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class ForgekinSpecies(str, Enum):
    """多形态智能体形态分类（5 种，对应 spec.md §2.6）"""
    BIO = "bio"               # BioForgekin 生物Forgekin（对应 Embodied AI 路径）
    ORG = "org"               # OrgForgekin 组织Forgekin
    OBJ = "obj"               # ObjForgekin 物品Forgekin（对应 Embodied AI 路径）
    VIRTUAL = "virtual"       # VirtualForgekin 虚拟Forgekin（对应 Character AI 路径）
    HYBRID = "hybrid"         # HybridForgekin 混合Forgekin


class EvolutionStage(str, Enum):
    """进化阶（Evolution Stage，能力成熟度 6 级，spec.md §2.5.1）
    三标注：中文 / 英文 / AI 业界概念
    """
    E1_DORMANT = "E1_dormant"      # E1 沉睡阶（Dormant / Cold Start）
    E2_AWAKEN = "E2_awaken"        # E2 觉醒阶（Awaken / Bootstrapped）
    E3_SENSE = "E3_sense"          # E3 感知阶（Sense / L1 Reactive）
    E4_ACT = "E4_act"              # E4 行动阶（Act / L2 Tool-Using）
    E5_EVOLVING = "E5_evolving"    # E5 进化阶（Evolving / L3 Self-Improving）
    E6_FORGEMIND = "E6_forgemind"  # E6 ForgeMind 阶（ForgeMind / L4 Self-Evolving Agent）


class SoulImprint(BaseModel):
    """SoulImprint（SoulImprint）—— Forgekin不可变身份锚点"""
    imprint_id: str
    soul_imprint_hash: str         # SoulImprint哈希（不可变）
    species: ForgekinSpecies
    created_at: datetime = Field(default_factory=datetime.now)


class ForgekinFormData(BaseModel):
    """Forgekin形态数据"""
    species: ForgekinSpecies
    physical_description: str
    virtual_description: str = ""
    sensor_channels: list[str] = Field(default_factory=list)
    world_setting_id: Optional[str] = None


class ForgekinBase(ABC, BaseModel):
    """Forgekin抽象基类（三方法契约）"""
    forgekin_id: str
    mind_imprint: SoulImprint
    form_data: ForgekinFormData
    evolution_stage: EvolutionStage = EvolutionStage.E1_DORMANT
    lineage_id: Optional[str] = None

    @abstractmethod
    async def observe(self) -> dict[str, Any]:
        """观察现实（通过传感器 / 虚拟世界 / 数字任务状态）
        对应 Harness L3 Evidence & Sensors
        """
        ...

    @abstractmethod
    async def act(self, action: str, params: dict) -> dict:
        """改变现实（通过执行器 / 虚拟操作 / 工具调用）
        对应 Harness L2 Tool Mediation
        """
        ...

    @abstractmethod
    async def verify(self, evidence: dict) -> bool:
        """验证现实（通过 Evidence & Sensors 反馈）
        对应 Harness L4 Governance Boundary
        """
        ...


class ForgeMindPlugin:
    """forgemind Plugin V3 四钩子注册（与 FlowForge Plugin Registry 对接）"""

    @staticmethod
    def register_forgekins -> list[dict]:
        """钩子 1：注册通用Forgekin形态（5 种）"""
        return [
            {"species": ForgekinSpecies.BIO, "name": "生物Forgekin"},
            {"species": ForgekinSpecies.ORG, "name": "组织Forgekin"},
            {"species": ForgekinSpecies.OBJ, "name": "物品Forgekin"},
            {"species": ForgekinSpecies.VIRTUAL, "name": "虚拟Forgekin"},
            {"species": ForgekinSpecies.HYBRID, "name": "混合Forgekin"},
        ]

    @staticmethod
    def register_forge_skills -> list[dict]:
        """钩子 2：注册锻造技能（与进化阶绑定）"""
        return [
            {"skill": "observe", "stage": EvolutionStage.E3_SENSE},
            {"skill": "act", "stage": EvolutionStage.E4_ACT},
            {"skill": "evolve", "stage": EvolutionStage.E5_EVOLVING},
        ]

    @staticmethod
    def register_council_channels -> list[dict]:
        """钩子 3：注册MindCouncil通道（多 Forgekin 协作）"""
        return [{"channel": "forgemind_council", "type": "multi_forgekin"}]

    @staticmethod
    def register_auto_forge_config -> dict:
        """钩子 4：注册自锻造配置（与 F035 能力融合联动）"""
        return {
            "schedule": "daily_low_activity",
            "eval_required": True,
            "operator_approval_for_merge": True,
        }


class ForgekinEnginePort(ABC):
    """ForgekinEngine 端口（DI 注入抽象，避免 forgemind 反向依赖 core）"""

    @abstractmethod
    async def load_forgekin(self, forgekin_id: str) -> ForgekinBase: ...

    @abstractmethod
    async def execute_observe_act_verify(
        self, forgekin_id: str, action: str, params: dict
    ) -> dict: ...
```

### 3.3 数据流

```
[1] operator 提交Forge Nurturing请求（YAML ForgingManifest）
            |
            v
[2] ForgeMindPlugin.register_forgekins -> 注册 5 形态枚举
            |
            v
[3] ForgePipeline.start(manifest)
    |-- ① 形态定义（species_define）  -> SpeciesRegistry.get(species)
    |-- ② 能力注入（capability_inject）-> CapabilityProfile Repository (F001)
    |-- ③ 记忆初始化（memory_seed）    -> EchoStore Repository (F014)
    |-- ④ 价值观对齐（value_align）    -> ValueCharter (operator 审批)
    |-- ⑤ 能力验证（capability_verify）-> Eval Contract (F018, 阈值 0.85)
    `-- ⑥ 觉醒晋升（awakening_promote）-> EvolutionStage E1 -> E2（operator 审批）
            |
            v
[4] ForgekinBase 实例（mind_imprint + form_data + E2_AWAKEN）
            |
            v
[5] ForgekinEngine.load_forgekin -> 注入 HarnessOrchestrator
            |
            v
[6] 现实闭环执行：observe -> act -> verify（Harness L3/L2/L4）
            |
            v
[7] Eval 信号回流 -> 触发 E2 -> E3 / E3 -> E4 晋升
            |
            v
[8] ForgekinLineage.append(record) -> 写入进化谱系（F038）
            |
            v
[9] ForgekinMarketplace.publish(forgekin) -> 上架到Forgekin市场（F037）
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F001 CapabilityProfile**：forgemind 在锻造流水线第 ② 步注入能力画像，ForgekinBase 持有 `capability_profile_ref`。
- **依赖 F002 TeamAct**：MindCouncil 多 Forgekin 协作复用 TeamAct 六步循环 + Handoff Capsule。
- **依赖 F008 Durable State Surfaces**：SoulImprint、形态进化记录、锻造清单写入持久状态层。
- **依赖 F014 Memory Collection**：Forge Nurturing第 ③ 步记忆初始化 + MindCouncil过程中产生的EchoStore条目。
- **依赖 F018 Eval Contract**：觉醒阶晋升必须通过 Eval 五问 + 质量分阈值 0.85。
- **依赖 core/plugin**：Plugin V3 四钩子注册机制。
- **依赖 core/interfaces**：ForgekinBase / Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 F027 多形态智能体形态分类**：forgemind 提供 SpeciesRegistry 容器，F027 在此注册 5 形态枚举。
- **影响 F028 锻造流水线**：forgemind 提供 ForgePipeline 编排框架，F028 实现 6 步具体阶段处理器。
- **影响 F029 物理 AI 传感器**：forgemind 提供 SensorAdapter 抽象 + sensors/ 目录，F029 落地摄像头/麦克风/IoT 适配器。
- **影响 F030 虚拟世界设定层**：forgemind 提供 WorldSetting 抽象 + worlds/ 目录，F030 落地三层世界引擎。
- **影响 F036 forgemind 与 *Forge 关系**：forgemind 明确"通用Forgekin vs 垂直业务Forgekin"边界，F036 进一步约束 *Forge 通过 Plugin V3 复用 forgemind 抽象。
- **影响 F037 Forgekin市场 + F038 进化谱系**：forgemind 提供市场发布接口与谱系追踪接口。
- **影响 F039 MindCodex 可检索知识库**：forgemind 提供 codex/ 目录承载 MindCodex。

### 4.3 跨模块不变量

- forgemind 必须在 FlowForge 启动时通过 Plugin V3 完成四钩子注册，未注册时 ForgekinEngine 拒绝加载任何 Forgekin。
- forgemind 写入的SoulImprint哈希（soul_imprint_hash）必须全局唯一且不可变，违反即身份漂移。
- forgemind 触发的觉醒阶晋升必须经 F018 Eval Contract 评估，Eval 分数 < 0.85 时禁止晋升。
- forgemind 与 *Forge 之间必须通过 Plugin V3 协议交互，禁止 forgemind 直接 import *Forge 任何模块（编程红线第 10 条）。
- forgemind 注册的预置Forgekin（猫头鹰·鲁班 / 猎犬·夏洛克 / 孔雀·梵高 / 蜜獾·平头哥 / 钢笔·文心）必须 YAML 外置到 `forgemind/forgekins/*.yaml`，禁止 .py 硬编码。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— `grep -r "from forgemind" flowforge/core/` 返回 0 结果。
- [ ] AC-2: DI 容器注入通过 —— ForgekinBase 实例化必须通过 `ForgekinEngine.load_forgekin`，禁止 `ForgekinBase` 直接构造。
- [ ] AC-3: Repository 层通过 —— SoulImprint/EchoStore/进化谱系写入均通过 Repository 抽象，无 `cursor.execute` 调用。
- [ ] AC-4: 配置驱动通过 —— 5 形态定义、6 步锻造清单、5 预置Forgekin均 YAML 外置到 `forgemind/config/*.yaml`。
- [ ] AC-5: Plugin V3 四钩子注册通过 —— FlowForge 启动后 Plugin Registry 中存在 forgemind 注册的 forgekins / forge_skills / council_channels / auto_forge_config 四类条目。
- [ ] AC-6: 业务领域代码零容忍通过 —— forgemind/ 目录无内容创作/小说/电商/开发等垂直业务代码。

### 5.2 架构不变量验收

- [ ] AC-7: 单向依赖不变量通过 —— 核心框架层不 import forgemind 任何模块（架构红线第 12 条）。
- [ ] AC-8: Plugin V3 注册不变量通过 —— forgemind 不直接调用 Plugin Registry 内部 API。
- [ ] AC-9: SoulImprint不可变不变量通过 —— 同一 forgekin_id 的 soul_imprint_hash 在整个生命周期内不变。
- [ ] AC-10: 现实闭环不变量通过 —— 5 种形态Forgekin均实现 observe/act/verify 三方法且可端到端调用。
- [ ] AC-11: 觉醒阶晋升不变量通过 —— E1 -> E2 / E2 -> E3 等所有晋升均经 Eval 信号触发，无跳级。
- [ ] AC-12: 通用 vs 垂直边界不变量通过 —— forgemind 不含 *Forge 业务代码，*Forge 通过 Plugin V3 复用 forgemind 抽象。

---

## 6. 引用

- [doc:../spec.md#§3.8]（FR-CORE-008）
- [doc:../spec.md#§2.6]（5 种形态分类）
- [doc:../spec.md#§2.5]（进化阶/觉醒阶三标注）
- [doc:../arch.md#§3.8]（forgemind 应用层 + 5 种形态分类）
- [doc:../arch.md#§2.5]（forgemind 应用层模块总览）
- [doc:../features/F026-forgemind-app-layer.md]（同号 Feature 级 SRS）
- [doc:../features/F027-all-things-spirit-species.md]
- [doc:../features/F036-forgemind-forge-relationship.md]
- [doc:../decisions/005-forgemind-application-layer.md]
- [doc:../decisions/013-all-things-spirit-mind-vision.md]
- [doc:../../CONTRIBUTING.md]
- [doc:../design/naming-contract.md]（双轨命名 + 三标注规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 组件图 + 接口契约 + 跨模块不变量） | 架构师 Forgekin（猫头鹰·鲁班） |
