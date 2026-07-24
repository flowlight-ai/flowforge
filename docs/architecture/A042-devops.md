# A042: 运维可进化智能体（蜂鸟·闪电）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.2]
> **对应 Feature**: [doc:../features/F042-devops.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D042-devops.md]（同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md] + [doc:../decisions/013-all-things-spirit-mind-vision.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge v7.1 在 forgemind 应用层缺少运维侧角色，导致：

1. 部署 / 监控 / 告警由 operator 手动操作，运维负担集中在 operator
2. 故障自愈能力缺失，依赖人工介入，SLO 难以保证
3. 性能 SLO 无持续监控与瓶颈识别
4. 容量规划基于经验而非数据，资源利用率低

DevOpsForgekin 在架构层补充"部署 → 监控 → 自愈 → 调优 → 容量"五环节的运维保障能力，作为开发交付与生产环境之间的运维保障层。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/forgemind/species_impl/org/devops.py` 只能依赖 `core/` 与 `forgemind/` 内部模块
- **DI 容器约束**：DevOpsForgekin 通过 `ForgePipeline` 第 2 步"能力注入"构造，禁止直接实例化
- **ForgekinBase 契约约束**：必须实现 `observe / act / verify` 三方法契约
- **配置驱动约束**：进化阶 / 觉醒阶 / 能力画像盲点 / 工具集外置到 `flowforge/forgemind/config/devops_hummingbird_flash.yaml`
- **Plugin V3 协议约束**：通过 `ForgeMindPlugin.register_forgekins` 钩子注册
- **觉醒阶约束**：最高 E4（自进化），重大变更必须 operator 批准；Magic Words 逃生舱始终可触发
- **副作用 WAL 约束**：自愈动作必须先写 F021 WAL，失败可回滚
- **Tier 0-4 恢复分级约束**：自愈仅限 Tier 1-2，Tier 0 物理副作用必须 operator 介入

### 1.3 架构影响

- **对 A021 副作用日志 WAL 的影响**：自愈动作前必须先写 WAL，提供回滚依据
- **对 A022 Tier 1-4 恢复分级的影响**：DevOpsForgekin 自愈动作限定 Tier 1-2，Tier 3-4 必须 operator 介入
- **对 A026 forgemind 应用层的影响**：`species_impl/org/` 新增 `devops.py`，扩展 OrgForgekin 形态实例
- **对 A028 ForgePipeline 的影响**：6 步锻造流水线需支持运维Forgekin的种子配置
- **对 A043 安全官的影响**：安全官审计运维部署
- **对 A044 交付经理的影响**：交付经理跟踪运维状态

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              生产环境 / 开发环境                                    │
│   FlowForge 核心 / 可选 LLM 网关 / 可插拔数据源适配器 / 动态注册的 *Forge 业务项目 │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ 服务状态 / 资源 / 告警 / 日志 / 指标
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              forgemind 应用层 (Layer 2)                             │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │            DevOpsForgekin (本组件)                         │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + soul_imprint: SoulImprint (持久身份)                    │   │
│   │  + echo_store: EchoStore (运维事件记忆)                    │   │
│   │  + capability_profile: CapabilityProfile (含盲点)          │   │
│   │  + evolution_stage: E1→E5                                  │   │
│   │  + awakening_stage: E1→E4 (上限)                           │   │
│   │  ────────────────────────────────────────────────────────  │   │
│   │  + observe(env) → Observation                              │   │
│   │  + act(action) → ActionResult (5 种 action.type)           │   │
│   │  + verify(result) → Verdict                                │   │
│   │  + evolve() → 经验蒸馏到 MindCodex (runbook)               │   │
│   └──────────┬────────────────────────────┬────────────────────┘   │
│              │                            │                         │
│              ▼                            ▼                         │
│   ┌──────────────────────┐    ┌──────────────────────────────┐     │
│   │  5 个工具            │    │  MindCouncil (运维策略讨论)    │     │
│   │  - DeploymentOrch    │    │  + 协调安全官与交付经理        │     │
│   │    estrator          │    └──────────────────────────────┘     │
│   │  - MonitoringStack   │                                         │
│   │  - IncidentResponder │    ┌──────────────────────────────┐     │
│   │  - PerformanceProfi  │    │  F021 WAL (自愈动作前写日志)  │     │
│   │  - CapacityPlanner   │    │  + 失败可回滚                │     │
│   └──────────────────────┘    └──────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ ForgePipeline 6 步锻造
                                 │
┌────────────────────────────────────────────────────────────────────┐
│              FlowForge 核心框架层 (Layer 1)                         │
│   ForgekinEngine (装饰 HybridExecutor + HarnessOrchestrator)        │
│   + F021 SideEffectWAL (自愈回滚)                                   │
│   + F022 Tier 1-4 Recovery (恢复分级)                               │
│   + CapabilityProfile / EchoStore / MindCodex                       │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：运维属 OrgForgekin 形态（组织形态）**
  理由：运维是组织角色，承担部署编排与跨服务协调职能。

- **决策 2：觉醒阶上限 E4（自进化）**
  理由：运维可自主优化运维策略（E4），但重大变更（生产部署 / 容量缩容）必须 operator 批准。E4 比 E3 多了"自进化"权限，允许运维Forgekin根据历史数据调整告警阈值与自愈策略。

- **决策 3：自愈动作必须先写 F021 WAL**
  理由：自愈动作有副作用（重启 / 降级 / 切换），失败时需要回滚。WAL 提供"先日志后执行"的可靠模式。

- **决策 4：Tier 0-4 恢复分级约束自愈范围**
  理由：Tier 0（物理副作用，不可逆）禁止自愈；Tier 1-2（可逆 / 可降级）允许自愈；Tier 3-4（跨服务 / 跨数据中心）必须 operator 介入。

- **决策 5：5 种 action.type 路由（deploy / auto_heal / scale / degrade / tune）**
  理由：覆盖运维全生命周期，每种 action 有独立工具与提示词模板。

### 2.3 架构不变量

- DevOpsForgekin 必须通过 ForgePipeline 6 步锻造构造，禁直接实例化
- 必须实现 observe / act / verify 三方法契约
- 觉醒阶不可超过 E4（重大变更必须 operator 批准）
- 自愈动作必须先写 F021 WAL
- Tier 0 物理副作用禁止自愈，必须 operator 介入
- 部署必须支持金丝雀发布（按比例放量）
- 密钥通过环境变量注入（编程红线第 11 条）

---

## 3. 模块设计

### 3.1 模块边界

- **devops.py** — DevOpsForgekin 类实现，继承 ForgekinBase，实现三方法契约
- **devops_hummingbird_flash.yaml** — Forgekin配置（进化阶 / 觉醒阶 / 能力画像盲点 / 工具集 / Tier 限制）
- **tests/test_devops.py** — 单元测试 + 集成测试 + E2E 测试

### 3.2 接口契约

```python
from abc import abstractmethod
from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase


class DevOpsForgekin(ForgekinBase):
    """运维可进化智能体（蜂鸟·闪电）— 5 种 action.type 路由"""

    @abstractmethod
    async def observe(self, env: "OpsEnvironment") -> "Observation":
        """观察运维环境: 服务状态 / 资源使用 / 告警 / 日志 / 指标"""

    @abstractmethod
    async def act(self, action: "OpsAction") -> "ActionResult":
        """5 种 action.type:
        - deploy: 部署编排（蓝绿 / 金丝雀 / 滚动）
        - auto_heal: 故障自愈（仅 Tier 1-2，先写 WAL）
        - scale: 扩容 / 缩容
        - degrade: 服务降级
        - tune: 性能调优
        """

    @abstractmethod
    async def verify(self, result: "ActionResult") -> "Verdict":
        """验证运维结果: 服务可用性 / 性能 SLO / 资源利用率"""
```

### 3.3 数据流

```
生产环境信号
       │
       ▼
┌──────────────────────────────────────────────┐
│ 1. DevOpsForgekin.observe(env)               │  ← 采集运维信号
│    - 服务状态 / 资源 / 告警 / 日志 / 指标     │
└──────────────────┬───────────────────────────┘
                   │ Observation
                   ▼
┌──────────────────────────────────────────────┐
│ 2. DevOpsForgekin.act(action)                │  ← 5 种动作路由
│    - deploy (金丝雀)                          │
│    - auto_heal (Tier 1-2 + WAL)              │
│    - scale / degrade / tune                  │
└──────────────────┬───────────────────────────┘
                   │ ActionResult
                   ▼
┌──────────────────────────────────────────────┐
│ 3. DevOpsForgekin.verify(result)             │  ← 验证 SLO
│    - 可用性 / 性能 / 资源利用率              │
└──────────────────┬───────────────────────────┘
                   │ Verdict
                   ▼
┌──────────────────────────────────────────────┐
│ 4. EchoStore.record(运维事件)                │  ← 跨会话累积
│    + MindCodex.蒸馏(runbook)                 │
│    + F044 交付经理.报告(运维状态)            │
└──────────────────────────────────────────────┘
                   ▲
                   │ Eval 信号回流
                   │
┌──────────────────────────────────────────────┐
│ 5. 安全官 / 交付经理 / operator 评估          │
│    - 自愈成功率 / SLO 达标率 / 容量预测       │
└──────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F021 副作用日志 WAL** — 自愈动作回滚依据
- **F022 Tier 1-4 恢复分级** — 自愈范围限定
- **F026 forgemind 应用层** — ForgekinBase 基类与 ForgePipeline
- **F027 可进化智能体形态分类** — OrgForgekin 形态定义

### 4.2 下游影响

- **F043 安全官** — 审计运维部署
- **F044 交付经理** — 跟踪运维状态
- **A021 SideEffectWAL** — 自愈动作前写日志
- **A022 Tier 1-4 Recovery** — 自愈动作限定 Tier 1-2

### 4.3 跨模块不变量

- 自愈动作必须先写 WAL，否则拒绝执行
- Tier 0 物理副作用禁止自愈
- 部署操作必须接受 F043 安全官审计
- 运维事件必须同步到 TeamActState（供交付经理跟踪）

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/forgemind/species_impl/org/devops.py` 不 import 任何 *Forge 模块
- [ ] AC-2: DevOpsForgekin 通过 ForgePipeline 6 步锻造构造，无直接实例化
- [ ] AC-3: 进化阶 / 觉醒阶 / Tier 限制外置到 YAML 配置
- [ ] AC-4: 通过 ForgeMindPlugin.register_forgekins 钩子注册
- [ ] AC-5: 觉醒阶 E4 上限校验（重大变更需 operator 批准）

### 5.2 架构不变量验收

- [ ] AC-6: observe / act / verify 三方法契约全部实现
- [ ] AC-7: 自愈动作前必须写 F021 WAL
- [ ] AC-8: Tier 0 物理副作用禁止自愈
- [ ] AC-9: 部署支持金丝雀发布
- [ ] AC-10: 密钥通过环境变量注入

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.2]（运维Forgekin详细设计）
- [doc:../features/F042-devops.md]（同号 Feature 级 SRS）
- [doc:../decisions/010-distributed-reliability.md]（分布式可靠性 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F042 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |
