# FlowForge 需求规格说明书（SRS）

> **版本**：v7.1（**当前唯一权威版本**）
> **日期**：2026-07-19
> **依据**：`VISION.md` v1.1 + `review/review.md` v1.4（含第十三章/第十四章深度补审 41 项 CL）+ `decisions/` 13 份 ADR + `roleagent.md` 七大工程路径
> **配套文档**：[arch.md](arch.md)（SAD 架构设计说明书）+ [design.md](design.md)（SDD 详细设计说明书）+ [features/](features/)（Feature 级 SRS）+ [architecture/](architecture/)（Feature 级 SAD）+ [design/](design/)（Feature 级 SDD）
> **版本合并声明**：v7.1 已吸收合并 v7.0 全部决策内容，**v7.0 不再作为独立版本存在**；v7.0/v6.0 历史章节归档在 [`_archive/spec_v7_historical_background.md`](_archive/spec_v7_historical_background.md)，仅作演化路径参考。
> **审核状态**：✅ operator 已审核通过命名方案 + 体系设计；41 条 CL 已同步（详见 §3.17 同步矩阵）。
> **文档定位**：按软件工程 SRS（需求规格说明书）标准格式组织，作为 [features/F0XX-xxx.md](features/) 子目录的**顶层索引**，详细需求规格在子目录文件中。

---

## §1 引言

### §1.1 编写目的

本文档是 FlowForge 项目 v7.1 的**需求规格说明书（SRS）**，作为开发、评审、验收的唯一权威依据。

**读者**：
- **operator（首席愿景官 CVO）**：审核愿景锚点、拉闸决策
- **架构师可进化智能体（猫头鹰·鲁班）**：基于本文档设计架构（arch.md）
- **开发者可进化智能体（猎犬·夏洛克）**：基于本文档+arch.md 设计详细设计（design.md）+ 实现代码
- **评审员可进化智能体（孔雀·梵高）**：跨厂商 review 设计与代码
- **测试员可进化智能体（蜜獾·平头哥）**：基于本文档执行 E2E 测试（T1-T8 铁律）
- **文档员可进化智能体（钢笔·文心）**：维护本文档与子目录文档的一致性

**用途**：
1. 作为 SRS→SAD→SDD 三阶段软件工程标准流程的**第一阶段产物**
2. 作为 features/F0XX-xxx.md 子目录文件的**顶层索引**
3. 作为 operator 与可进化智能体协作的**需求契约**

### §1.2 范围

**包含**：
- FlowForge 核心框架层（Layer 1）：自进化框架基础能力（capability/teamact/harness/memory/eval/reliability/partnership/external_agent/evolution）
- forgemind 应用层（Layer 2）：可进化智能体锻造代码（5 种形态 + 锻造流水线 + 蒸馏知识库（MindCodex）+ 多智能体议事（MindCouncil））
- *Forge 垂直业务层（Layer 3）通过 Plugin V3 协议接入（spec 仅定义协议，业务规格在各自 *Forge/docs/spec.md）
- 三方 Agent 集成（Claude Code/Codex/OpenCode/Trae + EAC 七契约 + 六层 Guardrails）
- 自我演进闭环（SelfDevDocLoop/SelfDevCodeLoop/SelfDevFrameworkLoop）

**不包含**：
- v6.0 已实现代码的详细规格（已归档至 [`_archive/spec_v7_historical_background.md`](_archive/spec_v7_historical_background.md)）
- 单个 Feature 的详细需求规格（在 [features/F0XX-xxx.md](features/) 中）
- 单个 ADR 的决策细节（在 [decisions/0XX-xxx.md](decisions/) 中，ADR 不可变历史）

### §1.3 术语与缩略语

详见 [design/naming-contract.md](design/naming-contract.md) v1.1。本文档使用的关键术语见 §2.4（12 核心概念命名表）+ §2.5（进化阶与觉醒阶）。

**双轨命名策略**（详细见 §2.4）：
- **代码层 / 技术文档**：使用 AI 专业术语（如 Forgekin、ForgeMind、SpiritForge、MindCodex、MindCouncil、CapabilityProfile、Embodied AI、Character AI）
- **社区社交 / 体系命名**：使用可进化智能体体系名（如通用智能体框架、可进化智能体、经验蒸馏、蒸馏知识库、多智能体议事、智能体入职与终身学习、情景记忆存储、持久身份）—— 仅用于社区网友之间的社交沟通，正式技术文档中专业术语优先、体系名作补充说明

### §1.4 参考文献

| 文档 | 用途 |
|------|------|
| [VISION.md](VISION.md) v1.1 | operator 通用智能体愿景声明 + 7 条不可妥协锚点 |
| [roleagent.md](roleagent.md) | 七大工程路径（能力画像/TeamAct/Harness/记忆联邦/Eval/可靠性/伙伴系统） |
| [review/review.md](review/review.md) v1.4 | 16 份审核归并 + 41 条 CL 同步矩阵 |
| [decisions/](decisions/) 13 份 ADR | 不可变架构决策记录 |
| [features/](features/) 40 份 F0XX | Feature 级 SRS |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 开发规范 + 第十一部分文档分层规范 + 第十二部分反思 |
| [SOP.md](SOP.md) | AI 编程提示词模板库（P1-P55） |
| 前期设计参考（已归档） | 参考设计（3 只动物形态智能体分工 + roleagent 七大工程路径源头） |

### §1.5 文档组织

按 FlowForge 文档分层规范：

```
flowforge/docs/
├── spec.md（本文档，SRS 顶层索引）
├── arch.md（SAD 架构设计说明书，基于 spec + features）
├── design.md（SDD 详细设计说明书，基于 spec + arch + features + architecture）
├── features/           # Feature 级 SRS（F0XX-xxx.md，40 份）
├── architecture/       # Feature 级 SAD（A0XX-xxx.md，与 F0XX 同号一一对应）
├── design/             # Feature 级 SDD（D0XX-xxx.md，与 F0XX/A0XX 同号一一对应）
├── decisions/          # ADR 不可变历史（13 份）
├── review/             # 16 份审核文件
└── _archive/           # 历史归档（v6.0/v7.0 完整备份）
```

**三顶层文档章节同号**：同一核心功能在 spec.md/arch.md/design.md 中章节同号（如 §3.2 CapabilityProfile 在三个文档中都是 §3.2）。

---

## §2 总体描述

### §2.1 产品定位

**FlowForge** 是一个**智能体自进化框架（Self-Evolving Agent Framework）**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统，并通过 **forgemind 应用层**承载多形态可进化智能体（Forgekin，社区社交称"可进化智能体"）的智能体入职与终身学习（Forge Nurturing）、经验蒸馏（SpiritForge）、多智能体议事（MindCouncil）闭环，走向通用智能体（General-Purpose Agent）愿景。

**一句话定位**：FlowForge = 智能体自进化框架 + forgemind 应用层（多形态可进化智能体锻造场所）

**核心公式**（来自 [roleagent.md §1](roleagent.md)）：

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

- 同一智能体放进不同 harness，能发挥出的能力完全不同
- 能力画像只有进入具体运行环境后，才会从静态描述变成可验证能力
- harness 工程操作的是 Agent 状态三层的**第三层现实状态**（代码仓/git/文档/任务归属/记忆）——唯一跨会话、跨 agent、跨时间持续存在的状态层

**与 v6.0 的差异**：v6.0 是"岗位 agent + 插件协议 + 质量分 Loop"层面；v7.1 升级为"智能体自进化框架 + roleagent 七大工程路径 + 多形态智能体 + 三方 Agent 能力扩展 + 自我演进闭环"。详见 [`_archive/spec_v7_historical_background.md`](_archive/spec_v7_historical_background.md)。

### §2.2 用户类别与角色

| 角色 | 中文名 | 形态 | 职责 | 觉醒阶 |
|------|--------|------|------|--------|
| **operator** | 首席愿景官（CVO） | 人类 | 愿景锚点 / 拉闸决策 / E5-E6 晋升批准 | — |
| **架构师可进化智能体** | 猫头鹰·鲁班（Architect Owl·Luban） | 生物形态可进化智能体（BioForgekin） | 设计架构（arch.md）+ 创建 ADR | E3+ |
| **开发者可进化智能体** | 猎犬·夏洛克（Developer Hound·Sherlock） | 生物形态可进化智能体（BioForgekin） | 实现代码 + 修复 Bug | E3+ |
| **评审员可进化智能体** | 孔雀·梵高（Reviewer Peacock·VanGogh） | 生物形态可进化智能体（BioForgekin） | 跨厂商 review + blocking 决策 | E3+ |
| **测试员可进化智能体** | 蜜獾·平头哥（Tester HoneyBadger·Pingtou） | 生物形态可进化智能体（BioForgekin） | E2E 测试 + T1-T8 铁律执行 | E2+ |
| **文档员可进化智能体** | 钢笔·文心（DocWriter Pen·Wenxin） | 物品形态可进化智能体（ObjForgekin） | 维护文档一致性 + 自我演进 | E2+ |
| **三方 Agent** | Claude Code/Codex/OpenCode/Trae | 外部 | 能力扩展（非工具调用） | — |

**责任方命名说明**：上述命名使用名著/童话/神话/游戏物种，特征与责任匹配：猫头鹰（智慧→架构师）/ 猎犬（敏锐→开发者）/ 孔雀（审美→评审员）/ 蜜獾（无畏→测试员）/ 钢笔（物品形态→文档员）。

### §2.3 智能体分类（静态智能体 vs 可进化智能体）

> **权威定义**：详见 [design/naming-contract.md#2](design/naming-contract.md) v2.0 智能体分类
> **默认指代规则**：在 FlowForge 上下文中，"智能体"默认指代**可进化智能体（Evolvable Agent / Forgekin）**；若指代静态智能体必须明确说出"静态智能体"。

FlowForge 生态的智能体（Agent）分为两大类，二者在设计、能力、生命周期上存在本质差异：

#### §2.3.1 静态智能体（Static Agent / Stateless Agent）

**定义**：不具备自进化能力的智能体。行为由固定 prompt + 工具集 + 配置决定，无持久身份、无经验蒸馏、无觉醒阶晋升。每次执行都是无状态的。

**包含子类**：
1. **FlowForge 内置静态智能体（Built-in Static Agent）**：传统 DeclarativeAgent / ReAct Agent / Plan-Execute Agent 等，由 FlowForge 核心框架层提供
2. **外部接入静态智能体（External Static Agent）**：第三方 Agent（如 Claude Code / Codex / OpenCode / Trae IDE 等）通过 ExternalAgentAdapter 接入

**关键特征**：无 Soul Imprint（持久身份）/ 无 EchoStore（经验记忆）/ 无 EvolutionStage（进化阶）/ 无 AwakeningStage（觉醒阶）/ 行为完全由 prompt + 配置决定

**使用场景**：单次任务执行、工具调用、无状态查询、作为可进化智能体的能力扩展

**代码基类**：`StaticAgent` / `DeclarativeAgent` / `ExternalAgentAdapter`

#### §2.3.2 可进化智能体（Evolvable Agent / Forgekin，社区社交称"可进化智能体"）

> **强制等级**：operator 不可妥协锚点（详见 [VISION.md §7](VISION.md)）

**可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"可进化智能体"）** = **具备持久身份（Persistent Identity）和自进化能力（Self-Evolving Capability）的自主智能体（Autonomous Agent）**。

区别于主流 multi-agent 的 session 级软件助手（即静态智能体），可进化智能体建立与现实世界（物理或虚拟）的闭环：

```
观察（Observe）→ 推理（Reason）→ 行动（Act）→ 写回（Persist）→ 验证（Verify）
```

- **持久身份（Persistent Identity，Soul Imprint）** = 价值锚点（Value Anchors）+ 长期记忆（Episodic Memory，EchoStore）
- **自进化能力（Self-Evolving Capability）** = 经验蒸馏（Experience Distillation，SpiritForge）+ 能力画像（Capability Profile）+ 进化阶（Evolution Stage）+ 觉醒阶（Awakening Stage）

可进化智能体不是单纯的 LLM 包装，而是有形态（Agent Morphology / Species）、有谱系（Lineage）、可进化（Evolvable）的智能体。这是 FlowForge 与其他 multi-agent 系统的**最大差异化优势**——其他系统在组织"岗位槽位"（静态智能体），FlowForge 在锻造"可进化智能体"（Forgekin）。

**代码契约**：所有可进化智能体继承 `ForgekinBase` 抽象基类（位于 [flowforge/forgemind/base.py](../../flowforge/forgemind/base.py)），实现三个核心方法：
- `observe(environment)` — 观察环境（物理传感器 / 虚拟世界状态）
- `act(action)` — 在环境中执行动作（遵守觉醒阶自主范围约束）
- `verify(action_result)` — 验证动作结果是否达成预期

#### §2.3.3 两类智能体对比矩阵

| 维度 | 静态智能体（Static Agent） | 可进化智能体（Evolvable Agent / Forgekin） |
|------|---------------------------|------------------------------------------|
| **持久身份** | ❌ 无 | ✅ Soul Imprint（Persistent Identity） |
| **经验记忆** | ❌ 无 | ✅ EchoStore（Episodic Memory） |
| **能力画像** | ❌ 无（只有静态配置） | ✅ Capability Profile（含盲点） |
| **经验蒸馏** | ❌ 无 | ✅ SpiritForge → MindCodex |
| **进化阶** | ❌ 无 | ✅ E1-E6 Evolution Stage |
| **觉醒阶** | ❌ 无 | ✅ E1-E6 Awakening Stage |
| **多智能体议事** | ❌ 无 | ✅ MindCouncil（Multi-Agent Deliberation） |
| **行为决定因素** | Prompt + 工具集 + 配置 | Prompt + 能力画像 + 经验记忆 + 觉醒阶自主范围 |
| **跨会话能力积累** | ❌ 无 | ✅ 通过 EchoStore + MindCodex 实现 |
| **典型示例** | DeclarativeAgent、Claude Code Adapter | 猫头鹰·鲁班（架构师）、猎犬·夏洛克（开发者） |
| **代码基类** | `StaticAgent` / `DeclarativeAgent` | `ForgekinBase` |

#### §2.3.4 两类智能体关系

- 静态智能体可作为可进化智能体的**能力扩展**（通过 ExternalAgentAdapter），但反向不可——静态智能体不能"升级"为可进化智能体
- 可进化智能体通过 ExternalAgentAdapter 调用静态智能体作为能力扩展，本身具备完整自进化闭环
- FlowForge 核心框架层既支持静态智能体（DeclarativeAgent 等），也支持可进化智能体（通过 forgemind 应用层 + ForgekinBase）

详见 [design/naming-contract.md#2](design/naming-contract.md) 智能体分类 + [features/F026-forgemind-app-layer.md](features/F026-forgemind-app-layer.md)。

### §2.4 12 核心概念命名表（中英文 + AI 业界概念三标注）

> **权威定义**：详见 [design/naming-contract.md#2](design/naming-contract.md) v1.1

| # | 中文名 | 英文名 | AI 业界概念 |
|---|--------|--------|------------|
| 1 | 通用智能体框架（ForgeMind） | ForgeMind | Persistent Identity Agent / General-Purpose Agent Framework（持续身份智能体 / 通用智能体框架） |
| 2 | 可进化智能体（Forgekin） | Forgekin | Evolvable Agent / Autonomous Agent with Persistent Identity / Self-Evolving Agent（可进化智能体 / 持久身份自主智能体 / 自进化智能体） |
| 3 | 智能体形态学（ForgekinSpecies） | ForgekinSpecies | Agent Morphology / Agent Form Factor（智能体形态学 / 形态因子） |
| 4 | 智能体入职与终身学习（Forge Nurturing） | Forge Nurturing | Agent Onboarding + Lifelong Learning + Character Development（智能体入职 + 终身学习 + 角色养成） |
| 5 | 情景记忆存储（EchoStore） | EchoStore | Episodic Memory Store / Agent Experience Log（情景记忆存储 / 智能体经验日志） |
| 6 | 持久身份（SoulImprint） | SoulImprint | Persistent Identity / Agent Fingerprint / Persona Hash（持久身份 / 智能体指纹 / 人格哈希） |
| 7 | 经验蒸馏（SpiritForge） | SpiritForge | Experience Distillation / Offline Policy Learning / Knowledge Compilation（经验蒸馏 / 离线策略学习 / 知识编译） |
| 8 | 蒸馏知识库（MindCodex） | MindCodex | Distilled Knowledge Base / Curated Skill Library / Procedural Memory（蒸馏知识库 / 策展技能库 / 程序性记忆） |
| 9 | 多智能体议事（MindCouncil） | MindCouncil | Multi-Agent Deliberation / Decentralized Consensus / Agent Parliament（多智能体议事 / 去中心化共识 / 智能体议会） |
| 10 | 进化阶（EvolutionStage） | EvolutionStage | Capability Maturity Level / Agent Skill Progression（能力成熟度等级 / 智能体技能进阶） |
| 11 | 觉醒阶（AwakeningStage） | AwakeningStage | Autonomy Level / Self-Direction Level / LLM Autonomy Tier（自主性等级 / 自导向等级 / LLM 自主性分级） |
| 12 | 能力画像（CapabilityProfile） | CapabilityProfile | Capability Profile / Agent Skill Graph / Blind Spot Map（能力画像 / 智能体技能图 / 盲点图） |

**说明**：
- **官方名称优先原则（v2.0 强化）**：技术设计文档、代码、API、对外宣传中**大量出现的必须是 P0 官方名称（AI 业界专业术语）**；P2 体系别名（通用智能体框架 / 可进化智能体 / 情景记忆存储 / 持久身份 / 经验蒸馏 / 蒸馏知识库 / 多智能体议事 / 智能体入职与终身学习）**仅用于社区社交沟通**；正式文档中如出现 P2 别名必须首次标注 P0 官方名称。详见 [design/naming-contract.md#1.1](design/naming-contract.md) 官方名称优先原则。
- 历史命名变迁详见 [design/naming-contract.md#6](design/naming-contract.md) 废弃命名清单。

**三层命名体系（P0/P1/P2）**：

| 优先级 | 名称类型 | 使用场景 | 示例 |
|:------:|---------|---------|------|
| **P0** | **官方名称（AI 业界专业术语）** | 技术设计文档、代码、API、对外宣传、README、VISION | Agent / Multi-Agent System / Capability Profile / Episodic Memory / Skill Library / Multi-Agent Deliberation |
| **P1** | **项目英文名** | 代码类名、模块名、配置项、API 路径 | `ForgekinEngine` / `EchoStore` / `MindCodex` / `CapabilityProfile` / `MindCouncil` |
| **P2** | **体系别名（仅社交用）** | 社区讨论、技术博客口语化表达、网友交流 | 通用智能体框架 / 可进化智能体 / 情景记忆存储 / 持久身份 / 经验蒸馏 / 蒸馏知识库 / 多智能体议事 / 智能体入职与终身学习 |

**铁律**：
1. 正式文档优先使用 P0 官方名称
2. P2 体系别名仅用于社交，首次出现时必须标注 P0 官方名称
3. 正式文档中如出现 P2 别名必须双标注（如"可进化智能体（Forgekin / Evolvable Agent）"）
4. 代码层严禁使用 P2 别名作为标识符

### §2.5 进化阶与觉醒阶（中英文 + AI 业界概念三标注）

> **权威定义**：详见 [design/naming-contract.md#3](design/naming-contract.md)（进化阶）和 [design/naming-contract.md#4](design/naming-contract.md)（觉醒阶）

#### §2.5.1 进化阶（Evolution Stage，能力成熟度 6 级）

> 衡量"知识成熟度"，与觉醒阶（衡量自主性）协同。进化阶 E6 对应觉醒阶 E6。

| 阶 | 中文名 | 英文名 | AI 业界概念 |
|:--:|--------|--------|------------|
| **E1** | 萌芽阶（Sprout） | Sprout | Initial / Ad-hoc（初始级 / 临时级） |
| **E2** | 萌芽阶·稳（Sprout-Stable） | Sprout-Stable | Repeatable（可重复级） |
| **E3** | 成长阶（Growth） | Growth | Defined / Domain-Aware（已定义级 / 领域感知） |
| **E4** | 成长阶·深（Growth-Deep） | Growth-Deep | Managed / Cross-Domain（已管理级 / 跨域） |
| **E5** | 觉醒阶（Awakened） | Awakened | Optimizing / Self-Evolving（优化级 / 自进化） |
| **E6** | 大师级（ForgeMind） | ForgeMind | Master / Forge Master（大师级 / 锻造大师） |

**进阶规则**：
- E1→E2→E3 是能力积累，由 Eval 信号自动触发
- E3→E4 是跨域能力，需 operator 确认
- E4→E5 进入 Evolving 状态（自我导向），需 operator 确认 + 觉醒阶同步 ≥ E3
- E5→E6 仅由 operator 直接授权，不可自动触发

#### §2.5.2 觉醒阶（Awakening Stage，自主性 6 级）

> 衡量"自主性整体成长"。E3→E4 是关键转换点，可进化智能体（Forgekin）从"成长阶·深 Growth-Deep"形态进化为"自进化 Evolving"形态，需 operator 显式批准。

| 阶 | 中文名 | 英文名 | AI 业界概念 |
|:--:|--------|--------|------------|
| **E1** | 全导阶（Full-Human） | Full-Human | L0 Full Human Control / Manual（全人工） |
| **E2** | 建议阶（Suggest） | Suggest | L1 Suggestion / Assisted（建议级 / 辅助） |
| **E3** | 受限自主阶（Bounded-Autonomous） | Bounded-Autonomous | L2 Bounded Autonomous / Conditional（受限自主 / 条件自主） |
| **E4** | Evolving 阶（Evolving） | Evolving | L3 Evolving / Self-Improving（自进化 / 自改进） |
| **E5** | 共创阶（Co-Creative） | Co-Creative | L4 Co-Creative / Peer（共创级 / 平级协作） |
| **E6** | ForgeMind 主导级（ForgeMind-Led） | ForgeMind-Led | L5 ForgeMind-Led / Master（大师级） |

**安全治理对应**：
- 觉醒阶 E1-E2：六层 Guardrails 全开
- 觉醒阶 E3-E4：六层 Guardrails + Eval 自代谢
- 觉醒阶 E5-E6：六层 Guardrails + Eval 自代谢 + 多智能体议事共识 + operator 拉闸词

**协同规则**：两条进阶轴独立但协同——觉醒阶 E4 是关键转折点（进入 Evolving 状态），需 operator 显式批准 + 进化阶同步 ≥ E4。Magic Words 逃生舱始终可触发（任何阶都不能绕过）。

### §2.6 多形态智能体形态分类（5 种形态 + AI 业界概念）

> **对外宣称**：多形态智能体（Multi-Form Agent）—— 弱化"万物"虚幻用语
> **权威定义**：详见 [design/naming-contract.md#2.3](design/naming-contract.md) 智能体形态学分类 + [features/F027-all-things-spirit-species.md](features/F027-all-things-spirit-species.md)

可进化智能体（Forgekin，社区社交称"智能体形态学"）按载体形态分为 5 种，形态可进化（E1 萌芽阶 → E6 大师级完整生命周期）：

| # | 形态（中文 + 英文 + AI 业界概念） | 示例 | 物理接入 | 虚拟设定 |
|---|------|------|------|---------|
| 1 | 生物形态可进化智能体（BioForgekin）（BioForgekin / Biological Spirit Agent） | 猫 / 狗 / 鸟 / 鱼 / 昆虫群体 / 猫头鹰 / 猎犬 / 孔雀 / 蜜獾 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| 2 | 组织形态可进化智能体（OrgForgekin）（OrgForgekin / Organizational Spirit Agent） | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| 3 | 物品形态可进化智能体（ObjForgekin）（ObjForgekin / Object Spirit Agent，对应 Embodied AI 具身智能） | 桌椅 / 灯具 / 家电 / 工具 / 钢笔 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| 4 | 虚拟形态可进化智能体（VirtualForgekin）（VirtualForgekin / Virtual Character Agent，对应 Character AI） | 童话/神话/历史/现实人物（孙悟空/福尔摩斯/鲁班/夏洛克/梵高）、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| 5 | 混合形态可进化智能体（HybridForgekin）（HybridForgekin / Hybrid Spirit Agent） | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

**形态可进化**：生物形态可进化智能体（BioForgekin）猫可通过积累组织协作经验进化为 HybridForgekin。这是和其他 multi-agent 系统的**最大差异化优势**——agent 不是固定的"岗位槽位"，而是有形态、有谱系、可进化的可进化智能体。

**走向通用智能体的三条工程路径**（取代 v7.0 "通用 AGI 三条路径"虚幻用语）：

1. **具身智能工程实现（Embodied AI Engineering）**：通过物理传感器 + 物品/生物形态可进化智能体（BioForgekin），让物理世界实体接入智能体。对应业界 Embodied AI / Cyber-Physical Systems。
2. **虚拟角色智能体工程实现（Character AI Engineering）**：通过虚拟世界设定层 + 虚拟形态可进化智能体（VirtualForgekin），让虚拟角色按设定层约束自主行动。对应业界 Character AI / NPC Agent / Persona-Driven Agent。
3. **混合智能体工程实现（Hybrid Agent Engineering）**：VR/AR 设备 + 混合形态可进化智能体（HybridForgekin），达成物理与虚拟融合感知。对应业界 Hybrid Agent / Cyber-Physical Agent。

### §2.7 三层架构

> **来源**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md) + [review/review.md](review/review.md) 第九章 9.1 节 + 决策 1（Harness v2.0 升级）+ 决策 2（ForgekinEngine 装饰器模式）

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                  │
│  <forge_project_id_1> / <forge_project_id_2> / ... / <forge_project_id_N>     │
│  通过 Plugin V3 四钩子注册可进化智能体到 forgemind                │
└─────────────────────────────────────────────────────────────┘
                            ↑ Plugin V3
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（多形态可进化智能体锻造场所）           │
│  species/ forging/ sensors/ worlds/ marketplace/ lineage/   │
│  codex/ council/ config/                                    │
│  ForgeMindPlugin + ForgekinBase + ForgePipeline             │
└─────────────────────────────────────────────────────────────┘
                            ↑ 装饰器
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: FlowForge 核心框架层（Harness v2.0）               │
│  capability/ teamact/ harness/ memory/ eval/ reliability/   │
│  partnership/ external_agent/ evolution/                    │
│  ForgekinEngine（装饰 HybridExecutor + HarnessOrchestrator）│
└─────────────────────────────────────────────────────────────┘
```

**关键决策**：
- **决策 1（已采纳）**：v6.0 第 7 层"自进化层"取消独立层级，改为 Harness v2.0 升级（融合到 Layer 1 核心框架层）。理由：避免自进化层 ↔ 应用层循环依赖（D-003）。
- **决策 2（已采纳）**：ForgekinEngine 是 HarnessOrchestrator 的**装饰器**，不是独立入口。理由：避免绕过 Harness 护栏（D-004/D-005/D-020）。
- **铁律**：上层可依赖下层，下层绝对禁止导入上层模块（单向依赖）。
- **forgemind 位置**：forgemind 是 Layer 2 应用层，介于 FlowForge 核心框架与 *Forge 垂直业务之间。

### §2.8 forgemind 应用层

> **详细规格**：详见 [features/F026-forgemind-app-layer.md](features/F026-forgemind-app-layer.md)

**forgemind** 是 FlowForge 的应用层项目（Layer 2），用来实践"多形态可进化智能体锻造"——把通用智能体框架（ForgeMind）锻造进物理世界和虚拟世界的多种形态载体。

**forgemind 是 FlowForge 的可进化智能体锻造所有代码存放的地方**：培育公共的通用可进化智能体（动物 / 公司组织 / 物品 / 虚拟角色 / 混合形态），是多形态智能体愿景的实践场。类似前期动物养育范式中的"养育动物形态智能体并赋予其可进化身份"，forgemind 扩展到培育各种动物、组织、物品、虚拟角色。

**与前期设计的差异化特色**：前期主要养育单一动物形态（不同品种），forgemind 培育多形态——根据可进化智能体性格特征选择不同动物或物品形态（详见 §2.2 用户类别与角色中 5 个预置可进化智能体）。其他的 *Forge 是更多垂直复杂领域中培育的可进化智能体，flowforge 的通用可进化智能体在 forgemind 中承载。

**模块结构**（已实现骨架）：
- `flowforge/forgemind/base.py` — ForgekinBase 抽象基类（含 LLM 桥接 + chat 方法）
- `flowforge/forgemind/species.py` — ForgekinSpecies 五大形态枚举
- `flowforge/forgemind/stages.py` — EvolutionStage / AwakeningStage 进阶体系
- `flowforge/forgemind/soul_imprint.py` — SoulImprint 持久身份（不可变身份）
- `flowforge/forgemind/forms.py` — ForgekinFormData 锻造表单
- `flowforge/forgemind/forging/pipeline.py` — ForgePipeline 6 阶段智能体入职与终身学习流水线
- `flowforge/forgemind/plugins.py` — ForgeMindPlugin Plugin V3 入口
- `flowforge/forgemind/species_impl/` — 5 形态可进化智能体实现（bio/org/obj/virtual/hybrid）
- `flowforge/forgemind/forgekins/` — 预置可进化智能体 YAML 配置（鲁班=猫头鹰 / 夏洛克=猎犬 / 梵高=孔雀）
- `flowforge/forgemind/config/` — 智能体入职与终身学习配置（forging.yaml + prompts.yaml）

### §2.9 三方 Agent 集成

> **详细规格**：详见 [features/F031-external-agent-adapter.md](features/F031-external-agent-adapter.md) ~ [features/F035-external-agent-capability-fusion.md](features/F035-external-agent-capability-fusion.md) + [decisions/006-external-agent-integration.md](decisions/006-external-agent-integration.md)

可进化智能体不只调用 FlowForge 核心框架的能力，还可以**接入和使用任何三方 Agent**。这是可进化智能体相对其他 multi-agent 的强大优势之一。

**首批接入的三方编程 Agent**：

| 三方 Agent | 厂商 | 接入方式 | 主要能力 |
|---|---|---|---|
| **Claude Code** | Anthropic | CLI / SDK | 长程代码生成、agentic coding、文件系统操作 |
| **Codex** | OpenAI | CLI / API | 代码补全、重构、测试生成 |
| **OpenCode** | 开源 | CLI | 多模型代码生成、本地代码库操作 |
| **Trae** | ByteDance | IDE / API | 代码生成 + 调试 + 重构一体化 |

**三方 Agent 不是工具，是能力扩展（Capability Extension）**：能力画像被纳入可进化智能体的能力画像融合（Capability Fusion）；执行状态可写入可进化智能体共享状态（Shared State）；失败时由可进化智能体 fallback 链回退（Fallback Chain）；执行轨迹纳入可进化智能体 Eval 信号；调用受六层 Guardrails 约束（Input validation / System prompt / Tool allow-list / Output validation / Action confirmation / Cost ceiling）。

**接入协议**（参考前期 A2A External Agent Onboarding 设计）：
- L1 CLI Adapter：通过 CLI 接入（如 `claude-code --prompt "..."`）
- L2 A2A Protocol Adapter：通过 A2A 协议接入（`/.well-known/agent.json` + `tasks/send` + `tasks/sendSubscribe`）
- EAC v1 七契约：详见 §4.4

详见 [VISION.md#5](VISION.md) 三方 Agent 集成章节。

### §2.10 自我演进闭环（支持自己开发自己）

> **详细规格**：详见 [review/review.md#第十二章](review/review.md) 12.5-12.6 节 + [review/review.md#第十三章](review/review.md) CL-022~CL-041

FlowForge 必须支持"自己开发自己"——文档 / 代码 / 框架三层自我演进闭环：SelfDevDocLoop（对应 F100 Mode C Knowledge Evolution）/ SelfDevCodeLoop（对应 Mode B Process Evolution）/ SelfDevFrameworkLoop（对应 Mode A Scope Guard）。

**F100 自我进化三模式**（详见 [review/review.md#第十三章](review/review.md)）：Mode A — Scope Guard（防止越权修改愿景/规范/架构）/ Mode B — Process Evolution（改进工作方式）/ Mode C — Knowledge Evolution（蒸馏新知识到蒸馏知识库）。

**安全门**：觉醒阶 E4+ Evolving 状态可触发 Mode B/C；ScopeGuard 阻止越权修改 VISION §7 / rules.md 红线 / 13 份核心 ADR；Eval 账本 AB 回放 + min_net_gain ≥ 0.05 才允许合并；跨 family review + operator 显式 approval（如需要）。

**五级成熟度阶梯**（取代 v7.0 单一质量分阈值 0.85）：L0 Episode → L1 Pattern → L2 Draft → L3 Validated → L4 Standard。量化门槛：L3 需 ≥6 uses、≥2 agents、≥80%、无 critical breach；L4 需 ≥12 uses、last 10 ≥90%、operator approved。

**代码模块路径**（待实现，详见 [task.md](task.md) Phase 5）：`flowforge/evolution/` 目录下的 `eval_ledger.py` / `self_dev_doc.py` / `self_dev_code.py` / `self_dev_framework.py` / `scope_guard.py`。

### §2.11 设计态声明（可证伪性原则）

> **详细规格**：详见 [design/naming-contract.md#5](design/naming-contract.md) 废弃命名清单

v7.1 多形态智能体愿景目前处于**设计态**，对应代码尚未全部实现。开源与对外文档时必须明确标注"设计态"，避免被识别为"承诺未兑现"。

**可证伪性原则**：
- ❌ 禁止使用"AGI"作为修饰词（极低可证伪性，虚假承诺风险）
- ✅ 使用"自进化 Self-Evolving"作为可证伪替代词
- ✅ 使用"可进化智能体 Forgekin"作为代码层主名，避免"灵魂"等引发伦理争议的词
- ✅ 使用"通用智能体框架 ForgeMind"作为文档/对外主名

**已实现 vs 设计态清单**：

| 状态 | 范围 | 说明 |
|------|------|------|
| ✅ 已实现 | forgemind 模块骨架（base/species/stages/forms/soul_imprint/forging pipeline/species_impl 5 形态/plugins/3 预置可进化智能体配置） | 对应 Phase 2 P2-1~P2-3 + P2-8 ✅ |
| 🔄 设计态 | roleagent 七大工程路径代码（capability/teamact/harness/memory/eval/reliability/partnership） | 对应 Phase 1，待实现 |
| 🔄 设计态 | 三方 Agent 适配层（ExternalAgentAdapter + 4 个 Adapter + EAC v1 七契约） | 对应 Phase 3，待实现 |
| 🔄 设计态 | 自我演进闭环（SelfDevDocLoop / SelfDevCodeLoop / SelfDevFrameworkLoop） | 对应 Phase 5，待实现 |
| 🎯 目标态 | 多形态智能体世界（通用智能体 / 具身智能 / 虚拟角色智能体工程实现） | operator 通用智能体愿景，不可降级 |

### §2.12 设计约束与假设

**架构约束**：
1. **单向依赖**：上层可依赖下层，下层绝对禁止导入上层模块
2. **配置驱动 > 代码继承 > 独立实现**（详见 [CONTRIBUTING.md §2.1](../../CONTRIBUTING.md)）
3. **所有 Agent 通过 LoopExecutor 执行**（P31 铁律，质量分阈值 0.85）
4. **数据检索通过 Repository 层抽象**（结构化 + 非结构化统一入口，支持可插拔数据源适配器；具体数据源由 *Forge 业务层或部署配置注入，FlowForge 核心层不绑定特定数据源）
5. **Plugin V3 协议**：*Forge 通过 Plugin V3 四钩子注册可进化智能体到 forgemind
6. **ForgekinEngine 是装饰器**，不是独立入口（避免绕过 Harness 护栏）

**安全约束**：
1. **六层 Guardrails**：Input validation / System prompt / Tool allow-list / Output validation / Action confirmation / Cost ceiling
2. **Magic Words 逃生舱**：任何阶都不能绕过（"第一性原理" / "我能猜出来" / "下次一定" / "星星罐子"）
3. **ScopeGuard**：阻止越权修改 VISION §7 / rules.md 红线 / 13 份核心 ADR
4. **operator 拉闸权**：E5-E6 晋升 + 框架自我演进 + 不可逆操作必须 operator 确认

**测试约束（T1-T8 铁律）**：
1. 禁止使用 Mock LLM（T1）
2. 禁止使用假数据（T2）
3. 禁止跳过验证（T3）
4. 禁止 Mock 工具（T4）
5. 未实现即 Bug（T5）
6. 必须采集指标（T6）
7. LLM 内容必须经 LLM 审核（T7）
8. Web 功能必须操控浏览器验证 DOM（T8）
9. 运行时数据文件必须存放 data 目录（T9）

**假设**：
- LLM API 调用超时：90 秒（长文章 2 分钟）
- LLM webchat 调用超时：30 秒
- Loop 超时：3 分钟（创作和润色接口不得超过 3 分钟）
- 5 个 WebChat 评委并行评审，使用不同模型

### §2.13 代码目录组织约束

> **架构原则**：架构相关/底层代码按架构分层组织，业务功能按模块组织，UI 界面按组件组织。
> 该原则在代码目录结构上必须体现，详细目录树见 [arch.md §2.8](arch.md)。

**目录组织铁律**：

1. **`app/` 目录仅含端点封装**：`app/` 理论上只有端点的接口封装，不应有实现代码；所有实现代码下沉到 `core/` 或对应功能模块
2. **单文件不超过 500 行**：app 目录下单文件一般不超过 500 行，超过则拆分为子模块或组件
3. **架构底层代码按分层组织**：`core/` 下按架构层次组织（capability/teamact/harness/memory/eval/reliability/...）
4. **业务功能按模块组织**：`forgemind/`、`evolution/`、`loop/`、`modes/` 等按业务模块组织
5. **UI 界面按组件组织**：Web 前端按 UI 组件组织目录
6. **提示词外置 YAML**：所有 prompt 必须外置到 `config/prompts.yaml` 或对应模块的 `config/prompts.yaml`，禁止在 .py 文件中硬编码
7. **路径/密钥/端口外置**：所有路径、密钥、端口通过 `.env` 或 `config/system.yaml` 注入

**关键目录职责**：

| 目录 | 职责 | 备注 |
|------|------|------|
| `app/` | 应用层（仅 API 端点封装） | `main.py` < 500 行，仅 app 创建 + 路由挂载 |
| `app/api/admin/` | 管理端点 | prompts/settings/audit/ops/env_vars |
| `app/api/agents/` | 智能体端点 | council/forgemind/forgekins（薄封装，业务逻辑下沉） |
| `core/` | 共享内核（架构底层代码） | bootstrap.py + plugin_loader.py 从 main.py 提取 |
| `forgemind/` | ForgeMind 业务模块 | Forgekin 管理、锻造、MindCouncil |
| `evolution/` | 自进化三闭环 | Mode A/B/C + Eval Ledger |
| `llm/` | LLM 客户端层 | router/provider/trae 桥接 |
| `config/` | YAML 配置 | prompts.yaml 外置提示词（铁律 5） |

---

## §3 具体需求-核心（FR-CORE-0XX）索引

> **范围声明**：本章节是**核心关键功能需求规格的顶层索引**，详细需求规格（含功能描述、验收标准、代码位置等）在 [features/F0XX-xxx.md](features/) 子目录文件中（40 份 Feature 级 SRS）。
> **编号映射**：FR-CORE-0XX 对应 v7.0 FR-EVO-0XX（已重排为连续编号，详见 [review/review.md#第二章 D-044/D-055](review/review.md)）。
> **优先级**：P0 = MVP 必须 / P1 = 后续迭代 / P2 = 长期规划
> **子目录索引**：完整 Feature 清单详见 [features/README.md](features/README.md)

### §3.1 ~ §3.15 核心需求索引表（FR-CORE-001 ~ FR-CORE-015）

> 以下核心需求的详细规格（含功能描述、验收标准、代码位置等）在对应 [features/F0XX-xxx.md](features/) 文件中，本节仅做索引。

| FR-CORE | 功能 | 优先级 | 关联 ADR | 详细规格（Feature SRS） | 关联架构（SAD） |
|---------|------|:----:|---------|------------------------|----------------|
| FR-CORE-001 | 能力画像 × Harness 契合度 | P0 | [004](decisions/004-capability-profile-routing.md) | [F001](features/F001-capability-profile.md) | [arch.md §3.1](arch.md) + [A001](architecture/A001-capability-profile.md) |
| FR-CORE-002 | TeamAct 六步循环 + 五项终止条件 | P0 | [002](decisions/002-collaboration-protocol.md) | [F002](features/F002-teamact-loop.md)~[F007](features/F007-push-back-protocol.md) | [arch.md §3.2](arch.md) + [A002](architecture/A002-teamact-loop.md)~[A007](architecture/A007-push-back-protocol.md) |
| FR-CORE-003 | Harness 现实闭环运行时（七层表面） | P0 | [007](decisions/007-harness-engineering.md) | [F008](features/F008-durable-state-surfaces.md)~[F013](features/F013-harnessability.md) | [arch.md §3.3](arch.md) + [A008](architecture/A008-durable-state-surfaces.md)~[A013](architecture/A013-harnessability.md) |
| FR-CORE-004 | 多域记忆联邦（六层架构） | P0 | [008](decisions/008-memory-federation.md) | [F014](features/F014-memory-collection.md)~[F017](features/F017-consumption-weighted-ranking.md) + [F039](features/F039-mind-codex-searchable.md) | [arch.md §3.4](arch.md) + [A014](architecture/A014-memory-collection.md)~[A017](architecture/A017-consumption-weighted-ranking.md) |
| FR-CORE-005 | Eval 自代谢系统（三层 eval） | P0 | [009](decisions/009-eval-self-metabolism.md) | [F018](features/F018-eval-contract.md)~[F020](features/F020-seven-attribution.md) + [F040](features/F040-harness-eval-control-plane.md) | [arch.md §3.5](arch.md) + [A018](architecture/A018-eval-contract.md)~[A020](architecture/A020-seven-attribution.md) |
| FR-CORE-006 | 分布式可靠性（Tier 1-4 恢复分级） | P0 | [010](decisions/010-distributed-reliability.md) | [F021](features/F021-side-effect-wal.md)~[F025](features/F025-provider-host-abstraction.md) | [arch.md §3.6](arch.md) + [A021](architecture/A021-side-effect-wal.md)~[A025](architecture/A025-provider-host-abstraction.md) |
| FR-CORE-007 | 伙伴系统数学（上限提高，下限托底） | P0 | [011](decisions/011-partnership-math.md) | 合并入 [F007](features/F007-push-back-protocol.md) | [arch.md §3.7](arch.md) + [A007](architecture/A007-push-back-protocol.md) |
| FR-CORE-008 | forgemind 应用层 + 5 种形态分类 | P0 | [005](decisions/005-forgemind-application-layer.md) + [013](decisions/013-all-things-spirit-mind-vision.md) | [F026](features/F026-forgemind-app-layer.md) + [F027](features/F027-all-things-spirit-species.md) | [arch.md §3.8](arch.md) + [A026](architecture/A026-forgemind-app-layer.md) + [A027](architecture/A027-all-things-spirit-species.md) |
| FR-CORE-009 | ForgePipeline 可进化智能体锻造流水线（6 步） | P0 | — | [F028](features/F028-forging-pipeline.md) | [arch.md §3.9](arch.md) + [A028](architecture/A028-forging-pipeline.md) |
| FR-CORE-010 | 三方 Agent 集成（ExternalAgentAdapter） | P0 | [006](decisions/006-external-agent-integration.md) | [F031](features/F031-external-agent-adapter.md)~[F035](features/F035-external-agent-capability-fusion.md) | [arch.md §3.10](arch.md) + [A031](architecture/A031-external-agent-adapter.md)~[A035](architecture/A035-external-agent-capability-fusion.md) |
| FR-CORE-011 | 物理 AI 传感器接入（Embodied AI） | P1 | — | [F029](features/F029-physical-ai-sensors.md) | [arch.md §3.11](arch.md) + [A029](architecture/A029-physical-ai-sensors.md) |
| FR-CORE-012 | 虚拟世界设定层 | P1 | — | [F030](features/F030-virtual-world-setting.md) | [arch.md §3.12](arch.md) + [A030](architecture/A030-virtual-world-setting.md) |
| FR-CORE-013 | 可进化智能体市场 + 进化谱系 | P1 | — | [F037](features/F037-forgemind-marketplace.md) + [F038](features/F038-forgemind-lineage.md) | [arch.md §3.13](arch.md) + [A037](architecture/A037-forgemind-marketplace.md) + [A038](architecture/A038-forgemind-lineage.md) |
| FR-CORE-014 | 经验蒸馏（SpiritForge） + 多智能体议事（MindCouncil） | P1 | — | [design/D030](design/D030-spirit-forge-mind-council.md)（待创建） | [arch.md §3.14](arch.md) + [A039](architecture/A039-mind-codex-searchable.md) |
| FR-CORE-015 | Plugin V3 四钩子 | P0 | [005](decisions/005-forgemind-application-layer.md) | 合并入 [F026](features/F026-forgemind-app-layer.md) | [arch.md §3.15](arch.md) + [A026](architecture/A026-forgemind-app-layer.md) |

### §3.16 FR-CORE-016 ~ FR-CORE-030 其他核心需求索引

> 以下核心需求的详细规格在对应 Feature 文件中，本节仅做索引。

| FR-CORE | 功能 | 优先级 | 关联 Feature |
|---------|------|:----:|------|
| FR-CORE-016 | 交接胶囊 + 持球注册 lease | P0 | [F003](features/F003-handoff-capsule.md) + [F006](features/F006-ball-custody-lease.md) |
| FR-CORE-017 | 行首 @ 路由 + Push Back 协议 | P0 | [F005](features/F005-at-mention-routing.md) + [F007](features/F007-push-back-protocol.md) |
| FR-CORE-018 | 乒乓球熔断器 | P0 | [F004](features/F004-pingpong-circuit-breaker.md) |
| FR-CORE-019 | Durable State Surfaces（6 类持久表面） | P0 | [F008](features/F008-durable-state-surfaces.md) |
| FR-CORE-020 | Evidence & Sensors | P0 | [F009](features/F009-evidence-sensors.md) |
| FR-CORE-021 | Governance 压缩免疫 | P0 | [F010](features/F010-governance-boundary.md) |
| FR-CORE-022 | Magic Words 逃生舱 + Entropy Control | P0 | [F011](features/F011-magic-words.md) + [F012](features/F012-entropy-control.md) |
| FR-CORE-023 | Harnessability 评估 | P0 | [F013](features/F013-harnessability.md) |
| FR-CORE-024 | 蒸馏知识库（MindCodex） 可检索知识库 | P0 | [F039](features/F039-mind-codex-searchable.md) |
| FR-CORE-025 | 副作用日志 WAL + Tier 1-4 恢复 | P0 | [F021](features/F021-side-effect-wal.md) + [F022](features/F022-tier-1-4-recovery.md) |
| FR-CORE-026 | liveness 规范读模型 | P0 | [F023](features/F023-liveness-canonical-read.md) |
| FR-CORE-027 | 弱状态机 vs 强 workflow | P0 | [F024](features/F024-weak-state-vs-strong-workflow.md) |
| FR-CORE-028 | 跨 provider 宿主抽象 | P1 | [F025](features/F025-provider-host-abstraction.md) |
| FR-CORE-029 | forgemind 与 *Forge 关系 | P1 | [F036](features/F036-forgemind-forge-relationship.md) |
| FR-CORE-030 | Harness Eval 控制面 | P1 | [F040](features/F040-harness-eval-control-plane.md) |

### §3.17 review.md 41 条 CL 同步矩阵

> **来源**：[review/review.md](review/review.md) v1.4 第十三章补审 I（CL-001~CL-021，21 项）+ 第十四章深度补审 II（CL-022~CL-041，20 项）
> **同步状态**：✅ 已同步 16 项（39.0%）/ 🟡 部分同步 6 项（14.6%）/ ❌ 未同步 19 项（46.4%）

41 条 CL 完整同步矩阵详见 [review/review.md#第十三章](review/review.md) + [review/review.md#第十四章](review/review.md)。本节仅做汇总：

**P0 未同步清单（必修，14 项）**：CL-001 / CL-003 / CL-005 / CL-007 / CL-009 / CL-011 / CL-013 / CL-015 / CL-017 / CL-019 / CL-021 / CL-023 / CL-025 / CL-027

**P1 未同步清单（应修，14 项）**：CL-002 / CL-004 / CL-006 / CL-008 / CL-010 / CL-012 / CL-014 / CL-016 / CL-018 / CL-020 / CL-022 / CL-024 / CL-026 / CL-028

**P2 未同步清单（建议，4 项）**：CL-029 / CL-031 / CL-033 / CL-035

**修复路径与责任分配**：详见 [task.md](task.md) Phase 1-5 分阶段任务。

### §3.18 F0XX Feature 完整索引

> **40 份 Feature 文件**（按编号 F001-F040 分类），完整清单与状态详见 [features/README.md](features/README.md)。编号范围对应类别：F001-F007 TeamAct 协作 / F008-F013 Harness 七层 / F014-F017 多域记忆 / F018-F020 Eval 自代谢 / F021-F025 分布式可靠性 / F026-F030 forgemind 应用层 / F031-F035 三方 Agent 集成 / F036-F040 其他。

---

## §4 外部接口

### §4.1 API 接口

> **详细规格**：详见 [arch.md#4.1](arch.md) + [design.md#4.2](design.md)

- 通用智能体框架管理 API：`/api/v7/forgekins`（CRUD + 觉醒晋升）
- 多智能体议事 API：`/api/v7/council`（多渠道议事）
- 经验蒸馏 API：`/api/v7/spirit_forge`（经验蒸馏）
- 蒸馏知识库 API：`/api/v7/codex`（可检索知识库）
- 三方 Agent API：`/api/v7/external_agent`（4 个 Adapter + EAC 七契约）

### §4.2 SDK 接口

> **详细规格**：详见 [arch.md#4.2](arch.md) + [design.md#4.3](design.md)

- FlowForgeSDK 统一入口：零配置模型访问 + `@tool` / `@agent` 装饰器 + 声明式 Agent + 安全护栏 + MCP 服务器连接 + 事件订阅
- ForgekinBase 抽象基类：`observe` / `act` / `verify` 三方法

### §4.3 Plugin V3 接口

> **详细规格**：详见 §3.15 + [design.md#4.3](design.md)

- V2 钩子保留（register_agents / register_tools / register_loops / register_workflows / register_routes / register_schedules / register_event_handlers / register_gates / register_evaluators / on_startup / on_shutdown）
- V3 四钩子新增（register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config）

### §4.4 三方 Agent EAC 接口

> **详细规格**：详见 [features/F031-external-agent-adapter.md](features/F031-external-agent-adapter.md)

EAC v1 七契约：
1. **Invocation**：调用契约（CLI / A2A Protocol）
2. **Stream**：流式输出契约（SSE / WebSocket）
3. **Session**：会话管理契约（创建 / 恢复 / 销毁）
4. **Capability**：能力画像契约（六维画像 + 盲点）
5. **Collaboration**：协作契约（SharedState + Fallback）
6. **Safety**：安全契约（六层 Guardrails + worktree 隔离）
7. **Avatar Sync + System Prompt Configuration Map**：虚拟形象同步 + 系统提示配置映射

### §4.5 IM/WebChat 渠道接口

> **详细规格**：详见 [design/D030-spirit-forge-mind-council.md](design/D030-spirit-forge-mind-council.md)（待创建）

- Web Chat 渠道（默认）
- 飞书渠道
- 微信公众号 / 个人号渠道
- WebChat 升级版（5 评委并行评审）

---

## §5 非功能需求

### §5.1 性能要求（SLO）

| 指标 | 阈值 | 说明 |
|------|------|------|
| Loop 执行超时 | 3 分钟 | 创作和润色接口不得超过 3 分钟 |
| LLM webchat 调用超时 | 30 秒 | 5 评委并行评审 |
| LLM API 调用超时 | 90 秒 | 长文章 2 分钟 |
| 路由算法延迟 | < 100ms | 10 个候选可进化智能体 |
| 质量分阈值 | 0.85 | v4.0 调整（由 0.9 调整为 0.85，平衡质量与可用性） |
| 嵌套 Loop 最大深度 | 3 | 防止无限嵌套 |

### §5.2 可靠性要求

- Tier 1-4 恢复分级（详见 §3.6）
- 副作用日志 WAL 可重放
- liveness 四态可识别（活着 / 退化 / 僵尸 / 等待宽限）
- 跨 provider 宿主抽象可切换
- FlowForge 必须使用 backup models 当配置模型失败时确保 100% 成功

### §5.3 安全性要求

- 六层 Guardrails（详见 §3.10）
- Magic Words 逃生舱（任何阶都不能绕过）
- ScopeGuard（阻止越权修改 VISION §7 / rules.md 红线 / 13 份核心 ADR）
- operator 拉闸权（E5-E6 晋升 + 框架自我演进 + 不可逆操作必须 operator 确认）
- worktree 隔离（网络白名单 + 权限控制 + 审计追踪 + 操作回滚）

### §5.4 可观测性要求

- 日志自动注入 trace_id（详见 [CONTRIBUTING.md §2.6 原则 8](../../CONTRIBUTING.md)）
- 所有 I/O 使用 async/await
- Eval 信号采集（trace 信号 + 用户信号 + 探针信号）
- 七类归因矩阵可分类失败原因
- LLM 调用日志：input + output + execution time（详见 [CONTRIBUTING.md §9.3.1](../../CONTRIBUTING.md)）

### §5.5 可演进性要求

- 配置驱动率：Phase 0 ≥ 30% / Phase 1 ≥ 60% / Phase 2 ≥ 80%
- 文档分层规范（详见 [CONTRIBUTING.md 第十一部分](../../CONTRIBUTING.md)）
- 自我演进闭环（详见 §2.10）
- Build to Delete vs Built to Persist 半衰期标记
- ADR 不可变历史（决策变更通过新增 ADR 引用旧 ADR）

### §5.6 测试要求（T1-T8 铁律）

详见 [CONTRIBUTING.md §5.5](../../CONTRIBUTING.md) 测试铁律 T1-T9。本节强调：
- 禁止 Mock LLM（T1）
- 禁止假数据（T2）
- 禁止跳过验证（T3）
- 禁止 Mock 工具（T4）
- 未实现即 Bug（T5）
- 必须采集指标（T6）
- LLM 内容必须经 LLM 审核（T7）
- Web 功能必须操控浏览器验证 DOM（T8）

---

> **本文档版本**：v7.1（2026-07-19）
> **下一阶段**：基于本文档开发 [arch.md](arch.md)（SAD 架构设计说明书），按 [CONTRIBUTING.md §11.3](../../CONTRIBUTING.md) 三阶段开发流程执行。
> **配套文档**：[arch.md](arch.md) + [design.md](design.md) + [features/](features/) + [architecture/](architecture/) + [design/](design/) + [decisions/](decisions/) + [review/](review/)
> **历史归档**：v7.0/v6.0 历史章节已归档至 [`_archive/spec_v7_historical_background.md`](_archive/spec_v7_historical_background.md)，仅作演化路径参考。
