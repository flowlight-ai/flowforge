# FlowForge 架构设计说明书（SAD）

> **版本**：v7.1（**当前唯一权威版本**）
> **日期**：2026-07-19
> **依据**：[spec.md](spec.md) v7.1 SRS + [features/](features/) 40 份 F0XX + [decisions/](decisions/) 13 份 ADR + [roleagent.md](roleagent.md) 七大工程路径 + [review/review.md](review/review.md) v1.4（含第十三章/第十四章 clowder-ai 深度补审 41 项 CL）
> **配套文档**：[spec.md](spec.md)（SRS 需求规格说明书）+ [design.md](design.md)（SDD 详细设计说明书）+ [features/](features/)（Feature 级 SRS）+ [architecture/](architecture/)（Feature 级 SAD）+ [design/](design/)（Feature 级 SDD）
> **版本合并声明**：v7.1 已吸收合并 v7.0 全部架构决策（设计契约逐章节融入本文档），**v7.0 不再作为独立版本存在**；v7.0 完整架构内容备份在 [`_archive/arch_v71_full_backup_20260719.md`](_archive/arch_v71_full_backup_20260719.md)，仅作演化路径参考。v6.0 历史架构章节作为已实现代码的背景资料。
> **审核状态**：✅ operator 已审核通过命名方案 + 体系设计；41 条 CL 已同步（详见 §3.17 同步矩阵）。
> **文档定位**：按软件工程 SAD（架构设计说明书）标准格式组织，仅放**核心关键功能**架构设计；非核心功能的架构设计在 [architecture/A0XX-xxx.md](architecture/) 中，与本文档 §3 章节同号互链。

---

## §1 引言

### §1.1 编写目的

本文档是 FlowForge 项目 v7.1 的**架构设计说明书（SAD）**，基于 [spec.md](spec.md) v7.1 SRS + [features/](features/) 40 份 F0XX 设计，作为开发、评审、验收的架构层唯一权威依据。

**读者**：
- **operator（首席愿景官 CVO）**：审核架构对愿景锚点的落地
- **架构师灵智体（猫头鹰·鲁班）**：维护本文档 + 创建 ADR
- **开发者灵智体（猎犬·夏洛克）**：基于本文档设计详细设计（design.md）
- **评审员灵智体（孔雀·梵高）**：跨厂商 review 架构设计
- **测试员灵智体（蜜獾·平头哥）**：基于本文档执行架构层 E2E 测试

**用途**：
1. 作为 SRS→SAD→SDD 三阶段软件工程标准流程的**第二阶段产物**
2. 作为 architecture/A0XX-xxx.md 子目录文件的**顶层索引**
3. 作为架构决策与代码实现的**桥梁契约**

### §1.2 范围

**包含**：
- FlowForge 三层架构设计（核心框架层 / forgemind 应用层 / *Forge 垂直业务层）
- 9 大核心组件架构设计（capability/teamact/harness/memory/eval/reliability/partnership/external_agent/evolution）
- forgemind 应用层架构（5 种形态 + 锻造流水线 + 灵典 + 灵议）
- 三方 Agent 集成架构（EAC v1 七契约 + 六层 Guardrails）
- 自我演进闭环架构（SelfDevDocLoop/SelfDevCodeLoop/SelfDevFrameworkLoop）
- 接口设计 / 数据设计 / 部署架构

**不包含**：
- 单个 Feature 的详细架构设计（在 architecture/A0XX-xxx.md 中）
- 单个 ADR 的决策细节（在 decisions/0XX-xxx.md 中，ADR 不可变历史）
- 详细设计的代码层实现（在 design.md + design/D0XX-xxx.md 中）

### §1.3 术语与缩略语

详见 [design/naming-contract.md](design/naming-contract.md) v1.1 + [spec.md §2.4](spec.md)（12 核心概念命名表）+ [spec.md §2.5](spec.md)（进化阶与觉醒阶）。

**架构层关键术语**（双轨命名策略）：
- **代码层 / 技术文档**：使用 AI 专业术语（Forgekin / ForgeMind / SpiritForge / Mind Codex / Mind Council / CapabilityProfile / Embodied AI / Character AI / ExternalAgentAdapter / ForgekinEngine / HarnessOrchestrator）
- **社区社交 / 体系命名**：使用灵智体体系名（灵智 / 灵智体 / 灵锻 / 灵典 / 灵议 / 育灵 / 灵忆 / 灵印）—— 仅用于社区网友之间的社交沟通，正式技术文档中专业术语优先、体系名作补充说明

### §1.4 参考文献

| 文档 | 用途 |
|------|------|
| [spec.md](spec.md) v7.1 | SRS 需求规格说明书（本文档的输入） |
| [features/](features/) 40 份 F0XX | Feature 级 SRS |
| [decisions/](decisions/) 13 份 ADR | 不可变架构决策记录 |
| [roleagent.md](roleagent.md) | 七大工程路径 |
| [review/review.md](review/review.md) v1.4 | 16 份审核归并 + 41 条 CL 同步矩阵 |
| [hiclaw/rules.md](../../hiclaw/rules.md) v3.2 | 开发规范 + 第十一部分文档分层规范 |
| [hiclaw/prompts.md](../../hiclaw/prompts.md) P52 | SAD 架构设计说明书模板 |
| [clowder-ai/docs/](../../clowder-ai/docs/) | 参考设计 |

### §1.5 文档组织

按 `hiclaw/rules.md` 第十一部分文档分层规范，本文档章节与 [spec.md](spec.md) §3 同号对应：

```
flowforge/docs/
├── spec.md（SRS 顶层）
├── arch.md（本文档，SAD 顶层 ≤ 3000 行）
├── design.md（SDD 顶层，基于 spec + arch + features + architecture）
├── features/           # Feature 级 SRS（F0XX-xxx.md，40 份）
├── architecture/       # Feature 级 SAD（A0XX-xxx.md，与 F0XX 同号一一对应）
├── design/             # Feature 级 SDD（D0XX-xxx.md，与 F0XX/A0XX 同号一一对应）
├── decisions/          # ADR 不可变历史（13 份）
├── review/             # 16 份审核文件
└── _archive/           # 历史归档（v6.0/v7.0 完整备份）
```

**三顶层文档章节同号**：同一核心功能在 spec.md/arch.md/design.md 中章节同号（如 §3.1 CapabilityProfile 在三个文档中都是 §3.1）。

---

## §2 架构总览

### §2.1 架构哲学

FlowForge 是一个**智能体自进化框架（Self-Evolving Agent Framework）**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统，并通过 **forgemind 应用层**承载多形态智能体（Forgekin，社区社交称"灵智体"）的育灵、灵锻、灵议闭环，走向通用智能体（General-Purpose Agent）愿景。

**核心公式**（来自 [roleagent.md §1](roleagent.md)）：

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

**架构哲学三原则**：
1. **让架构成为配置**：能用 YAML 配置解决的不写代码（配置驱动率 Phase 2 ≥ 80%）
2. **让扩展成为插件**：*Forge 通过 Plugin V3 四钩子注册灵智体到 forgemind
3. **让 Harness 负责约束、验证和进化**：ForgekinEngine 是 HarnessOrchestrator 的装饰器，不绕过护栏

### §2.2 三层架构（v7.1 强化版）

> **来源**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md) + operator 第 8/9 条指令
> **关联 SRS**：[spec.md §2.7](spec.md)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                  │
│  ContentForge / NovelForge / DevForge / MallForge / ...     │
│  通过 Plugin V3 四钩子注册灵智体到 forgemind                │
│  养垂直复杂领域灵智体（content/novel/dev/mall 等）          │
└─────────────────────────────────────────────────────────────┘
                            ↑ Plugin V3
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（多形态智能体育灵场所）           │
│  species_impl/ forging/ sensors/ worlds/ marketplace/       │
│  lineage/ codex/ council/ config/                           │
│  ForgeMindPlugin + ForgekinBase + ForgePipeline             │
│  养公共通用灵智体（动物/组织/物品/虚拟角色/混合形态）       │
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
| （新增）| **Layer 2: forgemind** | v6.0 无此层，v7.1 新增（多形态智能体育灵场所） |
| （新增）| **Layer 3: *Forge** | v6.0 隐含在应用层，v7.1 显式独立（垂直业务灵智体） |

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
| 5 | marketplace（灵智体市场） | `flowforge/forgemind/marketplace/` | §3.13 | F037 |
| 6 | lineage（进化谱系） | `flowforge/forgemind/lineage/` | §3.13 | F038 |
| 7 | codex（灵典 Mind Codex） | `flowforge/forgemind/codex/` | §3.4 / §3.14 | F039 |
| 8 | council（灵议 Mind Council） | `flowforge/forgemind/council/` | §3.14 | （待添加） |

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
9. **所有数据检索走 OpenSieve**（结构化 + 非结构化统一入口）
10. **所有数据库操作通过 Repository 层**（禁止直操作数据库）
11. **所有提示词外置 YAML 配置**（禁止硬编码提示词/路径/密钥/端口）
12. **所有依赖通过 DI 容器注入**（禁止绕过 DI 容器直接实例化）

### §2.7 智能体分类架构（静态智能体 vs 可进化智能体）

> **来源**：operator 2026-07-19 指令——"目前我们智能体分为静态智能体（传统的如 flowforge 中的和外部接入的 agent）、可进化智能体（flowforge 中的灵智体），这两类智能体的设计之前是有的，但现在的设计文档丢了呢，请加入回来。"
> **关联 SRS**：[spec.md §2.3](spec.md) 智能体分类
> **关联 SDD**：[design.md §2.6](design.md) 智能体分类详细设计
> **权威定义**：[design/naming-contract.md#2](design/naming-contract.md) v2.0 智能体分类
> **默认指代规则**：在 FlowForge 上下文中，"智能体"默认指代**可进化智能体（Evolvable Agent / Forgekin）**；若指代静态智能体必须明确说出"静态智能体"

FlowForge 生态的智能体（Agent）在架构层分为两大类，二者在架构位置、依赖关系、能力扩展机制上存在本质差异：

#### §2.7.1 静态智能体架构（Static Agent Architecture）

| 子类 | 架构位置 | 代码基类 | 关联模块 |
|------|---------|---------|---------|
| **FlowForge 内置静态智能体** | Layer 1 核心框架层 | `StaticAgent` / `DeclarativeAgent` / `ReActAgent` / `PlanExecuteAgent` | `flowforge/agents/generic/` |
| **外部接入静态智能体** | Layer 1 核心框架层（ExternalAgentAdapter 适配层） | `ExternalAgentAdapter` | `flowforge/core/external_agent/` |

**架构特征**：
- 无 Soul Imprint / 无 EchoStore / 无 CapabilityProfile / 无 EvolutionStage / 无 AwakeningStage
- 行为完全由 prompt + 工具集 + 配置决定
- 每次执行无状态，跨会话不积累能力
- 可作为可进化智能体的能力扩展（通过 ExternalAgentAdapter）

#### §2.7.2 可进化智能体架构（Evolvable Agent / Forgekin Architecture）

| 架构位置 | 代码基类 | 核心组件 |
|---------|---------|---------|
| Layer 2 forgemind 应用层 + Layer 1 核心框架层（ForgekinEngine） | `ForgekinBase` | ForgekinEngine + EchoStore + CapabilityProfile + SpiritForge + MindCodex + MindCouncil |

**架构特征**：
- 有 Soul Imprint（持久身份标识，跨会话不变）
- 有 EchoStore（情景记忆存储，跨会话积累）
- 有 CapabilityProfile（能力画像含盲点，跨会话演进）
- 有 EvolutionStage E1-E6（进化阶，能力成熟度）
- 有 AwakeningStage E1-E6（觉醒阶，自主性等级）
- 可通过 SpiritForge 蒸馏经验到 MindCodex
- 可参与 MindCouncil 多智能体议事
- 建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证

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

## §3 核心组件设计

> **章节同号说明**：本章节与 [spec.md §3](spec.md) 章节同号对应。每节仅放**架构层设计**，详细设计在 [design.md §3](design.md) + [design/D0XX-xxx.md](design/) 中。

### §3.1 CapabilityProfile（能力画像）× Harness 契合度

> **关联 SRS**：[spec.md §3.1](spec.md)（FR-CORE-001）
> **关联 Feature**：[features/F001-capability-profile.md](features/F001-capability-profile.md)
> **关联 ADR**：[decisions/004-capability-profile-routing.md](decisions/004-capability-profile-routing.md)
> **关联详细设计**：[design.md §3.1](design.md) + [design/D001-capability-profile.md](design/D001-capability-profile.md)（待创建）
> **roleagent 路径**：路径 1（RA-001~RA-008）
> **详细架构**：[architecture/A001-capability-profile.md](architecture/A001-capability-profile.md)（待创建）

**架构设计**：

CapabilityProfile 六维度画像（对应 roleagent.md 第 0 章三个可变性层）：

```
┌─────────────────────────────────────────────────────┐
│ CapabilityProfile（能力画像）                       │
├─────────────────────────────────────────────────────┤
│ 常量层：                                            │
│  - model_capability（模型固有能力）                 │
│  - cognitive_style（认知风格）                      │
├─────────────────────────────────────────────────────┤
│ 半常量层：                                          │
│  - blind_spots（坏直觉/盲点，同厂商 agent 共享）    │
├─────────────────────────────────────────────────────┤
│ 变量层：                                            │
│  - skill_packages（可加载知识包）                   │
│  - tool_boundary（工具边界）                        │
├─────────────────────────────────────────────────────┤
│ 累积层：                                            │
│  - historical_performance（历史表现）               │
├─────────────────────────────────────────────────────┤
│ 瞬时层：                                            │
│  - current_state（当前状态）                        │
├─────────────────────────────────────────────────────┤
│ 计算输出：                                          │
│  - harness_fit_score（Harness 契合度 0.0-1.0）      │
└─────────────────────────────────────────────────────┘
```

**关键架构契约**：
- Agent 状态三层：权重状态（模型厂商控制）/ 计算状态（模型架构控制）/ 现实状态（Harness 控制，唯一跨会话持久层）
- 路由基于能力匹配，不基于角色（替换 `default_llm_actors.py` 硬编码角色）
- 跨厂商 review 配对基于盲点不重叠（同厂商 agent 共享盲点是结构性问题）
- Build to Delete vs Built to Persist 判别器：标记半衰期

**架构不变量**：
- CapabilityProfile 必须包含 blind_spots（空列表报错）
- 路由算法延迟 < 100ms（10 个候选灵智体）
- 能力画像通过 Repository 层存储（禁直操作数据库）

### §3.2 TeamAct 六步循环 + 五项终止条件

> **关联 SRS**：[spec.md §3.2](spec.md)（FR-CORE-002）
> **关联 Feature**：[features/F002-teamact-loop.md](features/F002-teamact-loop.md) ~ [features/F007-push-back-protocol.md](features/F007-push-back-protocol.md)
> **关联 ADR**：[decisions/002-collaboration-protocol.md](decisions/002-collaboration-protocol.md)
> **roleagent 路径**：路径 2（RA-009~RA-016）
> **详细架构**：[architecture/A002-teamact-loop.md](architecture/A002-teamact-loop.md) ~ [architecture/A007-push-back-protocol.md](architecture/A007-push-back-protocol.md)（待创建）

**TeamAct 六步循环架构**：

```
State → Owner → Action → Evidence → Verdict → Route
  ↓       ↓       ↓         ↓         ↓        ↓
状态    持球    动作     证据      裁决     路由
```

**关键架构契约**：
- **五项终止条件**（缺一不可）：验收标准全部达成 + 证据已附 + 跨 agent 交叉验证 + 无悬空任务归属 + 愿景收敛
- **交接胶囊（resume capsule）**：What / Why / Tradeoff / Open / Next 五段
- **乒乓球熔断器**：看实质工具调用而非传球次数；3 次传球后触发；给数据不给结论
- **行首 @ 路由协议**：行首 @ 触发灵智体路由
- **持球注册（lease + 定时唤醒）**：一灵智体同时只能持有一个任务
- **Generator Push Back**：双向辩论协议（带证据 + 适用性论证 + 替代方案）
- **分形嵌套**：系统层 / 团队层 / 个体层

**架构不变量**：
- 不能自己 review 自己（跨 agent 交叉验证）
- 持球 lease 可定时唤醒（防止僵尸持球）
- Push Back 必须带证据 + 替代方案（不允许"我不同意"了事）

### §3.3 Harness 现实闭环运行时（七层表面）

> **关联 SRS**：[spec.md §3.3](spec.md)（FR-CORE-003）
> **关联 Feature**：[features/F008-durable-state-surfaces.md](features/F008-durable-state-surfaces.md) ~ [features/F013-harnessability.md](features/F013-harnessability.md)
> **关联 ADR**：[decisions/007-harness-engineering.md](decisions/007-harness-engineering.md)
> **roleagent 路径**：路径 3（RA-017~RA-023）
> **详细架构**：[architecture/A008-durable-state-surfaces.md](architecture/A008-durable-state-surfaces.md) ~ [architecture/A013-harnessability.md](architecture/A013-harnessability.md)（待创建）

**Harness 七层现实表面架构**：

| # | 层 | 名称 | 架构职责 |
|---|---|------|---------|
| 1 | L1 | Durable State Surfaces | 6 类持久状态表面：feature spec / git / task queue / thread session trace / memory federation / handoff capsule |
| 2 | L2 | Tool Mediation | 工具中介，统一工具调用接口（ToolRegistry.execute()） |
| 3 | L3 | Evidence & Sensors | commit / 先红后绿测试 / quality gate / 跨 agent review approve 或 blocking（禁止"approve 但后续再说"） |
| 4 | L4 | Governance Boundary | 治理规则沉到 native system role / developer role，压缩免疫 |
| 5 | L5 | Magic Words 逃生舱 | "第一性原理" / "我能猜出来" / "下次一定" / "星星罐子" |
| 6 | L6 | Entropy Control | hotfix 两周 sunset 强制审查，三选一无"再看看"：正式修复 / 接受为永久方案 / 已不再相关 |
| 7 | L7 | Harnessability 评估 | 稳定 API / 事件流回调 / 持久状态 / 可验证输出 / 操作幂等可回滚 / 权限边界 |

**关键架构契约**：
- **ForgekinEngine 是 HarnessOrchestrator 的装饰器**，不绕过护栏
- **低保真矩阵**：治理规则 × Agent 类型（不同 agent 类型有不同的治理规则强度）
- **Build to Delete vs Built to Persist**：所有 Harness 代码必须标记半衰期
- **Magic Words 逃生舱**：任何阶都不能绕过（包括 E6 灵智主导阶）

### §3.4 多域记忆联邦（六层架构）

> **关联 SRS**：[spec.md §3.4](spec.md)（FR-CORE-004）
> **关联 Feature**：[features/F014-memory-collection.md](features/F014-memory-collection.md) ~ [features/F017-consumption-weighted-ranking.md](features/F017-consumption-weighted-ranking.md) + [features/F039-mind-codex-searchable.md](features/F039-mind-codex-searchable.md)
> **roleagent 路径**：路径 4（RA-024~RA-030）
> **详细架构**：[architecture/A014-memory-collection.md](architecture/A014-memory-collection.md) ~ [architecture/A017-consumption-weighted-ranking.md](architecture/A017-consumption-weighted-ranking.md) + [architecture/A039-mind-codex-searchable.md](architecture/A039-mind-codex-searchable.md)（待创建）

**多域记忆联邦六层架构**：

```
┌─────────────────────────────────────────────────────┐
│ L6: 锻典 Mind Codex（可检索知识库，procedural memory）│
│     - 蒸馏知识库 / 策展技能库 / 程序性记忆           │
├─────────────────────────────────────────────────────┤
│ L5: 灵忆 EchoStore（情景记忆，episodic memory）      │
│     - Agent Experience Log / 经验日志               │
├─────────────────────────────────────────────────────┤
│ L4: 灵印 Mind Imprint（持久身份，persistent identity）│
│     - Agent Fingerprint / Persona Hash              │
├─────────────────────────────────────────────────────┤
│ L3: 三检索入口（three retrieval entry）             │
│     - 语义检索 / 时间检索 / 关联检索                │
├─────────────────────────────────────────────────────┤
│ L2: 记忆治理三要素（memory governance）             │
│     - 保留策略 / 冲突解决 / 访问控制                │
├─────────────────────────────────────────────────────┤
│ L1: 多域记忆 Collection（memory collection）        │
│     - 短期 / 工作 / 长期 / 跨会话 / 跨 agent / 跨域 │
└─────────────────────────────────────────────────────┘
```

**关键架构契约**：
- 记忆治理三要素：保留策略 / 冲突解决 / 访问控制
- 消费加权排序：基于使用频率 + 时间衰减 + 重要性权重
- 锻典可检索：基于向量检索 + 关键词检索 + 混合检索
- 所有记忆数据通过 Repository 层存储（禁直操作数据库）

### §3.5 Eval 自代谢系统（三层 eval）

> **关联 SRS**：[spec.md §3.5](spec.md)（FR-CORE-005）
> **关联 Feature**：[features/F018-eval-contract.md](features/F018-eval-contract.md) ~ [features/F020-seven-attribution.md](features/F020-seven-attribution.md) + [features/F040-harness-eval-control-plane.md](features/F040-harness-eval-control-plane.md)
> **roleagent 路径**：路径 5（RA-031~RA-036）
> **详细架构**：[architecture/A018-eval-contract.md](architecture/A018-eval-contract.md) ~ [architecture/A020-seven-attribution.md](architecture/A020-seven-attribution.md) + [architecture/A040-harness-eval-control-plane.md](architecture/A040-harness-eval-control-plane.md)（待创建）

**Eval 自代谢三层架构**：

```
┌─────────────────────────────────────────────────────┐
│ L3: 七类归因矩阵（seven attribution matrix）        │
│     - 模型 / 工具 / 提示 / 上下文 / 路由 / 状态 / 环境 │
├─────────────────────────────────────────────────────┤
│ L2: 三方信号交叉（three signal cross）              │
│     - trace 信号 + 用户信号 + 探针信号              │
├─────────────────────────────────────────────────────┤
│ L1: Eval Contract 五问（eval contract）             │
│     - 谁评估 / 评估什么 / 何时评估 / 评估信号 / 评估后做什么 │
└─────────────────────────────────────────────────────┘
```

**关键架构契约**：
- 三方信号交叉：trace 信号（系统侧）+ 用户信号（用户侧）+ 探针信号（主动探测）
- 七类归因矩阵：模型 / 工具 / 提示 / 上下文 / 路由 / 状态 / 环境
- Eval 账本 AB 回放：min_net_gain ≥ 0.05 才允许合并自我演进
- 自代谢触发：Eval 信号驱动文档/代码/框架更新

### §3.6 分布式可靠性（Tier 1-4 恢复分级）

> **关联 SRS**：[spec.md §3.6](spec.md)（FR-CORE-006）
> **关联 Feature**：[features/F021-side-effect-wal.md](features/F021-side-effect-wal.md) ~ [features/F025-provider-host-abstraction.md](features/F025-provider-host-abstraction.md)
> **roleagent 路径**：路径 6（RA-037~RA-042）
> **详细架构**：[architecture/A021-side-effect-wal.md](architecture/A021-side-effect-wal.md) ~ [architecture/A025-provider-host-abstraction.md](architecture/A025-provider-host-abstraction.md)（待创建）

**Tier 1-4 恢复分级架构**：

| Tier | 名称 | 恢复策略 | 触发条件 |
|------|------|---------|---------|
| Tier 0 | 物理世界不可逆操作 | **永不自动恢复**（如灯具灵智体故障引发火灾） | 物理世界副作用 |
| Tier 1 | 内存级失败 | 自动重试 + 状态恢复 | LLM 调用失败 / 工具调用失败 |
| Tier 2 | 持久状态失败 | WAL 重放 + 事务回滚 | 数据库写入失败 / 状态不一致 |
| Tier 3 | 进程级失败 | 检查点恢复 + 任务重派 | 进程崩溃 / OOM |
| Tier 4 | Provider 级失败 | 跨 provider 切换 + 宿主抽象 | LLM provider 不可用 |

**关键架构契约**：
- 副作用日志 WAL（Write-Ahead Log）可重放
- liveness 四态可识别：活着 / 退化 / 僵尸 / 等待宽限
- 弱状态机 vs 强 workflow：根据任务关键性选择
- 跨 provider 宿主抽象：可切换 LLM provider 不影响业务

### §3.7 伙伴系统数学（上限提高，下限托底）

> **关联 SRS**：[spec.md §3.7](spec.md)（FR-CORE-007）
> **关联 Feature**：合并入 [features/F007-push-back-protocol.md](features/F007-push-back-protocol.md)
> **roleagent 路径**：路径 7（RA-043~RA-047）
> **详细架构**：[architecture/A007-push-back-protocol.md](architecture/A007-push-back-protocol.md)（待创建，合并入 Push Back）

**伙伴系统数学公式**：

```
上限收益 ≈ max(不同 agent 提出的候选路径)        # 不是平均值，是候选路径的最大值
用户可见错误 ≈ author 犯错 × reviewer 没抓住 × 测试没暴露 × shared state 没证据 × eval 没归因 × CVO 没拉闸
```

**关键架构契约**：
- **上限**：max 成立的前提是路径足够不同（跨厂商、跨角色、跨工作习惯），需验证候选路径的盲点相关性
- **下限**：错误要连续穿过多层门才抵达用户，形式化为连乘概率模型，优先加固盲点相关性最高的门
- **波动吸收**：模型忘了→记忆联邦找回；agent 写偏了→review 退回；任务中断→可靠性控制面留恢复点；工具失效→eval 触发 sunset review；provider 不适合→调度换路径

### §3.8 forgemind 应用层 + 5 种形态分类

> **关联 SRS**：[spec.md §3.8](spec.md)（FR-CORE-008）+ [spec.md §2.6](spec.md)（5 种形态）
> **关联 Feature**：[features/F026-forgemind-app-layer.md](features/F026-forgemind-app-layer.md) + [features/F027-all-things-spirit-species.md](features/F027-all-things-spirit-species.md) + [features/F036-forgemind-forge-relationship.md](features/F036-forgemind-forge-relationship.md)
> **关联 ADR**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md) + [decisions/013-all-things-spirit-mind-vision.md](decisions/013-all-things-spirit-mind-vision.md)
> **详细架构**：[architecture/A026-forgemind-app-layer.md](architecture/A026-forgemind-app-layer.md) + [architecture/A027-all-things-spirit-species.md](architecture/A027-all-things-spirit-species.md) + [architecture/A036-forgemind-forge-relationship.md](architecture/A036-forgemind-forge-relationship.md)（待创建）

**forgemind 应用层架构**：

```
flowforge/forgemind/
├── __init__.py
├── plugins.py                    # ForgeMindPlugin 注册（Plugin V3 四钩子）
├── base.py                       # ForgekinBase 抽象类（三方法契约）
├── species.py                    # ForgekinSpecies 五大形态枚举
├── stages.py                     # EvolutionStage / AwakeningStage 进阶体系
├── soul_imprint.py               # MindImprint 灵印（不可变身份）
├── forms.py                      # ForgekinFormData 锻造表单
├── species_impl/                 # 5 形态灵智体实现
│   ├── bio_forgekin.py           # 生物灵智体（BioForgekin，对应 Embodied AI）
│   ├── org_forgekin.py           # 组织灵智体（OrgForgekin）
│   ├── obj_forgekin.py           # 物品灵智体（ObjForgekin，对应 Embodied AI）
│   ├── virtual_forgekin.py       # 虚拟灵智体（VirtualForgekin，对应 Character AI）
│   └── hybrid_forgekin.py        # 混合灵智体（HybridForgekin）
├── forging/                      # 锻造流水线
│   ├── pipeline.py               # ForgePipeline（6 步锻造流水线）
│   ├── awaken.py                 # 觉醒阶 E1-E6
│   └── evolve.py                 # 形态进化
├── sensors/                      # 物理传感器接入
├── worlds/                       # 虚拟世界设定层
├── marketplace/                  # 灵智体市场
├── lineage/                      # 灵智体进化谱系
├── codex/                        # 灵典 Mind Codex（可检索知识库）
├── council/                      # 灵议 Mind Council
├── forgekins/                    # 预置灵智体 YAML 配置
│   ├── architect_owl_luban.yaml    # 猫头鹰·鲁班（架构师）
│   ├── developer_hound_sherlock.yaml  # 猎犬·夏洛克（开发者）
│   ├── reviewer_peacock_vangogh.yaml  # 孔雀·梵高（评审员）
│   ├── tester_honeybadger_pingtou.yaml  # 蜜獾·平头哥（测试员）
│   └── docwriter_pen_wenxin.yaml  # 钢笔·文心（文档员）
├── config/                       # forgemind 配置（YAML 外置）
│   ├── species.yaml
│   ├── forging.yaml
│   ├── sensors.yaml
│   ├── worlds.yaml
│   └── prompts.yaml
└── tests/
```

**ForgekinBase 三方法契约**：

| 方法 | 用途 | 对应 Harness 层 |
|------|------|----------------|
| `observe(env) -> Observation` | 感知环境（物理传感器 / 虚拟世界设定 / 数字任务状态） | Evidence & Sensors (L3) |
| `act(observation) -> Action` | 执行动作（工具调用 / 物理执行器 / 虚拟行为） | Tool Mediation (L2) |
| `verify(action, result) -> Verdict` | 验证结果（测试 / lint / review / 物理反馈） | Governance Boundary (L4) |

**5 种形态分类**（详见 [spec.md §2.6](spec.md)）：

| # | 形态（中文 + 英文 + AI 业界概念） | 类名 | 物理接入 | 虚拟设定 |
|---|------|------|---------|---------|
| 1 | 生物灵智体（BioForgekin / Biological Spirit Agent） | BioForgekin | 摄像头 / 麦克风 / 可穿戴 | 行为画像 + 习性图谱 |
| 2 | 组织灵智体（OrgForgekin / Organizational Spirit Agent） | OrgForgekin | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| 3 | 物品灵智体（ObjForgekin / Object Spirit Agent，对应 Embodied AI 具身智能） | ObjForgekin | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| 4 | 虚拟灵智体（VirtualForgekin / Virtual Character Agent，对应 Character AI） | VirtualForgekin | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| 5 | 混合灵智体（HybridForgekin / Hybrid Spirit Agent） | HybridForgekin | 多源融合 | 多设定层叠加 |

**架构不变量**：
- forgemind 单向依赖核心框架层，禁止反向调用
- forgemind 不含业务领域代码（编程红线第 10 条）
- forgemind 通过 Plugin V3 协议注册，不直接实例化核心模块（编程红线第 12 条）
- forgemind 灵智体必须建立现实闭环（observe → act → verify）

### §3.9 ForgePipeline 灵智体锻造流水线（6 步）

> **关联 SRS**：[spec.md §3.9](spec.md)（FR-CORE-009）
> **关联 Feature**：[features/F028-forging-pipeline.md](features/F028-forging-pipeline.md)
> **详细架构**：[architecture/A028-forging-pipeline.md](architecture/A028-forging-pipeline.md)（待创建）

**ForgePipeline 6 步锻造流水线架构**：

| 步骤 | 名称 | 输入 | 输出 |
|:----:|------|------|------|
| 1 | 形态定义（What to forge） | species + 能力画像需求 | ForgekinSpec |
| 2 | 能力注入（Capability injection） | ForgekinSpec + 模型 + 工具集 | CapabilityProfile |
| 3 | 记忆初始化（Memory seeding） | 初始记忆 + 价值观设定 | MindEcho 初始条目 |
| 4 | 价值观对齐（Value alignment） | 价值观设定 + 红线清单 | ValueCharter |
| 5 | 能力验证（Capability verification） | 能力基线测试用例 | 能力基线测试报告 |
| 6 | 觉醒晋升（Awakening promotion） | 验证通过 + operator 批准 | E1 灵启 Initiation 状态 |

**架构契约**：
- 步骤 1-5 可自动执行，步骤 6 必须 operator 显式批准
- 步骤 4 价值观对齐必须包含红线清单（不可妥协的安全约束）
- 步骤 5 能力验证必须通过 T1-T8 铁律测试

### §3.10 三方 Agent 集成（ExternalAgentAdapter 抽象层）

> **关联 SRS**：[spec.md §3.10](spec.md)（FR-CORE-010）+ [spec.md §2.9](spec.md)
> **关联 Feature**：[features/F031-external-agent-adapter.md](features/F031-external-agent-adapter.md) ~ [features/F035-external-agent-capability-fusion.md](features/F035-external-agent-capability-fusion.md)
> **关联 ADR**：[decisions/006-external-agent-integration.md](decisions/006-external-agent-integration.md)
> **详细架构**：[architecture/A031-external-agent-adapter.md](architecture/A031-external-agent-adapter.md) ~ [architecture/A035-external-agent-capability-fusion.md](architecture/A035-external-agent-capability-fusion.md)（待创建）

**ExternalAgentAdapter 抽象层架构**：

```
flowforge/core/external_agent/
├── __init__.py
├── adapter.py             # ExternalAgentAdapter 抽象
├── bridge.py              # ExternalAgentBridge（灵智体调用入口）
├── profile.py             # ExternalAgentProfile（三方 Agent 能力画像）
├── shared_state.py        # ExternalAgentSharedState（状态共享）
├── fallback.py            # ExternalAgentFallback（失败回退链）
├── capability_fusion.py   # ExternalAgentCapabilityFusion（能力融合）
└── adapters/              # 具体三方 Agent 适配器
    ├── __init__.py
    ├── claude_code.py     # Claude Code Adapter
    ├── codex.py           # Codex Adapter
    ├── opencode.py        # OpenCode Adapter
    └── trae.py            # Trae Adapter
```

**EAC v1 七契约**（External Agent Contract）：

| # | 契约 | 用途 |
|---|------|------|
| 1 | Invocation | 调用契约（CLI / A2A Protocol） |
| 2 | Stream | 流式输出契约（SSE / WebSocket） |
| 3 | Session | 会话管理契约（创建 / 恢复 / 销毁） |
| 4 | Capability | 能力画像契约（六维画像 + 盲点） |
| 5 | Collaboration | 协作契约（SharedState + Fallback） |
| 6 | Safety | 安全契约（六层 Guardrails + worktree 隔离） |
| 7 | Avatar Sync + System Prompt Configuration Map | 虚拟形象同步 + 系统提示配置映射 |

**六层 Guardrails**（详见 [hiclaw/rules.md](../../hiclaw/rules.md) AI 编程优秀实践）：

| # | 层 | 用途 |
|---|---|------|
| 1 | Input validation | 输入校验（防止注入 / 越权） |
| 2 | System prompt constraints | 系统提示约束（角色边界 / 安全红线） |
| 3 | Tool allow-lists | 工具白名单（只能调用允许的工具） |
| 4 | Output validation | 输出校验（防止泄露 / 错误信息） |
| 5 | Action confirmation | 动作确认（不可逆操作必须确认） |
| 6 | Cost ceiling | 成本上限（防止 LLM 调用爆炸） |

**关键架构契约**：
- 三方 Agent 是能力扩展（Capability Extension），不是工具调用
- 三方 Agent 能力画像纳入灵智体能力画像融合（CapabilityFusion）
- 三方 Agent 执行状态写入灵智体共享状态（SharedState）
- 三方 Agent 失败由灵智体 fallback 链回退（FallbackChain）
- 三方 Agent 执行轨迹纳入灵智体 Eval 信号（EvalSignal）

### §3.11 物理 AI 传感器接入（具身智能路径，Embodied AI）

> **关联 SRS**：[spec.md §3.11](spec.md)（FR-CORE-011）
> **关联 Feature**：[features/F029-physical-ai-sensors.md](features/F029-physical-ai-sensors.md)
> **详细架构**：[architecture/A029-physical-ai-sensors.md](architecture/A029-physical-ai-sensors.md)（待创建）

**物理 AI 传感器接入架构**：

```
flowforge/forgemind/sensors/
├── __init__.py
├── base.py                # SensorChannel 抽象
├── camera.py              # 摄像头（视觉感知）
├── microphone.py          # 麦克风（听觉感知）
├── iot.py                 # IoT 协议（温度/位置/加速度等）
└── fusion.py              # 多传感器数据融合
```

**关键架构契约**：
- 物理传感器数据写入灵忆 EchoStore（情景记忆）
- 传感器数据通过 Repository 层存储（禁直操作数据库）
- 物理 AI 传感器接入受 Tier 0 保护（物理世界不可逆操作永不自动恢复）

### §3.12 虚拟世界设定层（Character AI 路径）

> **关联 SRS**：[spec.md §3.12](spec.md)（FR-CORE-012）
> **关联 Feature**：[features/F030-virtual-world-setting.md](features/F030-virtual-world-setting.md)
> **详细架构**：[architecture/A030-virtual-world-setting.md](architecture/A030-virtual-world-setting.md)（待创建）

**虚拟世界设定层架构**：

```
flowforge/forgemind/worlds/
├── __init__.py
├── base.py                # WorldSetting 抽象
├── character.py           # 角色设定（孙悟空/福尔摩斯/鲁班等）
├── worldview.py           # 世界观（西游/推理/工艺等）
└── relationship.py        # 关系网（角色间关系）
```

**关键架构契约**：
- 虚拟世界设定层与灵印 Mind Imprint 隔离（防止临时 RP 台词污染永久身份）
- 虚拟角色灵智体可演 1000 次孙悟空后核心身份不被污染
- 虚拟世界设定层对应业界 Character AI / NPC Agent / Persona-Driven Agent

### §3.13 灵智体市场 + 进化谱系

> **关联 SRS**：[spec.md §3.13](spec.md)（FR-CORE-013）
> **关联 Feature**：[features/F037-forgemind-marketplace.md](features/F037-forgemind-marketplace.md) + [features/F038-forgemind-lineage.md](features/F038-forgemind-lineage.md)
> **详细架构**：[architecture/A037-forgemind-marketplace.md](architecture/A037-forgemind-marketplace.md) + [architecture/A038-forgemind-lineage.md](architecture/A038-forgemind-lineage.md)（待创建）

**灵智体市场 + 进化谱系架构**：

- **ForgekinMarketplace**：灵智体注册 / 发现 / 共享 / 交易
- **ForgekinLineage**：灵智体进化谱系记录（父母 / 子女 / 形态进化路径）

**关键架构契约**：
- 市场注册的灵智体必须通过 ForgePipeline 6 步验证
- 进化谱系记录灵智体的形态进化路径（如 BioForgekin → HybridForgekin）
- 谱系数据通过 Repository 层存储（禁直操作数据库）

### §3.14 灵锻 SpiritForge + 灵议 Mind Council

> **关联 SRS**：[spec.md §3.14](spec.md)（FR-CORE-014）+ [spec.md §2.10](spec.md)（自我演进闭环）
> **关联 Feature**：（合并入 F039 + 待添加 F042 灵议）
> **详细架构**：[architecture/A039-mind-codex-searchable.md](architecture/A039-mind-codex-searchable.md) + architecture/A042-mind-council.md（待创建）

**灵锻 SpiritForge 架构**（经验蒸馏 / 离线策略学习 / 知识编译）：

```
经验（EchoStore）→ 蒸馏（SpiritForge）→ 知识（Mind Codex）
   ↓                  ↓                    ↓
情景记忆           离线策略学习          程序性记忆
```

**灵议 Mind Council 架构**（多智能体议事 / 去中心化共识 / 智能体议会）：

```
┌─────────────────────────────────────────────────────┐
│ 灵议 Mind Council（多灵智体议事）                   │
├─────────────────────────────────────────────────────┤
│  灵智体 A（架构师） ─┐                              │
│  灵智体 B（开发者） ─┼→ 共识协议 → 决策输出        │
│  灵智体 C（评审员） ─┘                              │
└─────────────────────────────────────────────────────┘
```

**关键架构契约**：
- 灵锻将情景记忆（EchoStore）蒸馏为程序性记忆（Mind Codex）
- 灵议用于 E5-E6 觉醒阶的多灵智体共识决策
- 灵议共识受 operator 拉闸权约束（不可逆决策必须 operator 确认）

### §3.15 Plugin V3 四钩子

> **关联 SRS**：[spec.md §3.15](spec.md)（FR-CORE-015）
> **关联 ADR**：[decisions/003-plugin-v3-protocol.md](decisions/003-plugin-v3-protocol.md)
> **详细架构**：（合并入 [architecture/A026-forgemind-app-layer.md](architecture/A026-forgemind-app-layer.md)）

**Plugin V3 四钩子架构**（V2 兼容 + V3 新增）：

| 版本 | 钩子 | 用途 |
|------|------|------|
| V2（保留） | register_agents | 注册 Agent |
| V2（保留） | register_tools | 注册工具 |
| V2（保留） | register_loops | 注册 Loop |
| V2（保留） | register_workflows | 注册 Workflow |
| V2（保留） | register_routes | 注册路由 |
| V2（保留） | register_schedules | 注册定时任务 |
| V2（保留） | register_event_handlers | 注册事件处理器 |
| V2（保留） | register_gates | 注册门禁 |
| V2（保留） | register_evaluators | 注册评估器 |
| V2（保留） | on_startup / on_shutdown | 启动 / 关闭钩子 |
| **V3（新增）** | **register_forgekins** | **注册灵智体到 forgemind** |
| **V3（新增）** | **register_forge_skills** | **注册灵智体技能** |
| **V3（新增）** | **register_council_channels** | **注册灵议通道** |
| **V3（新增）** | **register_auto_forge_config** | **注册自动锻造配置** |

**关键架构契约**：
- *Forge 通过 Plugin V3 四钩子注册灵智体到 forgemind
- Plugin V3 向下兼容 V2（V2 钩子保留）
- 所有 Plugin 通过 DI 容器管理（编程红线第 12 条）

### §3.16 其他核心需求架构（FR-CORE-016~030）

> **关联 SRS**：[spec.md §3.16](spec.md)（FR-CORE-016~030）
> **详细架构**：见对应 [architecture/A0XX-xxx.md](architecture/) 文件

FR-CORE-016 ~ FR-CORE-030 的架构设计分散到对应 Feature 的 architecture/A0XX-xxx.md 文件中，详见 [architecture/README.md](architecture/README.md)。

### §3.17 review.md 41 条 CL 同步矩阵（架构层收尾章）

> **关联 SRS**：[spec.md §3.17](spec.md)
> **详细同步矩阵**：详见 [review/review.md](review/review.md) v1.4 第十三章/第十四章

41 条 CL（CL-001~CL-041）已全部同步到 [features/](features/) + [architecture/](architecture/) + [decisions/](decisions/) + 本文档对应章节。架构层关键变更影响分析（10 项关键 CL）：

| CL # | 变更内容 | 架构影响 | 同步位置 |
|------|---------|---------|---------|
| CL-001 | 灵智体定义去 AGI 化 | §2.1 + §3.8 | spec.md §2.3 + arch.md §2.1 |
| CL-005 | 12 核心概念三标注 | §2.1 术语 | spec.md §2.4 + naming-contract.md |
| CL-006 | 进化阶/觉醒阶三标注 | §2.1 术语 | spec.md §2.5 + naming-contract.md |
| CL-008 | 魂忆→灵忆 / 魂印→灵印 | 全局术语 | 全部文档 |
| CL-010 | forgemind 应用层定位 | §2.2 + §3.8 | spec.md §2.8 + arch.md §3.8 |
| CL-015 | 三方 Agent EAC 七契约 | §3.10 | spec.md §3.10 + arch.md §3.10 |
| CL-020 | 自我演进闭环 | §2.1 + §3.14 | spec.md §2.10 + arch.md §3.14 |
| CL-025 | 弱化万物虚幻用语 | 全局术语 | 全部文档 |
| CL-030 | 责任方名称（猫头鹰·鲁班等） | §1.1 读者 | spec.md §1.1 + arch.md §1.1 |
| CL-041 | 文档分层规范 | §1.5 文档组织 | hiclaw/rules.md 第十一部分 |

---

## §4 接口设计

> **关联 SRS**：[spec.md §4](spec.md) 外部接口

### §4.1 对外 API 接口（FastAPI）

> **详细设计**：[design.md §4.1](design.md) + [design/D043-api-endpoints.md](design/D043-api-endpoints.md)（待创建）

**核心 API 端点架构**（RESTful + SSE 流式）：

| 路径 | 方法 | 用途 |
|------|------|------|
| `/api/v7/forgekins` | POST | 创建灵智体 |
| `/api/v7/forgekins/{id}` | GET | 查询灵智体 |
| `/api/v7/forgekins/{id}/evolve` | POST | 触发形态进化 |
| `/api/v7/forgekins/{id}/awaken` | POST | 触发觉醒阶晋升 |
| `/api/v7/forgekins/{id}/chat` | POST | 灵智体对话（SSE 流式） |
| `/api/v7/forgekins/{id}/observe` | POST | 触发观察 |
| `/api/v7/forgekins/{id}/act` | POST | 触发动作 |
| `/api/v7/forgekins/{id}/verify` | POST | 触发验证 |
| `/api/v7/council/meetings` | POST | 创建灵议会议 |
| `/api/v7/external-agents/invoke` | POST | 调用三方 Agent |

**架构契约**：
- 所有 API 使用 FastAPI + async/await
- 所有 API 通过 DI 容器注入依赖
- 所有 API 通过 Repository 层访问数据库
- SSE 流式接口用于长任务（如灵智体对话 / 锻造流水线）

### §4.2 SDK 接口（FlowForgeSDK）

> **详细设计**：[design.md §4.2](design.md) + [design/D044-sdk.md](design/D044-sdk.md)（待创建）

**FlowForgeSDK 统一入口架构**：

```python
from flowforge.sdk import FlowForgeSDK

sdk = FlowForgeSDK()
forgekin = sdk.forgekins.create(species="bio", ...)
result = await forgekin.chat("...")
```

### §4.3 Plugin V3 接口

> **详细规格**：详见 [spec.md §3.15](spec.md) + 本文档 §3.15

### §4.4 三方 Agent EAC 接口

> **详细规格**：详见 [spec.md §4.4](spec.md) + 本文档 §3.10

### §4.5 IM/WebChat 渠道接口

> **详细设计**：[design.md §4.5](design.md) + [design/D030-spirit-forge-mind-council.md](design/D030-spirit-forge-mind-council.md)（待创建）

- Web Chat 渠道（默认）
- 飞书渠道
- 微信公众号 / 个人号渠道
- WebChat 升级版（5 评委并行评审）

---

## §5 数据设计

> **关联 SRS**：[spec.md §5](spec.md) 非功能需求

### §5.1 数据存储架构

| 存储类型 | 用途 | 实现 |
|---------|------|------|
| SQLite | 任务 / 审计 / 灵智体元数据 | SQLAlchemy ORM + Repository 层 |
| OpenSieve PostgreSQL | 文档索引 / 知识库 / 锻典 Mind Codex | OpenSieve SDK/API（localhost:8100） |
| 文件系统 | 灵智体 YAML 配置 / 灵忆 EchoStore 日志 | YAML + JSON Lines |
| Git | 代码 / 文档 / ADR / Feature 规格 | git CLI |

**架构契约**：
- 所有数据库操作通过 Repository 层（编程红线第 13 条）
- 所有数据检索走 OpenSieve（结构化 + 非结构化统一入口）
- 灵忆 EchoStore 使用 JSON Lines 格式（便于追加 + 流式读取）
- 灵印 Mind Imprint 不可变（持久身份 / 智能体指纹 / 人格哈希）

### §5.2 核心数据模型

**ForgekinBase 数据模型**：

```python
class ForgekinBase(BaseModel):
    forgekin_id: str                    # 灵智体 ID（唯一）
    soul_imprint: str                   # 灵印 Mind Imprint（不可变身份）
    form_data: ForgekinFormData         # 形态数据
    evolution_stage: EvolutionStage     # 进化阶 E1-E6
    awakening_stage: AwakeningStage     # 觉醒阶 E1-E6
    created_at: datetime
    lineage_id: Optional[str]           # 进化谱系 ID
    capability_profile_id: Optional[str]  # 能力画像 ID
```

**CapabilityProfile 数据模型**：

```python
class CapabilityProfile(BaseModel):
    profile_id: str
    forgekin_id: str
    model_capability: ModelCapability   # 常量层
    cognitive_style: CognitiveStyle     # 常量层
    blind_spots: list[BlindSpot]        # 半常量层
    skill_packages: list[SkillPackage]  # 变量层
    tool_boundary: ToolBoundary         # 变量层
    historical_performance: PerformanceLog  # 累积层
    current_state: AgentState           # 瞬时层
    harness_fit_score: float            # 计算输出
```

### §5.3 配置文件架构

| 配置文件 | 路径 | 用途 |
|---------|------|------|
| `system.yaml` | `config/system.yaml` | 系统配置（端口 / 数据库 / LLM provider） |
| `models.yaml` | `flowforge/config/models.yaml` | LLM 模型配置 |
| `llm_route.yaml` | `flowforge/config/llm_route.yaml` | LLM 路由配置 |
| `species.yaml` | `flowforge/forgemind/config/species.yaml` | 灵智体形态配置 |
| `forging.yaml` | `flowforge/forgemind/config/forging.yaml` | 锻造流水线配置 |
| `sensors.yaml` | `flowforge/forgemind/config/sensors.yaml` | 传感器配置 |
| `worlds.yaml` | `flowforge/forgemind/config/worlds.yaml` | 虚拟世界设定配置 |
| `prompts.yaml` | `flowforge/forgemind/config/prompts.yaml` | 提示词外置配置 |

**架构契约**：
- 所有提示词外置 YAML 配置（编程红线第 11 条）
- 所有路径 / 密钥 / 端口通过配置注入（编程红线第 11 条）
- 配置驱动率 Phase 2 ≥ 80%

---

## §6 部署架构

### §6.1 单机部署（开发环境）

```
┌─────────────────────────────────────────────────────┐
│ 开发机（Windows / Linux）                           │
├─────────────────────────────────────────────────────┤
│ FlowForge（FastAPI :8000）                          │
│ OpenSieve（PostgreSQL :8100）                       │
│ OpenRoute（多模型 API 网关 :6000）                  │
│ ContentForge（FastAPI :8001）                       │
│ NovelForge（FastAPI :8003）                         │
│ DevForge（FastAPI :8002）                           │
│ MallForge（FastAPI :8004）                          │
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

## §7 历史背景资料

> **声明**：本章节保留 v7.0 / v6.0 历史架构章节作为背景资料，**不作为开发依据**；开发依据以 §1-§6（v7.1 权威内容）+ ADR/Feature/Architecture 子目录为准。

### §7.1 v7.0 历史架构（已合并到 v7.1）

> **状态**：✅ v7.0 历史架构已逐章节合并到 v7.1 §1-§6 对应位置；v7.0 完整架构内容备份在 [`_archive/arch_v71_full_backup_20260719.md`](_archive/arch_v71_full_backup_20260719.md)，仅作演化路径参考。

**v7.0 → v7.1 架构合并映射**：

| v7.0 架构章节 | v7.1 合并位置 | 合并状态 |
|--------------|--------------|:--------:|
| v7.0-§A0 灵智体架构定义 | v7.1 §2.1 + §3.8 | ✅ |
| v7.0-§A1 术语修订表 | v7.1 §1.3 + [design/naming-contract.md](design/naming-contract.md) | ✅ |
| v7.0-§A2 三层架构 | v7.1 §2.2 + §2.3 | ✅ |
| v7.0-§A3 万物灵智体形态分类 | v7.1 §3.8 | ✅ |
| v7.0-§A4 三方 Agent 集成架构 | v7.1 §3.10 | ✅ |
| v7.0-§A5 自我演进架构 | v7.1 §3.14 + [spec.md §2.10](spec.md) | ✅ |
| v7.0-§A6 12 核心概念索引 | v7.1 §1.3 + [spec.md §2.4](spec.md) | ✅ |
| v7.0-§A7 41 条 CL 同步矩阵 | v7.1 §3.17 | ✅ |
| v7.0-§0 万物灵智体世界愿景架构 | v7.1 §2.1 + §3.8 | ✅ |
| v7.0-§1 三层架构重构 | v7.1 §2.2 | ✅ |
| v7.0-§2 育灵体系命名融合 | v7.1 §1.3 + [design/naming-contract.md](design/naming-contract.md) | ✅ |
| v7.0-§3 roleagent 七大工程路径 | v7.1 §3.1-§3.7 | ✅ |
| v7.0-§4 forgemind 应用层架构 | v7.1 §3.8 | ✅ |
| v7.0-§5 三方 Agent 集成架构 | v7.1 §3.10 | ✅ |
| v7.0-§6 Plugin V3 四钩子 | v7.1 §3.15 | ✅ |
| v7.0-§17 新增核心模块 | v7.1 §3.1-§3.14 | ✅ |
| v7.0-§15 v7.0 七层架构模型 | v7.1 §2.2 三层架构 | ✅ |

### §7.2 v6.0 历史架构（背景资料）

> **状态**：v6.0 是已实现代码的背景资料，**不在 v7.1 开发范围内**。v6.0 完整架构内容备份在 [`_archive/arch_v71_full_backup_20260719.md`](_archive/arch_v71_full_backup_20260719.md) 的 v6.0 历史章节中（行 315-2475）。

**v6.0 历史架构章节摘要**：

| v6.0 章节 | 一句话摘要 | v7.1 引用价值 |
|----------|----------|--------------|
| 第一章：项目概述与设计目标 | 核心公式 Agent 质量 = 模型能力 × Harness 契合度 | 已被 v7.1 §2.1 升级 |
| 第二章：架构总览 | 六层架构模型 + 控制回路 + Hook 点 | 已被 v7.1 §2.2 升级为三层架构 |
| 第三章：核心定位与竞品分析 | 三维定位模型 + 竞品对比 + 核心护城河 | 已被 v7.1 §2.1 升级 |
| 第四章：核心接口设计 | TaskContext / BaseAgent / BaseTool / BaseModeExecutor / HybridExecutor | 已被 v7.1 §4 升级 |
| 第五章：九大内置模式 | Reflexion / Workflow / Plan-Execute 等 9 模式 | 部分作背景，v7.1 升级为 TeamAct |
| 第六章：通用 Agent 库与 Workflow 库 | 内容创作 / 小说 / 代码 Agent | 已迁移到 *Forge 项目 |
| 第七章：Harness 驾驭层设计 | 上下文工程 / 会话管理 / 反馈循环 / 熵管理 | 已被 v7.1 §3.3 升级为 Harness 七层 |
| 第八章：Skill 系统架构 | SkillAdapter / SkillRegistry / Combo Skills | 已被 v7.1 §3.14 升级为灵锻 SpiritForge |
| 第九章：MCP 模块架构 | 四层架构 / MCPBroker / MCPGateway | 已被 v7.1 §3.10 升级为 ExternalAgentAdapter |
| 第十章：重量级模块详细设计 | Agent 模式执行器 / 三层防御 / Multi-Agent 三策略 | 部分作背景 |
| 第十一章：事件系统与可观测性 | EventBus / 可观测性 / 检查点 | 已被 v7.1 §3.5 + §6.3 升级 |
| 第十二章：安全机制 | 三层权限管线 / Persona 锁 / HITL / 沙箱 | 已被 v7.1 §3.3 Governance Boundary 升级 |
| 第十三章：配置化与启动 | harness_v6.yaml / 编程式启动 | 已被 v7.1 §5.3 升级 |
| 第十四章：增量迁移策略 | v5.0 → v6.0 迁移 | 已迁移到 [task.md](task.md) |
| 第十五章：v5.0 → v6.0 迁移映射表 | 模块映射 | 已迁移到 [task.md](task.md) |
| 第十六章：开源与社区 | MIT 协议 / 社区治理 | 已迁移到 [VISION.md](VISION.md) |
| 第十七章：v7.0 新增核心模块 | 9 大新增模块 | 已被 v7.1 §3 升级 |

---

> **本文档版本**：v7.1（2026-07-19）
> **下一阶段**：基于本文档 + [spec.md](spec.md) + [features/](features/) 开发 [design.md](design.md)（SDD 详细设计说明书），按 [hiclaw/rules.md §11.3](../../hiclaw/rules.md) 三阶段开发流程执行。
> **配套文档**：[spec.md](spec.md) + [design.md](design.md) + [features/](features/) + [architecture/](architecture/) + [design/](design/) + [decisions/](decisions/) + [review/](review/)
