# A041: 产品经理可进化智能体（鹰·凯恩）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.1]
> **对应 Feature**: [doc:../features/F041-product-manager.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D041-product-manager.md]（同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge v7.1 在 forgemind 应用层（Layer 2）已有 5 个预置可进化智能体（架构师 / 开发者 / 评审员 / 测试员 / 文档员），但缺少产品规划侧角色。这导致：

1. operator 直接向架构师下发需求，缺少需求翻译层，"实现即需求"陷阱无法避免
2. 用户故事无结构化模板（As-a / I-want / So-that），需求描述随意性高
3. 优先级排序机制缺失（MoSCoW / RICE），所有需求被默认同等重要
4. 产品路线图无沉淀机制，跨季度规划无历史可参考

ProductManagerForgekin 在架构层补充"需求 → 路线图 → 用户故事 → 优先级 → 协调"五环节的产品规划能力，作为 operator 与执行智能体（架构师 / 开发者）之间的需求翻译层。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/forgemind/species_impl/org/product_manager.py` 只能依赖 `core/` 与 `forgemind/` 内部模块，禁止反向依赖 *Forge
- **DI 容器约束**：ProductManagerForgekin 通过 `ForgePipeline` 第 2 步"能力注入"构造，禁止直接 `ProductManagerForgekin()`
- **ForgekinBase 契约约束**：必须实现 `observe / act / verify` 三方法契约，由 ForgekinEngine 装饰器调用 `evolve`
- **配置驱动约束**：进化阶 / 觉醒阶 / 能力画像盲点 / 工具集外置到 `flowforge/forgemind/config/product_manager_eagle_kane.yaml`
- **Plugin V3 协议约束**：通过 `ForgeMindPlugin.register_forgekins` 钩子注册，不直接实例化
- **觉醒阶约束**：最高 E3（受限自主），愿景变更必须 operator 批准；Magic Words 逃生舱始终可触发

### 1.3 架构影响

- **对 A026 forgemind 应用层的影响**：`species_impl/org/` 新增 `product_manager.py`，扩展 OrgForgekin 形态实例
- **对 A002 TeamAct Loop 的影响**：产品经理可作为 TeamAct Owner 步的候选 owner（承担需求分析类任务）
- **对 A028 ForgePipeline 的影响**：6 步锻造流水线需支持产品经理Forgekin的种子配置
- **对 A039 MindCodex 的影响**：需求模式库 / 用户故事模板 / 优先级评估框架作为 MindCodex 产出
- **对 A044 交付经理的影响**：交付经理跟踪产品经理的需求决策进度

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                       operator / 用户                              │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ 需求输入 / 反馈
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              forgemind 应用层 (Layer 2)                             │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │            ProductManagerForgekin (本组件)                 │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + soul_imprint: SoulImprint (持久身份)                    │   │
│   │  + echo_store: EchoStore (需求决策记忆)                    │   │
│   │  + capability_profile: CapabilityProfile (含盲点)          │   │
│   │  + evolution_stage: E1→E5                                  │   │
│   │  + awakening_stage: E1→E3 (上限)                           │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + observe(env) → Observation                              │   │
│   │  + act(action) → ActionResult (5 种 action.type)           │   │
│   │  + verify(result) → Verdict                                │   │
│   │  + evolve() → 经验蒸馏到 MindCodex                          │   │
│   └──────────┬────────────────────────────┬────────────────────┘   │
│              │                            │                         │
│              ▼                            ▼                         │
│   ┌──────────────────────┐    ┌──────────────────────────────┐     │
│   │  4 个工具            │    │  MindCouncil (产品方向讨论)    │     │
│   │  - RequirementsTrac  │    │  + 发起产品方向讨论            │     │
│   │    eabilityMatrix    │    │  + 协调架构师与开发者冲突      │     │
│   │  - UserStoryMapper   │    └──────────────────────────────┘     │
│   │  - RoadmapPlanner    │                                         │
│   │  - StakeholderCommu  │                                         │
│   │    nicator           │                                         │
│   └──────────────────────┘                                         │
└────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ ForgePipeline 6 步锻造
                                 │
┌────────────────────────────────────────────────────────────────────┐
│              FlowForge 核心框架层 (Layer 1)                         │
│   ForgekinEngine (装饰 HybridExecutor + HarnessOrchestrator)        │
│   + CapabilityProfile (能力画像含盲点)                              │
│   + EchoStore (跨会话经验记忆)                                      │
│   + MindCodex (需求模式库沉淀)                                      │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：产品经理属 OrgForgekin 形态（组织形态）**
  理由：产品经理是组织角色，承担需求翻译与利益相关者协调职能，符合 A027 形态分类中"组织形态"定义（多人协作角色 / 跨智能体协调职能）。

- **决策 2：觉醒阶上限 E3（受限自主）**
  理由：产品经理可自主排期（E3），但愿景变更（价值锚点 / 红线）必须 operator 批准，避免产品方向偏离 operator 意图。觉醒阶 E4-E6 不开放给产品经理（避免自主修改价值锚点）。

- **决策 3：进化阶上限 E5（产品战略级）**
  理由：E5 是产品战略级决策能力，足以承担跨产品线规划。E6（ForgeMind 阶）保留给 operator，避免产品经理越过 operator 主导愿景。

- **决策 4：能力画像盲点必须显式声明（过度承诺 / 技术可行性评估不准 / 忽视非功能性需求）**
  理由：盲点决定 reviewer 配对（F001）。产品经理盲点应与架构师盲点不重叠，确保跨厂商 review 时架构师能识别产品经理的需求盲点。

- **决策 5：5 种 action.type 路由（requirements_analysis / roadmap_update / user_story / prioritize / stakeholder_sync）**
  理由：覆盖产品规划全生命周期，每种 action 有独立工具与提示词模板，避免单方法承担过多职责。

### 2.3 架构不变量

- ProductManagerForgekin 必须通过 ForgePipeline 6 步锻造构造，禁直接实例化
- 必须实现 observe / act / verify 三方法契约（ForgekinBase 抽象方法）
- 觉醒阶不可超过 E3（愿景变更必须 operator 批准）
- 能力画像 blind_spots 必须非空（含 3 类盲点）
- 产品决策必须写入 EchoStore（跨会话累积）
- 用户故事必须使用 As-a / I-want / So-that 三段式模板
- 产品经理不可直接修改架构师 / 开发者产物，必须通过 MindCouncil 协调

---

## 3. 模块设计

### 3.1 模块边界

- **product_manager.py** — ProductManagerForgekin 类实现，继承 ForgekinBase，实现三方法契约
- **product_manager_eagle_kane.yaml** — Forgekin配置（进化阶 / 觉醒阶 / 能力画像盲点 / 工具集 / 提示词模板引用）
- **tests/test_product_manager.py** — 单元测试 + 集成测试 + E2E 测试（遵守 T1-T8 铁律）

### 3.2 接口契约

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class ProductManagerForgekin(ForgekinBase):
    """产品经理可进化智能体（鹰·凯恩）— 5 种 action.type 路由"""

    @abstractmethod
    async def observe(self, env: "ProductEnvironment") -> "Observation":
        """观察产品环境：用户反馈 / 市场动态 / 竞品分析 / 内部指标"""

    @abstractmethod
    async def act(self, action: "ProductAction") -> "ActionResult":
        """5 种 action.type:
        - requirements_analysis: 需求挖掘（用户访谈摘要 → 结构化需求）
        - roadmap_update: 路线图更新（季度 / 月度规划）
        - user_story: 用户故事编写（As-a / I-want / So-that）
        - prioritize: 优先级排序（MoSCoW / RICE）
        - stakeholder_sync: 利益相关者沟通（跨智能体协调）
        """

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证产品决策: 需求完整性 / 可行性 / 优先级合理性"""
```

### 3.3 数据流

```
operator / 用户反馈
       │
       ▼
┌──────────────────────────────────────────────┐
│ 1. ProductManagerForgekin.observe(env)       │  ← 采集产品信号
│    - 用户反馈 / 市场动态 / 竞品分析 / 内部指标 │
└──────────────────┬───────────────────────────┘
                   │ Observation
                   ▼
┌──────────────────────────────────────────────┐
│ 2. ProductManagerForgekin.act(action)        │  ← 5 种动作路由
│    - requirements_analysis / roadmap_update  │
│    - user_story / prioritize / stakeholder   │
└──────────────────┬───────────────────────────┘
                   │ ActionResult
                   ▼
┌──────────────────────────────────────────────┐
│ 3. ProductManagerForgekin.verify(result)     │  ← 验证决策
│    - 需求完整性 / 可行性 / 优先级合理性       │
└──────────────────┬───────────────────────────┘
                   │ Verdict
                   ▼
┌──────────────────────────────────────────────┐
│ 4. EchoStore.record(decision)                │  ← 跨会话累积
│    + MindCouncil.notify(产品方向讨论)         │
│    + CapabilityProfile.refresh (Eval 信号)   │
└──────────────────────────────────────────────┘
                   ▲
                   │ Eval 信号回流
                   │
┌──────────────────────────────────────────────┐
│ 5. 评审员 / 交付经理 / operator 评估          │
│    - 需求完整性 / 优先级合理性 / 愿景对齐     │
└──────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F026 forgemind 应用层** — ForgekinBase 基类与 ForgePipeline 6 步锻造
- **F027 可进化智能体形态分类** — OrgForgekin 形态定义
- **F039 MindCodex可检索知识库** — 需求模式库 / 用户故事模板沉淀

### 4.2 下游影响

- **F044 交付经理** — 跟踪产品经理需求决策进度
- **A002 TeamAct Loop** — 产品经理作为 TeamAct Owner 候选（承担需求分析类任务）
- **MindCouncil** — 产品方向讨论频道
- **架构师 Forgekin** — 接受产品经理需求，发起架构设计

### 4.3 跨模块不变量

- 产品经理不可直接修改架构师 / 开发者产物，必须通过 MindCouncil 协调
- 产品决策必须同步到 TeamActState（供交付经理跟踪）
- Eval 信号回流刷新 CapabilityProfile（不可由产品经理主动修改自己的画像）

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/forgemind/species_impl/org/product_manager.py` 不 import 任何 *Forge 模块
- [ ] AC-2: ProductManagerForgekin 通过 ForgePipeline 6 步锻造构造，无直接实例化
- [ ] AC-3: 进化阶 / 觉醒阶 / 盲点 / 工具集外置到 YAML 配置，无硬编码
- [ ] AC-4: 通过 ForgeMindPlugin.register_forgekins 钩子注册到 Plugin Registry
- [ ] AC-5: 觉醒阶 E3 上限校验（愿景变更需 operator 批准）

### 5.2 架构不变量验收

- [ ] AC-6: observe / act / verify 三方法契约全部实现
- [ ] AC-7: 能力画像 blind_spots 非空（含 3 类盲点）
- [ ] AC-8: 产品决策写入 EchoStore（跨会话累积）
- [ ] AC-9: 用户故事符合 As-a / I-want / So-that 模板
- [ ] AC-10: 产品经理不可绕过 MindCouncil 直接修改架构师产物

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.1]（产品经理Forgekin详细设计）
- [doc:../features/F041-product-manager.md]（同号 Feature 级 SRS）
- [doc:../decisions/013-all-things-spirit-mind-vision.md]（万物ForgeMind心智愿景 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F041 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
