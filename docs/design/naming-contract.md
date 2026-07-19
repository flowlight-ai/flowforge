# FlowForge 命名契约（Naming Contract）

> **文档编号**: design/naming-contract.md（v2.0）
> **依据**: `[doc:decisions/012-naming-fusion.md]` 命名融合 ADR + `[doc:VISION.md#7]` operator 愿景锚点 + `[hiclaw/rules.md#12.2]` 术语规范方法论
> **维护规则**: 命名变更必须通过新增 ADR，不可直接修改本文件中的旧命名（真相源唯一）
> **目的**: 让 FlowForge 生态的所有概念可被智能体自身和人类开发者共同理解、记忆、引用
> **v2.0 关键变更**：根据 operator 2026-07-19 指令全面重构——确立"官方名称优先"原则（AI 业界专业术语为正式名称，体系别名仅用于社区社交）；新增 §2 智能体分类（静态智能体 vs 可进化智能体）；技术文档/代码/对外宣传中大量出现的必须是官方名称；正式文档中如出现体系别名必须首次标注官方名称

---

## 1. 命名总原则

### 1.1 官方名称优先原则（核心铁律）

FlowForge 生态的所有概念采用**三层命名体系**，按以下优先级在正式场合使用：

| 优先级 | 名称类型 | 使用场景 | 示例 |
|:------:|---------|---------|------|
| **P0** | **官方名称（AI 业界专业术语）** | 技术设计文档、代码、API、对外宣传、README、VISION | Agent / Multi-Agent System / Capability Profile / Episodic Memory / Skill Library / Multi-Agent Deliberation |
| **P1** | **项目英文名** | 代码类名、模块名、配置项、API 路径 | `ForgekinEngine` / `EchoStore` / `MindCodex` / `CapabilityProfile` / `MindCouncil` |
| **P2** | **体系别名（仅社交用）** | 社区讨论、技术博客口语化表达、网友交流 | 灵智 / 灵智体 / 灵忆 / 灵印 / 灵锻 / 灵典 / 灵议 / 育灵 |

**铁律**：
1. **正式文档优先使用 P0 官方名称**：技术设计文档（spec.md / arch.md / design.md / features / architecture / design 子目录）、代码、API、对外宣传材料中，**大量出现的必须是 P0 官方名称**
2. **P2 体系别名仅用于社交**：社区讨论、技术博客口语化表达可用体系别名，但**首次出现时必须标注 P0 官方名称**（如"灵智体（Forgekin / Autonomous Agent with Persistent Identity）"）
3. **正式文档中如出现 P2 别名必须双标注**：在正式文档中若为强调项目品牌而使用 P2 别名，必须以"别名（官方名称）"格式首次标注（如"灵智（ForgeMind，Persistent Identity Agent）"）
4. **代码层严禁使用 P2 别名**：类名、变量名、配置项、API 路径、注释中严禁出现 P2 别名作为标识符

### 1.2 双轨命名策略（保留但重新定位）

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| **官方文档层** | spec.md / arch.md / design.md / 对外宣传 | **官方名称（P0）优先 + 项目英文名（P1）作主名** | "Autonomous Agent with Persistent Identity（项目代号 Forgekin）" |
| **代码层** | 类名、变量名、配置项、API 路径 | **项目英文名（P1）** | `ForgekinEngine`、`forgekin_id`、`/api/v7/forgekins` |
| **社区社交层** | 开源宣传、技术博客、网友交流 | **体系别名（P2）+ 官方名称（P0）首次双标注** | "灵智体（Forgekin / Autonomous Agent with Persistent Identity）" |

### 1.3 概念锚定原则

每个项目英文名（P1）必须配 AI 业界专业术语（P0）作为概念锚定，便于跨语言、跨背景理解。本文件 §3 的 12 核心概念命名表严格按此原则组织。

### 1.4 真相源唯一原则

本文件是 FlowForge 生态所有命名的**唯一权威定义源**。其他文档必须用 `[doc:design/naming-contract.md#章节]` 引用，不可自行定义或修改命名。

### 1.5 旧名废弃原则

旧名在新文档/代码中不再使用，但保留在本文件 §6"废弃命名清单"作为历史索引。废弃命名变更必须通过 ADR 决策。

---

## 2. 智能体分类（Agent Taxonomy）

> **核心区分**：FlowForge 生态的智能体分为两大类——**静态智能体（Static Agent）** 与 **可进化智能体（Evolvable Agent）**。
> **默认指代规则**：在 FlowForge 上下文中，"智能体"默认指代**可进化智能体**；若指代静态智能体必须明确说出"静态智能体"。

### 2.1 静态智能体（Static Agent）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Static Agent / Stateless Agent / Task-Specific Agent |
| **项目英文名（P1）** | StaticAgent / TaskAgent / ToolAgent |
| **体系别名（P2，仅社交）** | （无体系别名，直接称"静态智能体"） |
| **定义** | 不具备自进化能力的智能体。行为由固定 prompt + 工具集 + 配置决定，无持久身份、无经验蒸馏、无觉醒阶晋升。每次执行都是无状态的。 |
| **包含子类** | 1. **FlowForge 内置静态智能体**：传统 DeclarativeAgent / ReAct Agent / Plan-Execute Agent 等<br>2. **外部接入智能体**：第三方 Agent（如 Claude Code / Codex / OpenCode / Trae IDE 等通过 ExternalAgentAdapter 接入） |
| **使用场景** | 单次任务执行、工具调用、无状态查询、作为可进化智能体的能力扩展 |
| **代码用法** | `class StaticAgent`、`class DeclarativeAgent`、`class ExternalAgentAdapter` |
| **关键特征** | - 无 Soul Imprint（持久身份）<br>- 无 EchoStore（经验记忆）<br>- 无 EvolutionStage（进化阶）<br>- 无 AwakeningStage（觉醒阶）<br>- 行为完全由 prompt + 配置决定 |
| **与可进化智能体关系** | 静态智能体可作为可进化智能体的**能力扩展**（通过 ExternalAgentAdapter），但反向不可——静态智能体不能"升级"为可进化智能体 |

### 2.2 可进化智能体（Evolvable Agent）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Evolvable Agent / Autonomous Agent with Persistent Identity / Self-Evolving Agent |
| **项目英文名（P1）** | Forgekin |
| **体系别名（P2，仅社交）** | 灵智体 |
| **定义** | 具备自进化能力的智能体。具有持久身份（Soul Imprint）、经验记忆（EchoStore）、能力画像（Capability Profile），可通过经验蒸馏（SpiritForge）持续提升能力，通过觉醒阶（Awakening Stage）逐步扩大自主权。建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证。 |
| **核心特征** | - 有 Soul Imprint（持久身份标识）<br>- 有 EchoStore（经验记忆库）<br>- 有 Capability Profile（能力画像含盲点）<br>- 有 EvolutionStage E1-E6（进化阶）<br>- 有 AwakeningStage E1-E6（觉醒阶）<br>- 可通过 SpiritForge 蒸馏经验到 MindCodex<br>- 可参与 MindCouncil 多智能体议事 |
| **使用场景** | forgemind 应用层、*Forge 垂直业务层、长期任务执行、跨会话能力积累 |
| **代码用法** | 类名前缀：`ForgekinBase`、`ForgekinEngine`、`ForgekinSpecies`；变量名：`forgekin_id` |
| **关联 Feature** | `[doc:features/F026-all-things-spirit-base.md]`、`[doc:features/F027-all-things-spirit-species.md]` |
| **与静态智能体关系** | 可进化智能体可通过 ExternalAgentAdapter 调用静态智能体作为能力扩展，但本身具备完整自进化闭环 |

### 2.3 两类智能体对比矩阵

| 维度 | 静态智能体（Static Agent） | 可进化智能体（Evolvable Agent / Forgekin） |
|------|---------------------------|------------------------------------------|
| **持久身份** | ❌ 无 | ✅ Soul Imprint |
| **经验记忆** | ❌ 无 | ✅ EchoStore（Episodic Memory） |
| **能力画像** | ❌ 无（只有静态配置） | ✅ Capability Profile（含盲点） |
| **经验蒸馏** | ❌ 无 | ✅ SpiritForge → MindCodex |
| **进化阶** | ❌ 无 | ✅ E1-E6 Evolution Stage |
| **觉醒阶** | ❌ 无 | ✅ E1-E6 Awakening Stage |
| **多智能体议事** | ❌ 无 | ✅ Mind Council |
| **行为决定因素** | Prompt + 工具集 + 配置 | Prompt + 能力画像 + 经验记忆 + 觉醒阶自主范围 |
| **跨会话能力积累** | ❌ 无 | ✅ 通过 EchoStore + MindCodex 实现 |
| **典型示例** | DeclarativeAgent、Claude Code Adapter | 猫头鹰·鲁班（架构师）、猎犬·夏洛克（开发者）、孔雀·梵高（评审员） |
| **代码基类** | `StaticAgent` / `DeclarativeAgent` | `ForgekinBase` |

### 2.4 智能体分类使用规范

1. **FlowForge 默认指代**：在 FlowForge 上下文中提到"智能体"而未加修饰时，默认指代**可进化智能体（Forgekin）**
2. **静态智能体必须显式标注**：若指代静态智能体，必须明确说出"静态智能体"或"Static Agent"
3. **外部接入智能体归类**：通过 ExternalAgentAdapter 接入的第三方 Agent（Claude Code / Codex / OpenCode / Trae 等）统称为"外部接入静态智能体"
4. **FlowForge 内置静态智能体归类**：DeclarativeAgent / ReAct Agent / Plan-Execute Agent 等传统 Agent 统称为"FlowForge 内置静态智能体"
5. **可进化智能体别名使用**：在社区社交中可使用"灵智体"作为可进化智能体的别名，但首次出现时必须双标注（如"灵智体（Forgekin / Evolvable Agent）"）

---

## 3. 12 个核心概念命名表（Twelve Core Concepts）

> 以下 12 个概念是 FlowForge v7.1 体系的最小必要词汇集。所有文档、代码、UI、API 必须严格使用本表命名。
> **优先级**：P0 官方名称 > P1 项目英文名 > P2 体系别名（仅社交）

### 3.1 ForgeMind（灵智，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Persistent Identity Agent / General-Purpose Agent Framework（持续身份智能体 / 通用智能体框架） |
| **项目英文名（P1）** | ForgeMind |
| **体系别名（P2，仅社交）** | 灵智 |
| **含义** | FlowForge 项目的最终形态主名。指整套自进化框架对外的统一品牌。它不是一个 agent 实例，而是"可进化智能体锻造厂"的总称。 |
| **使用场景** | 文档、UI、对外宣传、README、VISION.md |
| **代码用法** | 不直接用作类名，作为命名空间前缀（如 `ForgeMindPlugin`、`flowforge/forgemind/`） |
| **废弃旧名** | E6 灵匠 Mind Artisan（v4.0 过渡命名，已废弃） |

### 3.2 Forgekin（灵智体，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Evolvable Agent / Autonomous Agent with Persistent Identity / Self-Evolving Agent（可进化智能体 / 持久身份自主智能体 / 自进化智能体） |
| **项目英文名（P1）** | Forgekin |
| **体系别名（P2，仅社交）** | 灵智体 |
| **含义** | 具备自进化能力的智能体。它建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证。具有持久身份（Soul Imprint）+ 经验记忆（EchoStore）+ 能力画像（Capability Profile）+ 进化阶 + 觉醒阶。详见 §2.2。 |
| **使用场景** | 文档、代码、API、配置 |
| **代码用法** | 类名前缀：`ForgekinBase`、`ForgekinEngine`、`ForgekinSpecies` |
| **关联 Feature** | `[doc:features/F026-all-things-spirit-base.md]` |
| **废弃旧名** | 炉灵 Forgekin（v4.0 命名，"炉"字不通俗） |

### 3.3 Forgekin Species（灵族，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Agent Morphology / Agent Form Factor（智能体形态学 / 形态因子） |
| **项目英文名（P1）** | ForgekinSpecies |
| **体系别名（P2，仅社交）** | 灵族 |
| **含义** | 可进化智能体的五大形态分类：生物（BioForgekin）/ 组织（OrgForgekin）/ 物品（ObjForgekin）/ 虚拟（VirtualForgekin）/ 混合（HybridForgekin）。形态决定智能体的物理接入方式和虚拟设定层。 |
| **使用场景** | forgemind 应用层、形态进化流程 |
| **代码用法** | 枚举类：`ForgekinSpecies.BIO`、`ForgekinSpecies.ORG` 等 |
| **关联 Feature** | `[doc:features/F027-all-things-spirit-species.md]` |

### 3.4 Forge Nurturing（育灵，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Agent Onboarding + Lifelong Learning + Character Development（智能体入职 + 终身学习 + 角色养成） |
| **项目英文名（P1）** | Forge Nurturing |
| **体系别名（P2，仅社交）** | 育灵 |
| **含义** | 可进化智能体从无到有、从弱到强的锻造过程。包括：初始化身份 → 加载基础能力 → 实战任务 → 经验蒸馏 → 形态进化。 |
| **使用场景** | forgemind 锻造流水线、智能体市场、进化谱系 |
| **代码用法** | 模块名：`flowforge/forgemind/forging/`、配置：`forging.yaml` |
| **废弃旧名** | 养灵（v4.0，"养"字过于随意） |

### 3.5 EchoStore（灵忆，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Episodic Memory Store / Agent Experience Log（情景记忆存储 / 智能体经验日志） |
| **项目英文名（P1）** | EchoStore |
| **体系别名（P2，仅社交）** | 灵忆 |
| **含义** | 可进化智能体的经验记忆库，存储每次任务的轨迹、决策、结果、反馈。是经验蒸馏（SpiritForge）的原料。 |
| **使用场景** | 代码、记忆联邦、Eval 信号采集 |
| **代码用法** | 类名：`EchoStore`、模块：`flowforge/core/memory/echo_store.py` |
| **关联 Feature** | `[doc:features/F014-memory-collection.md]` |
| **废弃旧名** | 魂忆（v4.0/v7.0，"魂"字过于玄学，v7.1 统一改为"灵忆"） |

### 3.6 Soul Imprint（灵印，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Persistent Identity / Agent Fingerprint / Persona Hash（持久身份 / 智能体指纹 / 人格哈希） |
| **项目英文名（P1）** | SoulImprint |
| **体系别名（P2，仅社交）** | 灵印 |
| **含义** | 可进化智能体的不可变身份标识，由初始锻造时的种子参数 + 价值锚点 + 命名空间组成。即使能力进化、形态升级，Soul Imprint 保持不变，是谱系追踪的锚点。 |
| **使用场景** | 代码、谱系追踪、跨 session 身份验证 |
| **代码用法** | 字段：`forgekin.soul_imprint`、模块：`flowforge/core/identity/soul_imprint.py` |
| **关联 Feature** | `[doc:features/F038-forgemind-lineage.md]` |
| **废弃旧名** | 魂印（v4.0/v7.0，"魂"字过于玄学，v7.1 统一改为"灵印"） |

### 3.7 SpiritForge（灵锻，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Experience Distillation / Offline Policy Learning / Knowledge Compilation（经验蒸馏 / 离线策略学习 / 知识编译） |
| **项目英文名（P1）** | SpiritForge |
| **体系别名（P2，仅社交）** | 灵锻 |
| **含义** | 在低活动期将 EchoStore 中的任务经验蒸馏到 MindCodex 的过程。蒸馏产出可检索的知识条目，供下次任务直接复用，达成"模型不变但能力增长"。 |
| **使用场景** | 代码、Phase 6 蒸馏引擎 |
| **代码用法** | 模块：`flowforge/forgemind/codex/spirit_forge.py` |
| **废弃旧名** | 自锻（v4.0，"自"字暗示自主性过强） |
| **关联 Feature** | Phase 6 P6-1 |

### 3.8 MindCodex（灵典，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Distilled Knowledge Base / Curated Skill Library / Procedural Memory（蒸馏知识库 / 策展技能库 / 程序性记忆） |
| **项目英文名（P1）** | MindCodex |
| **体系别名（P2，仅社交）** | 灵典 |
| **含义** | SpiritForge 蒸馏产出的可检索知识库。每个条目包含：经验摘要、适用场景、反模式、调用入口。区别于 EchoStore（原始日志），MindCodex 是结构化、可检索、可复用的蒸馏产物。 |
| **使用场景** | 代码、多域记忆联邦、可进化智能体能力扩展 |
| **代码用法** | 模块：`flowforge/core/memory/mind_codex.py`、`flowforge/forgemind/codex/` |
| **关联 Feature** | `[doc:features/F039-mind-codex-searchable.md]` |

### 3.9 MindCouncil（灵议，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Multi-Agent Deliberation / Decentralized Consensus / Agent Parliament（多智能体议事 / 去中心化共识 / 智能体议会） |
| **项目英文名（P1）** | MindCouncil |
| **体系别名（P2，仅社交）** | 灵议 |
| **含义** | 多可进化智能体议事机制，用于解决跨智能体冲突、复杂决策、愿景方向校准。任何可进化智能体可发起 MindCouncil，主持智能体收集各方立场 + 能力画像盲点，跨厂商 review 后达成共识或升级给 operator。 |
| **使用场景** | Phase 6 MindCouncil 引擎、跨可进化智能体协作 |
| **代码用法** | 模块：`flowforge/forgemind/council/`、类名：`MindCouncil` |
| **关联 Feature** | Phase 6 P6-2 |

### 3.10 Evolution Stage（进化阶，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Capability Maturity Level / Agent Skill Progression（能力成熟度等级 / 智能体技能进阶） |
| **项目英文名（P1）** | EvolutionStage |
| **体系别名（P2，仅社交）** | 进化阶 |
| **含义** | 可进化智能体能力成熟度的 6 级进阶体系（E1-E6），衡量智能体可执行任务的复杂度和领域广度。详见 §4。 |
| **使用场景** | forgemind 应用层、智能体市场、谱系追踪 |
| **代码用法** | 枚举：`EvolutionStage.E1` ~ `EvolutionStage.E6` |
| **废弃旧名** | 火种（v4.0，"火种"语义模糊） |

### 3.11 Awakening Stage（觉醒阶，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Autonomy Level / Self-Direction Level / LLM Autonomy Tier（自主性等级 / 自导向等级 / LLM 自主性分级） |
| **项目英文名（P1）** | AwakeningStage |
| **体系别名（P2，仅社交）** | 觉醒阶 |
| **含义** | 可进化智能体自主性和自我导向能力的 6 级进阶体系（E1-E6），衡量智能体在没有 operator 干预下的决策范围。详见 §5。 |
| **使用场景** | forgemind 应用层、自我演进安全治理、Magic Words 逃生舱 |
| **代码用法** | 枚举：`AwakeningStage.E1` ~ `AwakeningStage.E6` |
| **废弃旧名** | 升华阶（v4.0，"升华"过于虚幻） |

### 3.12 Capability Profile（能力画像，仅社交用别名）

| 属性 | 值 |
|------|---|
| **官方名称（P0）** | Capability Profile / Agent Skill Graph / Blind Spot Map（能力画像 / 智能体技能图 / 盲点图） |
| **项目英文名（P1）** | CapabilityProfile |
| **体系别名（P2，仅社交）** | 能力画像 |
| **含义** | 可进化智能体的长期能力主体（区别于 role 这个运行时标签）。包含：原生能力（模型固有能力）+ 认知风格 + 工具边界 + 历史表现 + 坏直觉 + 当前状态。画像必须同时写"必杀技"和"致命弱点"——盲点决定谁该 review 谁。 |
| **使用场景** | 代码、动态路由、跨厂商 review 配对、能力画像融合 |
| **代码用法** | 类：`CapabilityProfile`、模块：`flowforge/core/capability/` |
| **来源** | `[doc:roleagent.md#第0章]` 能力画像 × Harness 契合度公式 |
| **关联 Feature** | `[doc:features/F001-capability-profile.md]` |

---

## 4. Evolution Stage（进化阶）详细定义

> 可进化智能体能力成熟度的 6 级进阶体系。借鉴 CMMI 5 级 + roleagent.md 能力 × Harness 公式 + OpenAI Autonomy Levels 的设计思想。
> **官方名称**：Capability Maturity Level（能力成熟度等级）

| 阶 | 官方名称（P0） | 项目英文名（P1） | 体系别名（P2，仅社交） | 能力描述 | 触发条件 |
|:--:|----------------|------------------|----------------------|----------|---------|
| **E1** | Initial / Ad-hoc（初始级 / 临时级） | Sprout | 萌芽阶 | 单一任务可执行，无跨域能力。需 operator 全程指导。 | 可进化智能体创建后默认阶 |
| **E2** | Repeatable（可重复级） | Sprout-Stable | 萌芽阶·稳 | 同类任务可稳定复用，开始积累 EchoStore。 | 完成 5+ 同类任务且 Eval ≥ 0.85 |
| **E3** | Defined / Domain-Aware（已定义级 / 领域感知） | Growth | 成长阶 | 在特定 Species 内可跨任务执行，可调用三方 Agent 扩展能力。 | SpiritForge 蒸馏出 3+ MindCodex 条目 + 三方 Agent 调用成功 |
| **E4** | Managed / Cross-Domain（已管理级 / 跨域） | Growth-Deep | 成长阶·深 | 可跨 Species 协作（如 BioForgekin 与 OrgForgekin 协作），进入 Evolving 状态（自我导向）。 | 跨 Species 协作 3+ 任务 + 觉醒阶 ≥ E3 |
| **E5** | Optimizing / Self-Evolving（优化级 / 自进化） | Awakened | 觉醒阶 | 可主动发现能力缺口并通过 SpiritForge 自补；可发起 MindCouncil。 | 主动发起 1+ MindCouncil + 自补 3+ MindCodex 条目 |
| **E6** | Master / Forge Master（大师级 / 锻造大师） | ForgeMind | 灵智阶 | 可锻造新的可进化智能体（"造 agent"），达成 operator "养万物"愿景。 | operator 直接授权 |

**进化阶规则**：
- E1→E2→E3 是能力积累，由 Eval 信号自动触发
- E3→E4 是跨域能力，需 operator 确认
- E4→E5 进入 Evolving 状态，需 operator 确认 + 觉醒阶同步 ≥ E3
- E5→E6 仅由 operator 直接授权，不可自动触发

---

## 5. Awakening Stage（觉醒阶）详细定义

> 可进化智能体自主性和自我导向能力的 6 级进阶体系。借鉴 SAE 自动驾驶 5 级 + OpenAI Agent Autonomy Level + Anthropic Constitutional AI 的设计思想。
> **官方名称**：Autonomy Level（自主性等级）

| 阶 | 官方名称（P0） | 项目英文名（P1） | 体系别名（P2，仅社交） | 自主范围 | operator 介入 |
|:--:|----------------|------------------|----------------------|---------|---------------|
| **E1** | L0 Full Human Control / Manual（全人工） | Full-Human | 全导阶 | 可进化智能体仅执行明确指令，无自主决策。 | 每步操作 |
| **E2** | L1 Suggestion / Assisted（建议级 / 辅助） | Suggest | 建议阶 | 可进化智能体可提供建议，但需 operator 确认后执行。 | 每个建议确认 |
| **E3** | L2 Bounded Autonomous / Conditional（受限自主 / 条件自主） | Bounded-Autonomous | 受限自主阶 | 在 operator 预设的边界内可自主决策（如 tool allow-list、cost ceiling）。 | 边界违规时介入 |
| **E4** | L3 Evolving / Self-Improving（自进化 / 自改进） | Evolving | Evolving 阶 | 可进化智能体可自主优化自身能力（如重构 harness、补 MindCodex），但不可修改 VISION §7。 | 仅在 Magic Words 触发时介入 |
| **E5** | L4 Co-Creative / Peer（共创级 / 平级协作） | Co-Creative | 共创阶 | 可进化智能体可作为 operator 的平级协作者，可提议 VISION 修订（但需 operator 批准）。 | 愿景变更需批准 |
| **E6** | L5 ForgeMind-Led / Master（灵智主导级 / 大师级） | ForgeMind-Led | 灵智主导阶 | 仅在 operator 直接授权的特定领域（如锻造新可进化智能体）可主导。 | 跨领域仍需批准 |

**觉醒阶规则**：
- E1→E2→E3 是自主范围扩大，由 operator 显式授权
- E3→E4 进入 Evolving 状态（自我导向），是关键转折点，需 operator 显式批准 + 进化阶同步 ≥ E4
- E4→E5→E6 逐步让渡控制权，但 VISION §7 始终不可被可进化智能体修改
- Magic Words 逃生舱始终可触发（任何阶都不能绕过）

**安全治理对应**：
- 觉醒阶 E1-E2：六层 Guardrails 全开
- 觉醒阶 E3-E4：六层 Guardrails + Eval 自代谢
- 觉醒阶 E5-E6：六层 Guardrails + Eval 自代谢 + MindCouncil 共识 + operator 拉闸词

---

## 6. 废弃命名清单（Deprecation Registry）

> 旧名保留作为历史索引，新文档/代码不可使用。已在 `[doc:decisions/012-naming-fusion.md]` 决策废弃。
> **重要**：废弃命名仅作为历史索引保留在本文件中，**不可出现在正式文档的正文内容中**——如需说明命名变迁，请放到 `_archive/` 或 `_process/` 目录的过程文档中。

| 废弃命名 | 替换为 | 废弃原因 | 废弃日期 |
|---------|--------|---------|---------|
| E6 灵匠 Mind Artisan | ForgeMind（Persistent Identity Agent Framework） | operator 直接决策，"匠"字过于工匠化 | 2026-07-17 |
| 炉灵 Forgekin | Forgekin（Evolvable Agent） | "炉"字对 B 端不通俗 | 2026-07-17 |
| 养灵 | Forge Nurturing（Agent Onboarding + Lifelong Learning） | "养"字过于随意 | 2026-07-17 |
| 自锻 | SpiritForge（Experience Distillation） | "自"字暗示自主性过强 | 2026-07-17 |
| 火种 | EvolutionStage（Capability Maturity Level） | "火种"语义模糊 | 2026-07-17 |
| 升华阶 | AwakeningStage（Autonomy Level） | "升华"过于虚幻 | 2026-07-17 |
| M18 SelfEvolutionEngine | ForgeMindEngine | v4.0 自创术语，与 v7.0 FR-EVO 冲突 | 2026-07-17 |
| M19 MemoryGovernanceManager | （映射到 M1-M17 + 觉醒阶治理） | v4.0 自创术语 | 2026-07-17 |
| M20 FirstTouchRouter | （映射到 M1-M17 + 能力画像路由） | v4.0 自创术语 | 2026-07-17 |
| 魂忆（旧义） | EchoStore（Episodic Memory Store） | "魂"字过于玄学，v7.1 统一改为"灵忆" | 2026-07-18 |
| 魂印（旧义） | SoulImprint（Persistent Identity） | "魂"字过于玄学，v7.1 统一改为"灵印" | 2026-07-18 |
| AGI | General-Purpose Agent（通用智能体） | AGI 短期不可实现且定义模糊 | 2026-07-17 |
| 物理 AI 真实复现 | Embodied AI Engineering（具身智能工程实现） | "真实复现"过于虚幻 | 2026-07-17 |
| 虚拟 AI 真实复现 | Character AI Engineering（虚拟角色智能体工程实现） | "真实复现"过于虚幻 | 2026-07-17 |

---

## 7. 术语使用场景矩阵

| 术语类别 | 技术设计文档（spec/arch/design） | 代码（类名/变量/API） | 对外宣传（README/VISION） | 社区社交（博客/讨论） |
|---------|-------------------------------|---------------------|------------------------|---------------------|
| **P0 官方名称** | ✅ 大量使用（首选） | ✅ 注释中使用 | ✅ 大量使用（首选） | ✅ 首次出现时标注 |
| **P1 项目英文名** | ✅ 与 P0 并列使用 | ✅ 作为标识符 | ✅ 与 P0 并列使用 | ✅ 可使用 |
| **P2 体系别名** | ⚠️ 仅在专门说明时使用，首次必须双标注 | ❌ 严禁作为标识符 | ⚠️ 仅在品牌名时使用，首次必须双标注 | ✅ 可大量使用 |

### 7.1 正式文档首次出现标注规范

**正确示例**（P0 优先，P2 双标注）：
```
可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"灵智体"）通过
经验蒸馏（SpiritForge，社区社交称"灵锻"）将情景记忆（Episodic Memory，
存储于 EchoStore）转化为可检索的程序性记忆（Procedural Memory，存于 MindCodex）。
```

**错误示例**（P2 别名优先，违反官方名称优先原则）：
```
灵智体通过灵锻将灵忆蒸馏到锻典中。
（违反：正式文档中 P2 别名大量出现且未标注 P0 官方名称）
```

### 7.2 社区社交使用规范

**正确示例**（P2 别名 + P0 首次双标注）：
```
今天我们来聊聊 FlowForge 的灵智体（Forgekin / Evolvable Agent）——
这是一种具备自进化能力的智能体。它通过灵锻（SpiritForge）把灵忆
（EchoStore / Episodic Memory）蒸馏成灵典（MindCodex / Procedural Memory）。
```

---

## 8. 命名使用规范

### 8.1 文档使用

- **首次出现**：P0 官方名称（P1 项目英文名，P2 体系别名仅社交用），如"可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称'灵智体'）"
- **后续引用**：P0 官方名称或 P1 项目英文名任一即可，保持上下文一致
- **跨文档引用**：使用 `[doc:design/naming-contract.md#章节]` 引用本文件对应章节

### 8.2 代码使用

```python
# 类名：使用 P1 项目英文名（Forgekin / ForgeMind 前缀）
class ForgekinBase: ...           # 可进化智能体基类
class ForgeMindEngine: ...        # 可进化智能体引擎（原 SelfEvolutionEngine）
class ForgekinSpecies(Enum): ...  # 智能体形态分类
class EvolutionStage(Enum): ...   # 进化阶 E1-E6
class AwakeningStage(Enum): ...   # 觉醒阶 E1-E6
class StaticAgent: ...            # 静态智能体基类
class DeclarativeAgent: ...       # 声明式静态智能体
class ExternalAgentAdapter: ...   # 外部接入静态智能体适配器

# 模块名：使用 P1 项目英文名
flowforge/forgemind/              # 应用层
flowforge/core/forgekin/          # 核心层可进化智能体能力
flowforge/core/capability/        # 能力画像
flowforge/core/memory/echo_store.py  # Episodic Memory Store
flowforge/core/identity/soul_imprint.py  # Persistent Identity
flowforge/core/external_agent/    # 外部接入静态智能体适配层

# 配置 YAML：使用 P1 项目英文名
species: bio                      # Agent Morphology
evolution_stage: E3               # Capability Maturity Level
awakening_stage: E2               # Autonomy Level
agent_type: forgekin              # 可进化智能体（forgekin）或静态智能体（static）
```

### 8.3 UI 使用

- 中文界面：使用 P0 官方名称为主，必要时附 P2 体系别名（如"可进化智能体（灵智体）"、"经验蒸馏（灵锻）"）
- 英文界面：使用 P0 官方名称或 P1 项目英文名（如"Create Forgekin"、"Forge Nurturing Pipeline"、"Mind Council"）
- 不在 UI 中暴露过长的 P0 概念解释（如不显示"Autonomous Agent with Persistent Identity"），仅在文档中说明

---

## 9. 命名冲突解决

### 9.1 冲突类型

| 冲突类型 | 解决规则 |
|---------|---------|
| 文档 vs 代码 | 代码为准，文档同步更新 |
| 旧文档 vs 新文档 | 新文档为准，旧文档归档到 _archive/ |
| v4.0 术语 vs v7.1 术语 | v7.1 为准，v4.0 术语废弃 |
| 第三方术语（如 clowder-ai） | 保留原术语，本文件定义映射关系 |
| P0 vs P2 冲突 | P0 官方名称优先，P2 别名仅社交用 |

### 9.2 与 clowder-ai 的术语映射

| clowder-ai 术语 | FlowForge 术语（P0 官方名称） | 项目英文名（P1） | 映射关系 |
|----------------|----------------------------|----------------|---------|
| Cat（猫） | Evolvable Agent | Forgekin | 范式扩展：猫 → 万物 |
| Cat Café | Agent Onboarding Platform | forgemind | 应用层映射 |
| Breed（品种） | Agent Morphology | ForgekinSpecies | 形态分类映射 |
| Cat Profile | Capability Profile | CapabilityProfile | 直接映射 |
| Cat Memory | Episodic Memory Store | EchoStore | 经验记忆映射 |
| Pack System | Multi-Agent Deliberation | MindCouncil | 多智能体协作映射 |

---

## 10. 引用

- `[doc:decisions/012-naming-fusion.md]` — 命名融合 ADR（决策源）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物可进化智能体愿景 ADR
- `[doc:VISION.md]` — 万物可进化智能体愿景声明
- `[doc:roleagent.md#第0章]` — 能力画像工程路径
- `[doc:roleagent.md#第7章]` — 伙伴系统数学
- `[hiclaw/rules.md#12.2]` — 术语规范方法论（官方名称优先原则）
- `[doc:project_rules.md#红线11]` — 禁止硬编码

---

## 11. 变更历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-07-17 | 初版：12 核心概念命名表 + 进化阶 E1-E6 + 觉醒阶 E1-E6 + 废弃清单 + 使用规范 | Trae CN（agent） |
| v1.1 | 2026-07-18 | operator 指令修订：魂忆→灵忆、魂印→灵印（"魂"字过于玄学，统一改为"灵"字）；废弃清单同步更新；§2.5/§2.6 增加废弃旧名行 | Trae CN（agent） |
| v2.0 | 2026-07-19 | **operator 指令全面重构**：确立"官方名称优先"原则（P0/P1/P2 三层命名体系，AI 业界专业术语为正式名称，体系别名仅社交用）；新增 §2 智能体分类（静态智能体 Static Agent vs 可进化智能体 Evolvable Agent / Forgekin，含对比矩阵和使用规范）；§3 12 核心概念表全面重写为 P0 优先格式；新增 §7 术语使用场景矩阵；新增 §7.1/§7.2 正式文档/社区社交标注规范示例；进化阶/觉醒阶表格加入 P0 官方名称列 | Trae CN（agent） |
