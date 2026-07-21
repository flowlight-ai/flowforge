# A036: forgemind 与 *Forge 关系架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.8] + [doc:../spec.md#§3.15]（FR-CORE-008 / FR-CORE-015 / FR-CORE-029）
> **对应 arch.md**: [doc:../arch.md#§3.8] + [doc:../arch.md#§3.15]
> **对应 design.md**: [doc:../design.md#§3.8]（待创建）
> **对应 Feature**: [doc:../features/F036-forgemind-forge-relationship.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D036-forgemind-forge-relationship.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/005-forgemind-application-layer.md] + [doc:../decisions/003-plugin-v3-protocol.md]

---

## 1. 架构上下文

### 1.1 架构问题

本 Feature 在架构层解决以下问题：FlowForge 三层架构中，forgemind 作为 Layer 2 应用层承载通用Forgekin（Evolvable Agent，社区社交称"灵智体"），*Forge 作为 Layer 3 垂直业务层承载垂直领域Forgekin，二者之间的**边界划分**与**双向流通协作模式**如何工程化落地。

具体子问题：
- **边界划分**：forgemind 与 *Forge 各自承载什么类型的Forgekin? 通用能力与垂直能力的分界线在哪?
- **协作协议**：*Forge 通过什么协议向 forgemind 注册垂直Forgekin? forgemind 通用Forgekin如何"进化"为 *Forge 垂直Forgekin? 垂直Forgekin如何"回炉"沉淀为通用能力?
- **依赖方向**：在单向依赖铁律下，*Forge 依赖 forgemind 还是 forgemind 依赖 *Forge? 跨层迁移如何避免循环依赖?
- **Plugin V3 四钩子边界**：register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config 四个钩子在 forgemind↔*Forge 协作中各承担什么职责?

### 1.2 架构约束

- **单向依赖约束**：上层可依赖下层，下层绝对禁止导入上层模块。*Forge（Layer 3）可依赖 forgemind（Layer 2）与 FlowForge 核心框架（Layer 1），forgemind 绝对禁止 import 任何 *Forge 模块（编程红线第 10 条）
- **DI 容器约束**：*Forge 注册的Forgekin必须通过 DI 容器管理，禁止绕过 DI 容器直接实例化（编程红线第 12 条）
- **Repository 层约束**：跨层迁移记录、能力画像快照必须通过 Repository 层持久化，禁止直接操作数据库（编程红线第 13 条）
- **配置驱动约束**：layers / transition_rules / vertical_skills 等可变规则必须外置 YAML 配置，禁止硬编码（编程红线第 11 条）
- **Plugin V3 协议约束**：*Forge 必须通过 Plugin V3 四钩子注册Forgekin到 forgemind，禁止绕过 Plugin 协议直接实例化（铁律 §0.5）
- **ForgekinEngine 装饰器约束**：Forgekin执行入口必须是 ForgekinEngine 装饰 HybridExecutor + HarnessOrchestrator，禁止绕过 Harness 护栏（arch.md §2.2 决策 2）

### 1.3 架构影响

- **对 FlowForge 核心框架层（Layer 1）的影响**：本 Feature 不修改核心框架代码，仅在 Plugin V3 协议层扩展四钩子契约
- **对 forgemind 应用层（Layer 2）的影响**：新增 `flowforge/forgemind/relationship/` 模块，承载 ForgeRelationshipManager 与跨层迁移引擎
- **对 *Forge 垂直业务层（Layer 3）的影响**：每个 *Forge 项目需在 `plugins.py` 实现 Plugin V3 四钩子，注册垂直Forgekin到 forgemind
- **对 F028 ForgePipeline 锻造流水线的影响**：流水线新增"通用→垂直"分支与"垂直→通用"回炉分支
- **对 F037 Forgekin市场的影响**：市场上架条目新增 `layer` 字段区分通用 / 垂直承载层
- **对 F038 进化谱系的影响**：谱系边新增 `LAYER_TRANSITION` 关系类型记录跨层迁移

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ <forge_proj  │  │ <forge_proj  │  │ <forge_proj  │  │ <forge_proj│ │
│  │  _id_1>      │  │  _id_2>      │  │  _id_3>      │  │ _id_4>     │ │
│  │  plugins.py  │  │  plugins.py  │  │  plugins.py  │  │ plugins.py │ │
│  │      │       │  │      │       │  │      │       │  │     │      │ │
│  │  register_   │  │  register_   │  │  register_   │  │ register_  │ │
│  │  forgekins │  │  forgekins │  │  forgekins │  │ forgekins│ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
└─────────┼─────────────────┼─────────────────┼────────────────┼────────┘
          │                 │                 │                │
          ▼ Plugin V3 四钩子▼                 ▼                ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层                                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ForgeMindPlugin（plugins.py）                                    │  │
│  │  ├─ register_forgekins        接收 *Forge 注册的垂直Forgekin      │  │
│  │  ├─ register_forge_skills      接收 *Forge 注册的垂直技能包      │  │
│  │  ├─ register_council_channels 接收 *Forge 注册的MindCouncil 通道        │  │
│  │  └─ register_auto_forge_config 接收 *Forge 注册的SpiritForge 配置       │  │
│  └────────────────────────┬─────────────────────────────────────────┘  │
│                           │                                            │
│  ┌────────────────────────▼─────────────────────────────────────────┐  │
│  │ flowforge/forgemind/relationship/                                │  │
│  │  ├─ manager.py        ForgeRelationshipManager（关系管理器）      │  │
│  │  ├─ transition.py     LayerTransitionEngine（跨层迁移引擎）       │  │
│  │  ├─ evolve.py         EvolveExecutor（通用→垂直进化执行器）       │  │
│  │  ├─ reclaim.py        ReclaimExecutor（垂直→通用回炉执行器）      │  │
│  │  ├─ repository.py     ForgeRelationshipRepository（持久层）       │  │
│  │  └─ models.py         ForgeLayer / ForgeRelationship /            │  │
│  │                       LayerTransition（数据模型）                 │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 通用Forgekin承载：forgekins/*.yaml（鲁班/夏洛克/梵高/平头哥/文心） │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │ 单向依赖（forgemind → 核心）
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层（Harness v2.0）                           │
│  capability / teamact / harness / memory / eval / reliability /         │
│  partnership / external_agent / evolution / plugin                      │
│  ForgekinEngine（装饰 HybridExecutor + HarnessOrchestrator）            │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：forgemind 定位为 Layer 2 应用层（通用Forgekin承载）**
  - 理由："flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目"。forgemind 承载跨领域复用的通用Forgekin（如架构师猫头鹰·鲁班、开发者猎犬·夏洛克），避免在核心框架层污染业务语义
  - 替代方案：将通用Forgekin放在核心框架层 → 违反编程红线第 10 条"禁止在 flowforge 中写死业务领域代码"
- **决策 2：*Forge 通过 Plugin V3 四钩子向 forgemind 注册（非反向依赖）**
  - 理由：单向依赖铁律要求 *Forge 依赖 forgemind，forgemind 不能 import *Forge。Plugin V3 是反向控制（IoC）模式——*Forge 主动注册，forgemind 被动接收，避免 forgemind 对 *Forge 的硬编码引用
  - 替代方案：forgemind 主动扫描 *Forge 模块 → 违反单向依赖，且需要 forgemind 知道 *Forge 的存在
- **决策 3：跨层迁移（进化 / 回炉）必须 operator 批准**
  - 理由：跨层迁移涉及能力画像复制 / 蒸馏，存在能力丢失或污染风险。operator（CVO）是愿景锚点的最终裁决者，拉闸权不可被Forgekin代理（arch.md §2.6 不变量 4）
  - 替代方案：自动迁移 → 与 VISION.md §7 operator 拉闸权锚点冲突
- **决策 4：回炉仅蒸馏通用能力，垂直能力保留原层**
  - 理由：垂直能力（如 <forge_project_id> 的 vertical_skill）是 *Forge 的领域资产，回炉到通用层会污染 forgemind 的通用性。仅蒸馏可跨领域复用的通用能力（如写作风格、协作习惯）
  - 替代方案：全量回炉 → forgemind 沦为 *Forge 的能力聚合层，违反"通用 vs 垂直"分界
- **决策 5：跨层迁移记录写入 F038 进化谱系**
  - 理由：迁移是Forgekin生命周期的重要事件，必须可追溯。F038 ForgekinLineage 已定义 `LAYER_TRANSITION` 关系类型，本 Feature 复用其谱系存储
  - 替代方案：独立存储迁移记录 → 谱系断裂，无法回答"这个垂直Forgekin的祖先是哪个通用Forgekin"

### 2.3 架构不变量

- forgemind（Layer 2）必须单向依赖 FlowForge 核心框架层（Layer 1），绝对禁止反向调用
- forgemind 必须不含任何 *Forge 垂直业务领域代码（编程红线第 10 条）
- *Forge 必须通过 Plugin V3 四钩子注册Forgekin到 forgemind，禁止绕过 Plugin 协议直接实例化（编程红线第 12 条）
- 通用Forgekin进化为垂直Forgekin必须满足 Eval ≥ 0.85 + 5+ 任务前置条件
- 跨层迁移（进化 / 回炉）必须 operator 显式批准，禁止Forgekin自动迁移
- 回炉必须仅蒸馏通用能力，垂直特定能力必须保留在原 *Forge 层
- 所有 LayerTransition 必须写入 F038 进化谱系，保持血缘可追溯
- 所有跨层迁移记录必须通过 Repository 层持久化，禁止直接操作数据库

---

## 3. 模块设计

### 3.1 模块边界

- **ForgeMindPlugin（`flowforge/forgemind/plugins.py`）**：Plugin V3 四钩子入口，接收 *Forge 注册的垂直Forgekin / 技能 / 议事通道 / SpiritForge 配置
- **ForgeRelationshipManager（`flowforge/forgemind/relationship/manager.py`）**：关系管理器，维护Forgekin与承载层的当前关系、原始层、迁移历史
- **LayerTransitionEngine（`flowforge/forgemind/relationship/transition.py`）**：跨层迁移引擎，执行进化 / 回炉协议，校验前置条件，调用 operator 审批
- **EvolveExecutor（`flowforge/forgemind/relationship/evolve.py`）**：通用→垂直进化执行器，复制能力画像到目标 *Forge 层并新增垂直 SkillPackage
- **ReclaimExecutor（`flowforge/forgemind/relationship/reclaim.py`）**：垂直→通用回炉执行器，调用SpiritForge 蒸馏通用能力到 forgemind 层
- **ForgeRelationshipRepository（`flowforge/forgemind/relationship/repository.py`）**：持久层，存储 ForgeRelationship 与 LayerTransition 记录
- **models（`flowforge/forgemind/relationship/models.py`）**：数据模型（ForgeLayer / ForgeRelationship / LayerTransition）

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ForgeLayer(BaseModel):
    """Forgekin承载层（动态注册，不硬编码具体 *Forge 项目名）

    设计原则：FlowForge 核心层不硬编码具体 *Forge 项目名。
    所有垂直承载层通过 Plugin V3 协议动态注册（详见 ADR 005 + F026）。
    """
    layer_id: str                              # 如 "forgemind" 或由 Plugin V3 注册的 *Forge 项目名
    role: Literal["general", "vertical"]       # 通用承载层 / 垂直承载层
    vertical_skills: list[str] = []            # 垂直领域技能包（仅 vertical 层有）
    can_evolve_to: list[str] = []              # 可进化到的目标层 ID 列表
    can_reclaim_to: str | None = None          # 可回炉到的目标层 ID


class LayerTransition(BaseModel):
    """跨层迁移记录（进化 / 回炉）"""
    transition_id: str
    forgekin_id: str
    from_layer_id: str                          # 源承载层 ID
    to_layer_id: str                            # 目标承载层 ID
    transition_type: str = Field(description="evolve | reclaim")
    trigger_reason: str
    operator_approved: bool = False
    timestamp: datetime
    capability_delta: dict = Field(description="能力画像差异快照")
    lineage_edge_id: Optional[str] = Field(
        default=None,
        description="关联 F038 进化谱系边 ID"
    )


class ForgeRelationship(BaseModel):
    """forgemind 与 *Forge 关系（一个Forgekin的承载层关系）"""
    forgekin_id: str
    current_layer_id: str                        # 当前承载层 ID
    origin_layer_id: str                         # 原始承载层 ID
    evolution_history: list[LayerTransition] = Field(default_factory=list)
    capability_snapshot_per_layer: dict[str, str] = Field(
        description="每层能力画像快照 ID（key 为 layer_id）"
    )


class ForgeRelationshipManager(ABC):
    """forgemind 与 *Forge 关系管理器（抽象接口）"""

    @abstractmethod
    async def get_relationship(self, forgekin_id: str) -> ForgeRelationship:
        """查询Forgekin当前的承载层关系"""
        ...

    @abstractmethod
    async def request_evolve_to_vertical(
        self,
        forgekin_id: str,
        target_layer_id: str,
        reason: str,
    ) -> str:
        """请求通用Forgekin进化为垂直Forgekin（需 operator 批准）

        前置条件:
        - current_layer_id == "forgemind"
        - Eval 分数 >= 0.85
        - 任务数 >= 5
        - target_layer_id 是已通过 Plugin V3 注册的垂直承载层 ID
        """
        ...

    @abstractmethod
    async def request_reclaim_to_forgemind(
        self,
        forgekin_id: str,
        reason: str,
    ) -> str:
        """请求垂直Forgekin回炉为通用Forgekin（能力沉淀到通用层）

        前置条件:
        - current_layer_id != "forgemind"
        - 仅蒸馏通用能力（distill_general_only=True）
        - 垂直能力保留原层（preserve_vertical_in_original=True）
        """
        ...

    @abstractmethod
    async def execute_transition(self, transition_id: str) -> LayerTransition:
        """执行已批准的跨层迁移（写入 F038 谱系 + 更新 Repository）"""
        ...


class ForgeRelationshipRepository(ABC):
    """关系持久层（抽象接口，禁止直接操作数据库）"""

    @abstractmethod
    async def save_relationship(self, rel: ForgeRelationship) -> None: ...

    @abstractmethod
    async def save_transition(self, t: LayerTransition) -> None: ...

    @abstractmethod
    async def list_transitions(
        self, forgekin_id: str
    ) -> list[LayerTransition]: ...
```

### 3.3 数据流

```
进化流（通用 → 垂直）:
  ┌────────────────┐
  │ forgemind 通用 │
  │   Forgekin       │
  │ (Eval>=0.85,  │
  │  任务>=5)      │
  └────────┬───────┘
           │ 1. request_evolve_to_vertical(target_layer_id=<forge_project_id>)
           ▼
  ┌────────────────────────────────────────────┐
  │ ForgeRelationshipManager                   │
  │  ├─ 校验前置条件（Eval / 任务数 / 目标层） │
  │  ├─ 创建 LayerTransition（type=evolve）    │
  │  └─ 请求 operator 审批                     │
  └────────┬───────────────────────────────────┘
           │ 2. operator 批准
           ▼
  ┌────────────────────────────────────────────┐
  │ EvolveExecutor                             │
  │  ├─ 复制 CapabilityProfile 到目标层        │
  │  ├─ 注入 vertical_skills（seo_writing 等） │
  │  ├─ 更新 ForgeRelationship.current_layer   │
  │  ├─ 写入 F038 谱系边（LAYER_TRANSITION）   │
  │  └─ Repository 持久化                      │
  └────────┬───────────────────────────────────┘
           │
           ▼
  ┌────────────────┐
  │ <forge_project_ │
  │ 垂直Forgekin     │
  └────────────────┘

回炉流（垂直 → 通用）:
  ┌────────────────┐
  │ <forge_project_ │
  │ 垂直Forgekin     │
  └────────┬───────┘
           │ 1. request_reclaim_to_forgemind
           ▼
  ┌────────────────────────────────────────────┐
  │ ForgeRelationshipManager                   │
  │  ├─ 校验前置条件                           │
  │  ├─ 创建 LayerTransition（type=reclaim）   │
  │  └─ 请求 operator 批准                     │
  └────────┬───────────────────────────────────┘
           │ 2. operator 批准
           ▼
  ┌────────────────────────────────────────────┐
  │ ReclaimExecutor                            │
  │  ├─ 调用SpiritForge 蒸馏通用能力      │
  │  │   （distill_general_only=True）         │
  │  ├─ 垂直能力保留原层（preserve_vertical）  │
  │  ├─ 通用能力沉淀为 SkillPackage            │
  │  ├─ 更新 ForgeRelationship.current_layer   │
  │  ├─ 写入 F038 谱系边（LAYER_TRANSITION）   │
  │  └─ Repository 持久化                      │
  └────────┬───────────────────────────────────┘
           │
           ▼
  ┌────────────────┐
  │ forgemind 通用 │
  │   Forgekin       │
  │  + 新通用技能  │
  └────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F001 CapabilityProfile**：跨层迁移时复制 / 蒸馏能力画像，依赖 `CapabilityProfileRepository.get_profile` 与 `update_profile` 接口
- **F008 Durable State Surfaces**：ForgeRelationship 与 LayerTransition 持久化复用 F008 的 handoff capsule 持久表面
- **F018 Eval Contract**：进化前置条件校验依赖 F018 的 Eval 信号采集（Eval ≥ 0.85）
- **F028 ForgePipeline**：跨层迁移与锻造流水线联动——进化是流水线的"通用→垂直"分支，回炉是流水线的"垂直→通用"分支
- **Plugin V3 协议（arch.md §3.15）**：ForgeMindPlugin 必须实现四钩子契约接收 *Forge 注册
- **ADR 005 forgemind 应用层**：本 Feature 是 ADR 005 的具体落地
- **ADR 003 Plugin V3 协议**：四钩子契约的权威定义源

### 4.2 下游影响

- **F037 Forgekin市场**：MarketplaceListing 新增 `layer: ForgeLayer` 字段，市场查询支持按承载层过滤（通用 / 垂直）
- **F038 进化谱系**：LineageRelation 新增 `LAYER_TRANSITION` 关系类型，所有跨层迁移写入谱系边
- **F039 MindCodex 可检索知识库**：回炉蒸馏产出的通用 SkillPackage 写入 MindCodex，可被其他Forgekin检索消费
- **F027 多形态智能体形态分类**：跨层迁移不改形态（BioForgekin 迁移后仍是 BioForgekin），但形态进化与层迁移可串联
- **所有 *Forge 项目（动态注册的垂直承载层）**：每个 *Forge 的 `plugins.py` 必须实现 Plugin V3 四钩子，注册垂直Forgekin到 forgemind

### 4.3 跨模块不变量

- 通用Forgekin进化为垂直Forgekin前必须通过 F018 Eval Contract 校验 Eval ≥ 0.85
- 跨层迁移必须同时写入 ForgeRelationshipRepository 与 F038 LineageStore，二者保持一致
- 回炉蒸馏产出的 SkillPackage 必须通过 F039 MindCodex 的 CL-005 七字段契约校验才能入库
- *Forge 注册的垂直Forgekin必须继承 ForgekinBase，实现 observe / act / verify 三方法契约
- 通用能力沉淀必须通过SpiritForge 蒸馏，禁止直接复制原始经验日志
- operator 批准记录必须可审计，写入 F008 Durable State Surfaces 的 handoff capsule

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——forgemind 不 import 任何 *Forge 模块（架构边界扫描通过）
- [ ] AC-2: DI 容器注入通过——ForgeRelationshipManager 通过 DI 容器注入，未绕过直接实例化
- [ ] AC-3: Repository 层通过——ForgeRelationshipRepository 抽象存在且实现层不直接操作数据库
- [ ] AC-4: 配置驱动通过——layers / transition_rules / vertical_skills 外置 YAML，未硬编码
- [ ] AC-5: Plugin V3 四钩子契约通过——ForgeMindPlugin 实现 register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config 四钩子
- [ ] AC-6: ForgeLayer 动态注册通过——forgemind 通用层固定存在，垂直承载层由 *Forge 业务项目通过 Plugin V3 动态注册（核心层不硬编码具体 *Forge 项目名）
- [ ] AC-7: 进化前置条件校验通过——Eval ≥ 0.85 + 5+ 任务 + operator 批准
- [ ] AC-8: 回炉规则通过——仅蒸馏通用能力 + 垂直能力保留原层

### 5.2 架构不变量验收

- [ ] AC-9: forgemind 不含 *Forge 垂直业务领域代码（P8A 架构边界验证通过）
- [ ] AC-10: 通用→垂直进化必须 operator 显式批准（无自动迁移路径）
- [ ] AC-11: 垂直→通用回炉必须 operator 显式批准（无自动回炉路径）
- [ ] AC-12: 所有 LayerTransition 写入 F038 进化谱系（谱系边 LAYER_TRANSITION 类型）
- [ ] AC-13: 跨层迁移记录通过 Repository 层持久化（无直接数据库操作）

---

## 6. 引用

- [doc:../spec.md#§3.8]（FR-CORE-008 forgemind 应用层）
- [doc:../spec.md#§3.15]（FR-CORE-015 Plugin V3 四钩子）
- [doc:../spec.md#§3.16]（FR-CORE-029 forgemind 与 *Forge 关系）
- [doc:../arch.md#§3.8]（forgemind 应用层架构）
- [doc:../arch.md#§3.15]（Plugin V3 四钩子架构）
- [doc:../features/F036-forgemind-forge-relationship.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]（能力画像）
- [doc:../features/F028-forging-pipeline.md]（锻造流水线）
- [doc:../features/F037-forgemind-marketplace.md]（Forgekin市场）
- [doc:../features/F038-forgemind-lineage.md]（进化谱系）
- [doc:../features/F039-mind-codex-searchable.md]（MindCodex 可检索知识库）
- [doc:../decisions/005-forgemind-application-layer.md]（forgemind 应用层 ADR）
- [doc:../decisions/003-plugin-v3-protocol.md]（Plugin V3 协议 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（软件工程文档分层规范）
- [doc:../../../hiclaw/rules.md#第七部分]（编程红线第 10/11/12/13 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架） | 架构师 Forgekin（猫头鹰·鲁班） |
