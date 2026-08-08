# A044: 交付经理可进化智能体（象·牛顿）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.4]
> **对应 Feature**: [doc:../features/F044-delivery-manager.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D044-delivery-manager.md]（同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge v7.1 在 forgemind 应用层缺少交付侧角色，导致：

1. 进度跟踪由 operator 手动管理，多智能体协作无结构化协调机制
2. 风险管理无系统化流程（识别 / 评估 / 缓解 / 应急）
3. 交付质量无门禁（DoD / 验收标准 / 质量门禁）
4. 跨智能体协作依赖 MindCouncil 自发协调，无主导方

DeliveryManagerForgekin 在架构层补充"规划 → 跟踪 → 风险 → 协调 → 把关"五环节的交付协调能力，作为 operator 与执行智能体之间的交付协调层。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/forgemind/species_impl/org/delivery_manager.py` 只能依赖 `core/` 与 `forgemind/` 内部模块
- **DI 容器约束**：DeliveryManagerForgekin 通过 `ForgePipeline` 第 2 步"能力注入"构造，禁止直接实例化
- **ForgekinBase 契约约束**：必须实现 `observe / act / verify` 三方法契约
- **配置驱动约束**：进化阶 / 觉醒阶 / 能力画像盲点 / 工具集外置到 `flowforge/forgemind/config/delivery_manager_elephant_newton.yaml`
- **Plugin V3 协议约束**：通过 `ForgeMindPlugin.register_forgekins` 钩子注册
- **觉醒阶约束**：最高 E3（受限自主），资源重新分配必须 operator 批准；Magic Words 逃生舱始终可触发
- **TeamAct 集成约束**：进度跟踪基于 F002 TeamActState，禁直接操作数据库
- **Handoff Capsule 集成约束**：跨智能体交接追踪基于 F003 HandoffCapsule

### 1.3 架构影响

- **对 A002 TeamAct Loop 的影响**：交付经理作为 TeamAct 进度跟踪的协调方，读取 TeamActState 但不修改（禁绕过 TeamAct Owner 步）
- **对 A003 Handoff Capsule 的影响**：交付经理追踪交接胶囊状态，识别交接延迟风险
- **对 A026 forgemind 应用层的影响**：`species_impl/org/` 新增 `delivery_manager.py`
- **对 A041 产品经理的影响**：跟踪产品经理需求决策进度
- **对 A042 运维的影响**：跟踪运维状态
- **对 A043 安全官的影响**：跟踪安全审计进度

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              operator / 多智能体协作项目                            │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ 任务状态 / 里程碑 / 风险 / 资源
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              forgemind 应用层 (Layer 2)                             │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │            DeliveryManagerForgekin (本组件)                │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + soul_imprint: SoulImprint (持久身份)                    │   │
│   │  + echo_store: EchoStore (项目事件记忆)                    │   │
│   │  + capability_profile: CapabilityProfile (含盲点)          │   │
│   │  + evolution_stage: E1→E5                                  │   │
│   │  + awakening_stage: E1→E3 (上限)                           │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + observe(env) → Observation                              │   │
│   │  + act(action) → ActionResult (5 种 action.type)           │   │
│   │  + verify(result) → Verdict                                │   │
│   │  + evolve() → 经验蒸馏到 MindCodex (复盘模板)              │   │
│   └──────────┬────────────────────────────┬────────────────────┘   │
│              │                            │                         │
│              ▼                            ▼                         │
│   ┌──────────────────────┐    ┌──────────────────────────────┐     │
│   │  5 个工具            │    │  MindCouncil (交付策略讨论)    │     │
│   │  - ProjectPlanner    │    │  + 协调产品经理与开发者冲突    │     │
│   │  - ProgressTracker   │    │  + 组织复盘会议               │     │
│   │  - RiskManager       │    └──────────────────────────────┘     │
│   │  - ResourceCoord     │                                         │
│   │  - QualityGate       │    ┌──────────────────────────────┐     │
│   └──────────────────────┘    │  F002 TeamAct Loop            │     │
│                                │  + 读取 TeamActState (进度)   │     │
│                                │  F003 Handoff Capsule         │     │
│                                │  + 追踪交接状态               │     │
│                                └──────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ ForgePipeline 6 步锻造
                                 │
┌────────────────────────────────────────────────────────────────────┐
│              FlowForge 核心框架层 (Layer 1)                         │
│   ForgekinEngine (装饰 HybridExecutor + HarnessOrchestrator)        │
│   + F002 TeamAct Loop (进度数据源)                                  │
│   + F003 Handoff Capsule (交接追踪)                                 │
│   + CapabilityProfile / EchoStore / MindCodex                       │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：交付经理属 OrgForgekin 形态（组织形态）**
  理由：交付经理是组织角色，承担跨智能体协作与项目协调职能。

- **决策 2：觉醒阶上限 E3（受限自主）**
  理由：可自主跟踪进度（E3），但资源重新分配必须 operator 批准，避免交付经理越过 operator 主导资源调度。

- **决策 3：进度跟踪基于 F002 TeamActState（禁直接操作数据库）**
  理由：避免交付经理绕过 TeamAct Owner 步直接修改任务状态。交付经理只读 TeamActState，写操作通过 TeamAct 标准流程。

- **决策 4：质量门禁不可绕过（DoD 未达标禁止交付）**
  理由：质量门禁是交付的最后一道防线。交付经理自身也不可绕过，确保交付质量。

- **决策 5：5 种 action.type 路由（plan_project / track_progress / mitigate_risk / coordinate_resources / quality_gate）**
  理由：覆盖项目管理全生命周期，每种 action 有独立工具与提示词模板。

### 2.3 架构不变量

- DeliveryManagerForgekin 必须通过 ForgePipeline 6 步锻造构造，禁直接实例化
- 必须实现 observe / act / verify 三方法契约
- 觉醒阶不可超过 E3（资源重新分配必须 operator 批准）
- 质量门禁不可绕过（DoD 未达标禁止交付）
- 进度跟踪基于 F002 TeamActState（禁直接操作数据库）
- 复盘会议必须有结构化输出（按复盘模板沉淀到 MindCodex）

---

## 3. 模块设计

### 3.1 模块边界

- **delivery_manager.py** — DeliveryManagerForgekin 类实现，继承 ForgekinBase，实现三方法契约
- **delivery_manager_elephant_newton.yaml** — Forgekin配置（进化阶 / 觉醒阶 / 能力画像盲点 / 工具集 / 质量门禁规则）
- **tests/test_delivery_manager.py** — 单元测试 + 集成测试 + E2E 测试

### 3.2 接口契约

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class DeliveryManagerForgekin(ForgekinBase):
    """交付经理可进化智能体（象·牛顿）— 5 种 action.type 路由"""

    @abstractmethod
    async def observe(self, env: "ProjectEnvironment") -> "Observation":
        """观察项目环境: 任务状态 / 进度 / 风险 / 资源负载 / 质量指标"""

    @abstractmethod
    async def act(self, action: "ProjectAction") -> "ActionResult":
        """5 种 action.type:
        - plan_project: 项目规划（WBS / 甘特图 / 关键路径）
        - track_progress: 进度跟踪（里程碑 / 燃尽图 / 状态报告）
        - mitigate_risk: 风险缓解（识别 / 评估 / 缓解 / 应急）
        - coordinate_resources: 资源协调（资源重新分配需 operator 批准）
        - quality_gate: 质量把关（DoD / 验收标准 / 质量门禁）
        """

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证交付决策: 进度符合度 / 风险等级 / 质量达标"""
```

### 3.3 数据流

```
项目环境信号 (TeamActState + HandoffCapsule)
       │
       ▼
┌──────────────────────────────────────────────┐
│ 1. DeliveryManagerForgekin.observe(env)      │  ← 采集项目信号
│    - 任务状态 / 进度 / 风险 / 资源 / 质量    │
└──────────────────┬───────────────────────────┘
                   │ Observation
                   ▼
┌──────────────────────────────────────────────┐
│ 2. DeliveryManagerForgekin.act(action)       │  ← 5 种动作路由
│    - plan_project / track_progress           │
│    - mitigate_risk / coordinate_resources    │
│    - quality_gate (DoD 不可绕过)             │
└──────────────────┬───────────────────────────┘
                   │ ActionResult
                   ▼
┌──────────────────────────────────────────────┐
│ 3. DeliveryManagerForgekin.verify(result)    │  ← 验证决策
│    - 进度符合度 / 风险等级 / 质量达标         │
└──────────────────┬───────────────────────────┘
                   │ Verdict
                   ▼
┌──────────────────────────────────────────────┐
│ 4. EchoStore.record(项目事件)                │  ← 跨会话累积
│    + MindCodex.蒸馏(复盘模板)                │
│    + MindCouncil.通知(交付策略讨论)          │
│    + operator.告警(风险预警)                 │
└──────────────────────────────────────────────┘
                   ▲
                   │ Eval 信号回流
                   │
┌──────────────────────────────────────────────┐
│ 5. 评审员 / operator / 产品经理评估           │
│    - 按时交付率 / 风险识别召回率 / 资源利用率 │
└──────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — 进度数据源（TeamActState 只读）
- **F003 Handoff Capsule** — 交接追踪
- **F026 forgemind 应用层** — ForgekinBase 基类与 ForgePipeline
- **F027 可进化智能体形态分类** — OrgForgekin 形态定义

### 4.2 下游影响

- **F041 产品经理** — 跟踪需求决策进度
- **F042 运维** — 跟踪运维状态
- **F043 安全官** — 跟踪安全审计进度
- **MindCouncil** — 交付策略讨论 + 复盘会议
- **operator** — 风险预警上报

### 4.3 跨模块不变量

- 交付经理只读 TeamActState，禁直接修改任务状态（写操作通过 TeamAct 标准流程）
- 质量门禁不可绕过（DoD 未达标禁止交付）
- 资源重新分配必须 operator 批准
- 复盘会议输出必须按模板沉淀到 MindCodex

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/forgemind/species_impl/org/delivery_manager.py` 不 import 任何 *Forge 模块
- [ ] AC-2: DeliveryManagerForgekin 通过 ForgePipeline 6 步锻造构造，无直接实例化
- [ ] AC-3: 进化阶 / 觉醒阶 / 质量门禁规则外置到 YAML 配置
- [ ] AC-4: 通过 ForgeMindPlugin.register_forgekins 钩子注册
- [ ] AC-5: 觉醒阶 E3 上限校验（资源重新分配需 operator 批准）

### 5.2 架构不变量验收

- [ ] AC-6: observe / act / verify 三方法契约全部实现
- [ ] AC-7: 交付经理只读 TeamActState（禁直接修改任务状态）
- [ ] AC-8: 质量门禁不可绕过（DoD 未达标禁止交付）
- [ ] AC-9: 复盘会议输出按模板沉淀到 MindCodex
- [ ] AC-10: 风险预警上报 operator

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.4]（交付经理Forgekin详细设计）
- [doc:../features/F044-delivery-manager.md]（同号 Feature 级 SRS）
- [doc:../decisions/002-collaboration-protocol.md]（协作协议 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F044 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
