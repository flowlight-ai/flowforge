# FlowForge 架构设计说明书（SAD）

> **版本**：v7.1（**当前唯一权威版本**）
> **日期**：2026-07-19
> **依据**：[spec.md](spec.md) v7.1 SRS + [features/](features/) 40 份 F0XX + [decisions/](decisions/) 13 份 ADR + [roleagent.md](roleagent.md) 七大工程路径 + [review/review.md](review/review.md) v1.4（含第十三章/第十四章深度补审 41 项 CL）
> **配套文档**：[spec.md](spec.md)（SRS 需求规格说明书）+ [design.md](design.md)（SDD 详细设计说明书）+ [features/](features/)（Feature 级 SRS）+ [architecture/](architecture/)（Feature 级 SAD）+ [design/](design/)（Feature 级 SDD）
> **版本合并声明**：v7.1 已吸收合并 v7.0 全部架构决策（设计契约逐章节融入本文档），**v7.0 不再作为独立版本存在**；v7.0/v6.0 历史章节归档在 [`_archive/arch_v7_historical_background.md`](_archive/arch_v7_historical_background.md)，仅作演化路径参考。
> **审核状态**：✅ operator 已审核通过命名方案 + 体系设计；41 条 CL 已同步（详见 §3.17 同步矩阵）。
> **文档定位**：按软件工程 SAD（架构设计说明书）标准格式组织，作为 [architecture/A0XX-xxx.md](architecture/) 子目录的**顶层索引**，详细架构设计在子目录文件中。

---

## §1 引言

### §1.1 编写目的

本文档是 FlowForge 项目 v7.1 的**架构设计说明书（SAD）**，基于 [spec.md](spec.md) v7.1 SRS + [features/](features/) 40 份 F0XX 设计，作为开发、评审、验收的架构层唯一权威依据。

**读者**：operator（CVO，审核架构对愿景锚点的落地）/ 架构师可进化智能体（猫头鹰·鲁班，维护本文档 + 创建 ADR）/ 开发者可进化智能体（猎犬·夏洛克，基于本文档设计详细设计 design.md）/ 评审员可进化智能体（孔雀·梵高，跨厂商 review 架构设计）/ 测试员可进化智能体（蜜獾·平头哥，基于本文档执行架构层 E2E 测试）。

**用途**：① SRS→SAD→SDD 三阶段软件工程标准流程的第二阶段产物；② architecture/A0XX-xxx.md 子目录文件的顶层索引；③ 架构决策与代码实现的桥梁契约。

### §1.2 范围

**包含**：FlowForge 三层架构设计（核心框架层 / forgemind 应用层 / *Forge 垂直业务层）；9 大核心组件架构设计（capability/teamact/harness/memory/eval/reliability/partnership/external_agent/evolution）；forgemind 应用层架构（5 种形态 + 锻造流水线 + 蒸馏知识库 + 多智能体议事）；三方 Agent 集成架构（EAC v1 七契约 + 六层 Guardrails）；自我演进闭环架构；接口设计 / 数据设计 / 部署架构。

**不包含**：单个 Feature 的详细架构设计（在 [architecture/A0XX-xxx.md](architecture/) 中）；单个 ADR 的决策细节（在 [decisions/0XX-xxx.md](decisions/) 中）；详细设计的代码层实现（在 [design.md](design.md) + [design/D0XX-xxx.md](design/) 中）。

### §1.3 术语与缩略语

详见 [design/naming-contract.md](design/naming-contract.md) v1.1 + [spec.md §2.4](spec.md)（12 核心概念命名表）+ [spec.md §2.5](spec.md)（进化阶与觉醒阶）。架构层使用双轨命名策略：代码层/技术文档用 AI 专业术语（Forgekin / ForgeMind / SpiritForge / MindCodex / MindCouncil / CapabilityProfile / Embodied AI / Character AI / ExternalAgentAdapter / ForgekinEngine / HarnessOrchestrator）；社区社交用灵智体体系名（灵智 / 灵智体 / 灵锻 / 灵典 / 灵议 / 育灵 / 灵忆 / 灵印），正式技术文档中专业术语优先、体系名作补充说明。

### §1.4 参考文献

| 文档 | 用途 |
|------|------|
| [spec.md](spec.md) v7.1 | SRS 需求规格说明书（本文档的输入） |
| [features/](features/) 40 份 F0XX | Feature 级 SRS |
| [architecture/](architecture/) 40 份 A0XX | Feature 级 SAD（与 F0XX 同号对应） |
| [decisions/](decisions/) 13 份 ADR | 不可变架构决策记录 |
| [roleagent.md](roleagent.md) | 七大工程路径 |
| [review/review.md](review/review.md) v1.4 | 16 份审核归并 + 41 条 CL 同步矩阵 |
| [hiclaw/rules.md](../../hiclaw/rules.md) v3.2 | 开发规范 + 第十一部分文档分层规范 |
| [hiclaw/prompts.md](../../hiclaw/prompts.md) P52 | SAD 架构设计说明书模板 |

### §1.5 文档组织

按 `hiclaw/rules.md` 第十一部分文档分层规范，本文档章节与 [spec.md](spec.md) §3 同号对应。三顶层文档章节同号：同一核心功能在 spec.md/arch.md/design.md 中章节同号（如 §3.1 CapabilityProfile 在三个文档中都是 §3.1）。

```
flowforge/docs/
├── spec.md（SRS 顶层）
├── arch.md（本文档，SAD 顶层索引）
├── design.md（SDD 顶层，基于 spec + arch + features + architecture）
├── features/           # Feature 级 SRS（F0XX-xxx.md，40 份）
├── architecture/       # Feature 级 SAD（A0XX-xxx.md，与 F0XX 同号一一对应）
├── design/             # Feature 级 SDD（D0XX-xxx.md，与 F0XX/A0XX 同号一一对应）
├── decisions/          # ADR 不可变历史（13 份）
├── review/             # 16 份审核文件
└── _archive/           # 历史归档（v6.0/v7.0 完整备份）
```

---

## §2 架构总览

### §2.1 架构哲学

FlowForge 是一个**智能体自进化框架（Self-Evolving Agent Framework）**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统，并通过 **forgemind 应用层**承载多形态智能体（Forgekin，社区社交称"灵智体"）的智能体入职与终身学习（Forge Nurturing）、经验蒸馏（SpiritForge）、多智能体议事（MindCouncil）闭环，走向通用智能体（General-Purpose Agent）愿景。

**核心公式**（来自 [roleagent.md §1](roleagent.md)）：

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

**架构哲学三原则**：
1. **让架构成为配置**：能用 YAML 配置解决的不写代码（配置驱动率 Phase 2 ≥ 80%）
2. **让扩展成为插件**：*Forge 通过 Plugin V3 四钩子注册可进化智能体到 forgemind
3. **让 Harness 负责约束、验证和进化**：ForgekinEngine 是 HarnessOrchestrator 的装饰器，不绕过护栏

### §2.2 三层架构（v7.1 强化版）

> **来源**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md)
> **关联 SRS**：[spec.md §2.7](spec.md)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                  │
│  <forge_project_id_1> / <forge_project_id_2> / ... / <forge_project_id_N>     │
│  通过 Plugin V3 四钩子注册可进化智能体到 forgemind                │
│  养垂直复杂领域可进化智能体（垂直领域技能包由 *Forge 自行声明）       │
└─────────────────────────────────────────────────────────────┘
                            ↑ Plugin V3
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（多形态可进化智能体锻造场所）           │
│  species_impl/ forging/ sensors/ worlds/ marketplace/       │
│  lineage/ codex/ council/ config/                           │
│  ForgeMindPlugin + ForgekinBase + ForgePipeline             │
│  养公共通用可进化智能体（动物/组织/物品/虚拟角色/混合形态）       │
└─────────────────────────────────────────────────────────────┘
                            ↑ 装饰器
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层（Harness v2.0）               │
│  capability/ teamact/ harness/ memory/ eval/ reliability/   │
│  partnership/ external_agent/ evolution/ plugin/            │
│  ForgekinEngine（装饰 HybridExecutor + HarnessOrchestrator）│
│  提供自进化的基础核心和框架能力                             │
└─────────────────────────────────────────────────────────────┘
```

**关键架构决策**（详见 [decisions/](decisions/)）：
- **决策 1（已采纳）**：v6.0 第 7 层"自进化层"取消独立层级，改为 Harness v2.0 升级（融合到 Layer 1 核心框架层）。理由：避免自进化层 ↔ 应用层循环依赖（D-003）。
- **决策 2（已采纳）**：ForgekinEngine 是 HarnessOrchestrator 的**装饰器**，不是独立入口。理由：避免绕过 Harness 护栏（D-004/D-005/D-020）。
- **铁律**：上层可依赖下层，下层绝对禁止导入上层模块（单向依赖）。
- **forgemind 位置**：forgemind 是 Layer 2 应用层，介于 FlowForge 核心框架与 *Forge 垂直业务之间。

### §2.3 与 v6.0 六层架构的映射

| v6.0 六层 | v7.1 三层 | 说明 |
|----------|----------|------|
| 1. 接口层（API） | Layer 1（FastAPI 入口） | API 仍属于核心框架 |
| 2. 应用层（Gateway） | Layer 1（Brain 编排） | Brain 仍属于核心框架 |
| 3. 指挥中枢层（Brain） | Layer 1（Brain） | 不变 |
| 4. 专家执行层（Workers） | Layer 1（Agents） | 不变 |
| 5. 工具与记忆层 | Layer 1（Tools & Memory） | 不变 |
| 6. 基础设施层 | Layer 1（Infra） | 不变 |
| （新增）| **Layer 2: forgemind** | v6.0 无此层，v7.1 新增（多形态可进化智能体锻造场所） |
| （新增）| **Layer 3: *Forge** | v6.0 隐含在应用层，v7.1 显式独立（垂直业务可进化智能体） |

### §2.4 核心组件总览（9 大模块）

| # | 组件 | 路径 | 关联 SRS | 关联 Feature |
|---|------|------|---------|-------------|
| 1 | CapabilityProfile（能力画像） | `flowforge/core/capability/` | §3.1 | F001 |
| 2 | TeamAct（团队主循环） | `flowforge/core/teamact/` + `flowforge/loop/teamact/` | §3.2 | F002-F007 |
| 3 | Harness（现实闭环七层表面） | `flowforge/core/harness/` + `flowforge/harness/` | §3.3 | F008-F013 |
| 4 | Memory（多域记忆联邦） | `flowforge/core/memory/` | §3.4 | F014-F017, F039 |
| 5 | Eval（自代谢三层） | `flowforge/core/eval/` | §3.5 | F018-F020, F040 |
| 6 | Reliability（分布式可靠性 Tier 1-4） | `flowforge/core/reliability/` | §3.6 | F021-F025 |
| 7 | Partnership（伙伴系统数学） | `flowforge/loop/partner_math/` | §3.7 | （合并入 F007） |
| 8 | ExternalAgent（三方 Agent 集成） | `flowforge/core/external_agent/` | §3.10 | F031-F035 |
| 9 | Evolution（自我演进闭环） | `flowforge/evolution/` | §2.10 | （SelfDev 三 Loop） |

### §2.5 forgemind 应用层模块总览

| # | 模块 | 路径 | 关联 SRS | 关联 Feature |
|---|------|------|---------|-------------|
| 1 | species（形态分类） | `flowforge/forgemind/species_impl/` | §3.8 | F026, F027, F036 |
| 2 | forging（锻造流水线） | `flowforge/forgemind/forging/` | §3.9 | F028 |
| 3 | sensors（物理传感器接入） | `flowforge/forgemind/sensors/` | §3.11 | F029 |
| 4 | worlds（虚拟世界设定层） | `flowforge/forgemind/worlds/` | §3.12 | F030 |
| 5 | marketplace（可进化智能体市场） | `flowforge/forgemind/marketplace/` | §3.13 | F037 |
| 6 | lineage（进化谱系） | `flowforge/forgemind/lineage/` | §3.13 | F038 |
| 7 | codex（蒸馏知识库（MindCodex）） | `flowforge/forgemind/codex/` | §3.4 / §3.14 | F039 |
| 8 | council（多智能体议事（MindCouncil）） | `flowforge/forgemind/council/` | §3.14 | （待添加） |

### §2.6 架构不变性约束（铁律守护）

> **来源**：[review/review.md](review/review.md) v1.4 §7.2 + [hiclaw/rules.md](../../hiclaw/rules.md) 编程红线

1. **单向依赖零容忍**：上层可依赖下层，下层绝对禁止导入上层模块；FlowForge 反向依赖零容忍（flowforge 中禁止 import 任何 *Forge 模块）
2. **循环依赖零容忍**：发现循环依赖必须重构，不允许用延迟导入规避
3. **ForgekinEngine 是装饰器**，不是独立入口（避免绕过 Harness 护栏）
4. **forgemind 单向依赖**核心框架层，禁止反向调用
5. **forgemind 不含业务领域代码**（编程红线第 10 条）
6. **forgemind 通过 Plugin V3 协议注册**，不直接实例化核心模块（编程红线第 12 条）
7. **所有可进化智能体（Forgekin）继承 ForgekinBase**，实现 observe/act/verify 三方法契约
8. **所有 Agent 通过 LoopExecutor 执行**（P31 铁律，质量分阈值 0.85）
9. **数据检索通过 Repository 层抽象**（结构化 + 非结构化统一入口，支持可插拔数据源适配器；具体数据源由 *Forge 业务层或部署配置注入，FlowForge 核心层不绑定特定数据源）
10. **所有数据库操作通过 Repository 层**（禁止直操作数据库）
11. **所有提示词外置 YAML 配置**（禁止硬编码提示词/路径/密钥/端口）
12. **所有依赖通过 DI 容器注入**（禁止绕过 DI 容器直接实例化）

### §2.7 智能体分类架构（静态智能体 vs 可进化智能体）

> **关联 SRS**：[spec.md §2.3](spec.md) 智能体分类
> **权威定义**：[design/naming-contract.md#2](design/naming-contract.md) v2.0 智能体分类
> **默认指代规则**：在 FlowForge 上下文中，"智能体"默认指代**可进化智能体（Evolvable Agent / Forgekin）**；若指代静态智能体必须明确说出"静态智能体"

FlowForge 生态的智能体（Agent）在架构层分为两大类，二者在架构位置、依赖关系、能力扩展机制上存在本质差异：

#### §2.7.1 静态智能体架构（Static Agent Architecture）

| 子类 | 架构位置 | 代码基类 | 关联模块 |
|------|---------|---------|---------|
| **FlowForge 内置静态智能体** | Layer 1 核心框架层 | `StaticAgent` / `DeclarativeAgent` / `ReActAgent` / `PlanExecuteAgent` | `flowforge/agents/generic/` |
| **外部接入静态智能体** | Layer 1 核心框架层（ExternalAgentAdapter 适配层） | `ExternalAgentAdapter` | `flowforge/core/external_agent/` |

**架构特征**：无 Soul Imprint / 无 EchoStore / 无 CapabilityProfile / 无 EvolutionStage / 无 AwakeningStage；行为完全由 prompt + 工具集 + 配置决定；每次执行无状态，跨会话不积累能力；可作为可进化智能体的能力扩展（通过 ExternalAgentAdapter）。

#### §2.7.2 可进化智能体架构（Evolvable Agent / Forgekin Architecture）

| 架构位置 | 代码基类 | 核心组件 |
|---------|---------|---------|
| Layer 2 forgemind 应用层 + Layer 1 核心框架层（ForgekinEngine） | `ForgekinBase` | ForgekinEngine + EchoStore + CapabilityProfile + SpiritForge + MindCodex + MindCouncil |

**架构特征**：有 Soul Imprint（持久身份，跨会话不变）/ 有 EchoStore（情景记忆，跨会话积累）/ 有 CapabilityProfile（能力画像含盲点，跨会话演进）/ 有 EvolutionStage E1-E6（进化阶，能力成熟度）/ 有 AwakeningStage E1-E6（觉醒阶，自主性等级）/ 可通过 SpiritForge 蒸馏经验到 MindCodex / 可参与 MindCouncil 多智能体议事 / 建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证。

#### §2.7.3 两类智能体架构关系图

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 可进化智能体（Evolvable Agent / Forgekin）           │    │
│  │  ForgekinBase + ForgekinEngine + ForgekinSpecies     │    │
│  │  Soul Imprint + EchoStore + CapabilityProfile       │    │
│  │  EvolutionStage E1-E6 + AwakeningStage E1-E6         │    │
│  │  SpiritForge → MindCodex + MindCouncil               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ↑ 装饰器
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层（Harness v2.0）                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 静态智能体（Static Agent）                           │    │
│  │  ┌──────────────────┐  ┌──────────────────────────┐ │    │
│  │  │ 内置静态智能体    │  │ 外部接入静态智能体        │ │    │
│  │  │ DeclarativeAgent │  │ ExternalAgentAdapter     │ │    │
│  │  │ ReActAgent       │  │ (Claude/Codex/OpenCode/  │ │    │
│  │  │ PlanExecuteAgent │  │  Trae 等)                │ │    │
│  │  └──────────────────┘  └──────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

#### §2.7.4 架构层铁律

1. **静态智能体不可升级为可进化智能体**：架构层 forbid 静态智能体"升级"为可进化智能体，二者是不同的架构类别
2. **可进化智能体可调用静态智能体作为能力扩展**：通过 ExternalAgentAdapter，可进化智能体可调用任何静态智能体（内置或外部接入）作为自身能力扩展
3. **静态智能体不持有 ForgekinBase 基类**：静态智能体继承 `StaticAgent` 或 `DeclarativeAgent`，不继承 `ForgekinBase`
4. **可进化智能体必须实现 observe/act/verify 三方法契约**：静态智能体无此契约要求
5. **forgemind 应用层仅承载可进化智能体**：静态智能体在 Layer 1 核心框架层，不进入 forgemind 应用层

---

## §3 核心组件设计索引（FR-CORE-0XX）

> **范围声明**：本章节是**核心关键功能架构设计的顶层索引**，详细架构设计（含组件架构图、模块边界、接口契约、数据流、跨模块协作、架构验收等）在 [architecture/A0XX-xxx.md](architecture/) 子目录文件中（40 份 Feature 级 SAD，与 F0XX 同号一一对应）。
> **章节同号说明**：本章节与 [spec.md §3](spec.md) 章节同号对应。每节仅做索引，详细设计在 [design.md §3](design.md) + [design/D0XX-xxx.md](design/) 中。
> **子目录索引**：完整 Architecture 清单详见 [architecture/README.md](architecture/README.md)。

### §3.1 ~ §3.15 核心架构索引表（FR-CORE-001 ~ FR-CORE-015）

> 以下核心功能的详细架构设计（含架构图、模块边界、接口契约、数据流、跨模块协作、架构不变量、架构验收等）在对应 [architecture/A0XX-xxx.md](architecture/) 文件中，本节仅做索引。

| FR-CORE | 功能 | 优先级 | 关联 ADR | 详细架构（Feature SAD） | 关联 SRS |
|---------|------|:----:|---------|------------------------|----------------|
| FR-CORE-001 | CapabilityProfile 能力画像 × Harness 契合度 | P0 | [004](decisions/004-capability-profile-routing.md) | [A001](architecture/A001-capability-profile.md) | [spec.md §3.1](spec.md) |
| FR-CORE-002 | TeamAct 六步循环 + 五项终止条件 | P0 | [002](decisions/002-collaboration-protocol.md) | [A002](architecture/A002-teamact-loop.md) ~ [A007](architecture/A007-push-back-protocol.md) | [spec.md §3.2](spec.md) |
| FR-CORE-003 | Harness 现实闭环运行时（七层表面） | P0 | [007](decisions/007-harness-engineering.md) | [A008](architecture/A008-durable-state-surfaces.md) ~ [A013](architecture/A013-harnessability.md) | [spec.md §3.3](spec.md) |
| FR-CORE-004 | 多域记忆联邦（六层架构） | P0 | [008](decisions/008-memory-federation.md) | [A014](architecture/A014-memory-collection.md) ~ [A017](architecture/A017-consumption-weighted-ranking.md) + [A039](architecture/A039-mind-codex-searchable.md) | [spec.md §3.4](spec.md) |
| FR-CORE-005 | Eval 自代谢系统（三层 eval） | P0 | [009](decisions/009-eval-self-metabolism.md) | [A018](architecture/A018-eval-contract.md) ~ [A020](architecture/A020-seven-attribution.md) + [A040](architecture/A040-harness-eval-control-plane.md) | [spec.md §3.5](spec.md) |
| FR-CORE-006 | 分布式可靠性（Tier 1-4 恢复分级） | P0 | [010](decisions/010-distributed-reliability.md) | [A021](architecture/A021-side-effect-wal.md) ~ [A025](architecture/A025-provider-host-abstraction.md) | [spec.md §3.6](spec.md) |
| FR-CORE-007 | 伙伴系统数学（上限提高，下限托底） | P0 | [011](decisions/011-partnership-math.md) | 合并入 [A007](architecture/A007-push-back-protocol.md) | [spec.md §3.7](spec.md) |
| FR-CORE-008 | forgemind 应用层 + 5 种形态分类 | P0 | [005](decisions/005-forgemind-application-layer.md) + [013](decisions/013-all-things-spirit-mind-vision.md) | [A026](architecture/A026-forgemind-app-layer.md) + [A027](architecture/A027-all-things-spirit-species.md) | [spec.md §3.8](spec.md) |
| FR-CORE-009 | ForgePipeline 可进化智能体锻造流水线（6 步） | P0 | — | [A028](architecture/A028-forging-pipeline.md) | [spec.md §3.9](spec.md) |
| FR-CORE-010 | 三方 Agent 集成（ExternalAgentAdapter） | P0 | [006](decisions/006-external-agent-integration.md) | [A031](architecture/A031-external-agent-adapter.md) ~ [A035](architecture/A035-external-agent-capability-fusion.md) | [spec.md §3.10](spec.md) |
| FR-CORE-011 | 物理 AI 传感器接入（Embodied AI） | P1 | — | [A029](architecture/A029-physical-ai-sensors.md) | [spec.md §3.11](spec.md) |
| FR-CORE-012 | 虚拟世界设定层 | P1 | — | [A030](architecture/A030-virtual-world-setting.md) | [spec.md §3.12](spec.md) |
| FR-CORE-013 | 可进化智能体市场 + 进化谱系 | P1 | — | [A037](architecture/A037-forgemind-marketplace.md) + [A038](architecture/A038-forgemind-lineage.md) | [spec.md §3.13](spec.md) |
| FR-CORE-014 | 经验蒸馏（SpiritForge） + 多智能体议事（MindCouncil） | P1 | — | [A039](architecture/A039-mind-codex-searchable.md)（+ A042 待创建） | [spec.md §3.14](spec.md) |
| FR-CORE-015 | Plugin V3 四钩子 | P0 | [005](decisions/005-forgemind-application-layer.md) | 合并入 [A026](architecture/A026-forgemind-app-layer.md) | [spec.md §3.15](spec.md) |

### §3.16 FR-CORE-016 ~ FR-CORE-030 其他核心需求架构索引

> 以下核心需求的详细架构设计在对应 Architecture 文件中，本节仅做索引。

| FR-CORE | 功能 | 优先级 | 关联 Architecture |
|---------|------|:----:|------|
| FR-CORE-016 | 交接胶囊 + 持球注册 lease | P0 | [A003](architecture/A003-handoff-capsule.md) + [A006](architecture/A006-ball-custody-lease.md) |
| FR-CORE-017 | 行首 @ 路由 + Push Back 协议 | P0 | [A005](architecture/A005-at-mention-routing.md) + [A007](architecture/A007-push-back-protocol.md) |
| FR-CORE-018 | 乒乓球熔断器 | P0 | [A004](architecture/A004-pingpong-circuit-breaker.md) |
| FR-CORE-019 | Durable State Surfaces（6 类持久表面） | P0 | [A008](architecture/A008-durable-state-surfaces.md) |
| FR-CORE-020 | Evidence & Sensors | P0 | [A009](architecture/A009-evidence-sensors.md) |
| FR-CORE-021 | Governance 压缩免疫 | P0 | [A010](architecture/A010-governance-boundary.md) |
| FR-CORE-022 | Magic Words 逃生舱 + Entropy Control | P0 | [A011](architecture/A011-magic-words.md) + [A012](architecture/A012-entropy-control.md) |
| FR-CORE-023 | Harnessability 评估 | P0 | [A013](architecture/A013-harnessability.md) |
| FR-CORE-024 | 蒸馏知识库（MindCodex） 可检索知识库 | P0 | [A039](architecture/A039-mind-codex-searchable.md) |
| FR-CORE-025 | 副作用日志 WAL + Tier 1-4 恢复 | P0 | [A021](architecture/A021-side-effect-wal.md) + [A022](architecture/A022-tier-1-4-recovery.md) |
| FR-CORE-026 | liveness 规范读模型 | P0 | [A023](architecture/A023-liveness-canonical-read.md) |
| FR-CORE-027 | 弱状态机 vs 强 workflow | P0 | [A024](architecture/A024-weak-state-vs-strong-workflow.md) |
| FR-CORE-028 | 跨 provider 宿主抽象 | P1 | [A025](architecture/A025-provider-host-abstraction.md) |
| FR-CORE-029 | forgemind 与 *Forge 关系 | P1 | [A036](architecture/A036-forgemind-forge-relationship.md) |
| FR-CORE-030 | Harness Eval 控制面 | P1 | [A040](architecture/A040-harness-eval-control-plane.md) |

### §3.17 review.md 41 条 CL 同步矩阵（架构层收尾章）

> **关联 SRS**：[spec.md §3.17](spec.md)
> **详细同步矩阵**：详见 [review/review.md](review/review.md) v1.4 第十三章/第十四章

41 条 CL（CL-001~CL-041）已全部同步到 [features/](features/) + [architecture/](architecture/) + [decisions/](decisions/) + 本文档对应章节。架构层关键变更影响分析（10 项关键 CL 的详细矩阵）已归档至 [_archive/task_process_records.md](_archive/task_process_records.md)，主文档仅保留索引引用。

**关键 CL 摘要**（按章节影响范围）：
- CL-001 可进化智能体定义去 AGI 化 → 影响 §2.1 + §3.8
- CL-005 / CL-006 12 核心概念 + 进化阶/觉醒阶三标注 → 影响 §2.1 术语
- CL-010 forgemind 应用层定位 → 影响 §2.2 + §3.8
- CL-015 三方 Agent EAC 七契约 → 影响 §3.10
- CL-020 自我演进闭环 → 影响 §2.1 + §3.14
- CL-025 弱化万物虚幻用语 → 全局术语
- CL-030 责任方名称（猫头鹰·鲁班等） → 影响 §1.1
- CL-041 文档分层规范 → 影响 §1.5

### §3.18 A0XX Architecture 完整索引

> **40 份 Architecture 文件**（按编号 A001-A040 分类），完整清单与状态详见 [architecture/README.md](architecture/README.md)。编号范围对应类别：A001-A007 TeamAct 协作 / A008-A013 Harness 七层 / A014-A017 多域记忆 / A018-A020 Eval 自代谢 / A021-A025 分布式可靠性 / A026-A030 forgemind 应用层 / A031-A035 三方 Agent 集成 / A036-A040 其他。

---

## §4 接口设计

> **关联 SRS**：[spec.md §4](spec.md) 外部接口

### §4.1 对外 API 接口（FastAPI）

> **详细设计**：[design.md §4.1](design.md) + [design/D043-api-endpoints.md](design/D043-api-endpoints.md)（待创建）

**核心 API 端点架构**（RESTful + SSE 流式）：

| 路径 | 方法 | 用途 |
|------|------|------|
| `/api/v7/forgekins` | POST | 创建可进化智能体 |
| `/api/v7/forgekins/{id}` | GET | 查询可进化智能体 |
| `/api/v7/forgekins/{id}/evolve` | POST | 触发形态进化 |
| `/api/v7/forgekins/{id}/awaken` | POST | 触发觉醒阶晋升 |
| `/api/v7/forgekins/{id}/chat` | POST | 可进化智能体对话（SSE 流式） |
| `/api/v7/forgekins/{id}/observe` | POST | 触发观察 |
| `/api/v7/forgekins/{id}/act` | POST | 触发动作 |
| `/api/v7/forgekins/{id}/verify` | POST | 触发验证 |
| `/api/v7/council/meetings` | POST | 创建多智能体议事会议 |
| `/api/v7/external-agents/invoke` | POST | 调用三方 Agent |

**架构契约**：所有 API 使用 FastAPI + async/await；所有 API 通过 DI 容器注入依赖；所有 API 通过 Repository 层访问数据库；SSE 流式接口用于长任务（如可进化智能体对话 / 锻造流水线）。

### §4.2 SDK 接口（FlowForgeSDK）

> **详细设计**：[design.md §4.2](design.md) + [design/D044-sdk.md](design/D044-sdk.md)（待创建）

FlowForgeSDK 统一入口：零配置模型访问 + `@tool` / `@agent` 装饰器 + 声明式 Agent + 安全护栏 + MCP 服务器连接 + 事件订阅；ForgekinBase 抽象基类：`observe` / `act` / `verify` 三方法契约。

### §4.3 Plugin V3 接口

> **详细规格**：详见 [spec.md §3.15](spec.md) + 本文档 §3.15（合并入 A026）

### §4.4 三方 Agent EAC 接口

> **详细规格**：详见 [spec.md §4.4](spec.md) + 本文档 §3.10（A031-A035）

### §4.5 IM/WebChat 渠道接口

> **详细设计**：[design.md §4.5](design.md) + [design/D030-spirit-forge-mind-council.md](design/D030-spirit-forge-mind-council.md)（待创建）

Web Chat 渠道（默认）/ 飞书渠道 / 微信公众号/个人号渠道 / WebChat 升级版（5 评委并行评审）。

---

## §5 数据设计

> **关联 SRS**：[spec.md §5](spec.md) 非功能需求

### §5.1 数据存储架构

| 存储类型 | 用途 | 实现 |
|---------|------|------|
| SQLite | 任务 / 审计 / 可进化智能体元数据 | SQLAlchemy ORM + Repository 层 |
| 可插拽数据源（如 PostgreSQL / 向量数据库） | 文档索引 / 知识库 / 蒸馏知识库 MindCodex | Repository 层抽象 + 数据源适配器接口（具体数据源由部署配置注入） |
| 文件系统 | 可进化智能体 YAML 配置 / 情景记忆存储（EchoStore） 日志 | YAML + JSON Lines |
| Git | 代码 / 文档 / ADR / Feature 规格 | git CLI |

**架构契约**：所有数据库操作通过 Repository 层（编程红线第 13 条）；数据检索通过 Repository 层抽象（结构化 + 非结构化统一入口，支持可插拔数据源适配器）；情景记忆存储（EchoStore） 使用 JSON Lines 格式；持久身份（SoulImprint） 不可变（持久身份 / 智能体指纹 / 人格哈希）。

### §5.2 核心数据模型

> **详细数据模型设计**：详见 [design.md §5.2](design.md) + 各 [architecture/A0XX-xxx.md](architecture/) 文件中的数据模型章节

核心数据模型包括：ForgekinBase（forgekin_id / soul_imprint / form_data / evolution_stage / awakening_stage / lineage_id / capability_profile_id）、CapabilityProfile（六维画像 + harness_fit_score）、TeamActState（六步循环 + 五项终止条件 + HandoffCapsule 链）、EchoStore / MindCodex / SoulImprint 等持久身份与记忆数据。详细字段定义与 Pydantic 模型在对应 A0XX 文件中。

### §5.3 配置文件架构

| 配置文件 | 路径 | 用途 |
|---------|------|------|
| `system.yaml` | `config/system.yaml` | 系统配置（端口 / 数据库 / LLM provider） |
| `models.yaml` | `flowforge/config/models.yaml` | LLM 模型配置 |
| `llm_route.yaml` | `flowforge/config/llm_route.yaml` | LLM 路由配置 |
| `species.yaml` | `flowforge/forgemind/config/species.yaml` | 可进化智能体形态配置 |
| `forging.yaml` | `flowforge/forgemind/config/forging.yaml` | 锻造流水线配置 |
| `sensors.yaml` | `flowforge/forgemind/config/sensors.yaml` | 传感器配置 |
| `worlds.yaml` | `flowforge/forgemind/config/worlds.yaml` | 虚拟世界设定配置 |
| `prompts.yaml` | `flowforge/forgemind/config/prompts.yaml` | 提示词外置配置 |

**架构契约**：所有提示词外置 YAML 配置（编程红线第 11 条）；所有路径 / 密钥 / 端口通过配置注入；配置驱动率 Phase 2 ≥ 80%。

---

## §6 部署架构

### §6.1 单机部署（开发环境）

```
┌─────────────────────────────────────────────────────┐
│ 开发机（Windows / Linux）                           │
├─────────────────────────────────────────────────────┤
│ FlowForge（FastAPI :8000）                          │
│ *Forge 垂直业务层（可选，通过 Plugin V3 接入）       │
│   └─ 各 *Forge 业务项目独立部署（端口由各自配置）    │
│ 可选外部依赖：                                       │
│   ├─ 多模型 API 网关（如 OpenRoute，端口由配置）     │
│   └─ 数据源适配器（PostgreSQL / 向量数据库等，可插拔）│
└─────────────────────────────────────────────────────┘
```

### §6.2 生产部署（Docker Compose）

> **详细设计**：[design.md §6.2](design.md) + [design/D045-deployment.md](design/D045-deployment.md)（待创建）

### §6.3 可观测性架构

- 日志自动注入 trace_id（详见 [hiclaw/rules.md §2.6 原则 8](../../hiclaw/rules.md)）
- 所有 I/O 使用 async/await
- Eval 信号采集（trace 信号 + 用户信号 + 探针信号）
- 七类归因矩阵可分类失败原因
- LLM 调用日志：input + output + execution time

---

> **本文档版本**：v7.1（2026-07-19）
> **下一阶段**：基于本文档 + [spec.md](spec.md) + [features/](features/) 开发 [design.md](design.md)（SDD 详细设计说明书），按 [hiclaw/rules.md §11.3](../../hiclaw/rules.md) 三阶段开发流程执行。
> **配套文档**：[spec.md](spec.md) + [design.md](design.md) + [features/](features/) + [architecture/](architecture/) + [design/](design/) + [decisions/](decisions/) + [review/](review/)
> **历史归档**：v7.0/v6.0 历史架构章节已归档至 [`_archive/arch_v7_historical_background.md`](_archive/arch_v7_historical_background.md)，仅作演化路径参考。
