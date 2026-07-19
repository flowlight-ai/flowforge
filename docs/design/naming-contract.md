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
| **行为决定因素** | Prompt + 工具集 + 配置 | Prompt + 能力画像 + 经验记忆 +