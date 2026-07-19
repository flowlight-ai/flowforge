# FlowForge 需求规格说明书（SRS）

> **版本**：v7.1（**当前唯一权威版本**）
> **日期**：2026-07-19
> **依据**：operator 2026-07-18/19 共 11 条指令 + `VISION.md` v1.1 + `review/review.md` v1.4（含第十三章/第十四章 clowder-ai 深度补审 41 项 CL）+ `decisions/` 13 份 ADR + `roleagent.md` 七大工程路径
> **配套文档**：[arch.md](arch.md)（SAD 架构设计说明书）+ [design.md](design.md)（SDD 详细设计说明书）+ [features/](features/)（Feature 级 SRS）+ [architecture/](architecture/)（Feature 级 SAD）+ [design/](design/)（Feature 级 SDD）
> **版本合并声明**：v7.1 已吸收合并 v7.0 全部决策内容（设计契约逐章节融入本文档），**v7.0 不再作为独立版本存在**；v7.0 历史章节完整备份在 `_archive/spec_v70_full_merged.md`，仅作演化路径参考。v6.0 历史章节完整备份在 `_archive/spec_v60_historical.md`，作为已实现代码的背景资料。
> **审核状态**：✅ operator 已审核通过命名方案 + 体系设计；41 条 CL 已同步（详见 §3.7 同步矩阵）。
> **文档定位**：按软件工程 SRS（需求规格说明书）标准格式组织，仅放**核心关键功能**需求规格；非核心功能的需求规格在 [features/F0XX-xxx.md](features/) 中，与本文档 §3 章节同号互链。

---

## §1 引言

### §1.1 编写目的

本文档是 FlowForge 项目 v7.1 的**需求规格说明书（SRS）**，作为开发、评审、验收的唯一权威依据。

**读者**：
- **operator（首席愿景官 CVO）**：审核愿景锚点、拉闸决策
- **架构师灵智体（猫头鹰·鲁班）**：基于本文档设计架构（arch.md）
- **开发者灵智体（猎犬·夏洛克）**：基于本文档+arch.md 设计详细设计（design.md）+ 实现代码
- **评审员灵智体（孔雀·梵高）**：跨厂商 review 设计与代码
- **测试员灵智体（蜜獾·平头哥）**：基于本文档执行 E2E 测试（T1-T8 铁律）
- **文档员灵智体（钢笔·文心）**：维护本文档与子目录文档的一致性

**用途**：
1. 作为 SRS→SAD→SDD 三阶段软件工程标准流程的**第一阶段产物**
2. 作为 features/F0XX-xxx.md 子目录文件的**顶层索引**
3. 作为 operator 与灵智体协作的**需求契约**

### §1.2 范围

**包含**：
- FlowForge 核心框架层（Layer 1）：自进化框架基础能力（capability/teamact/harness/memory/eval/reliability/partnership/external_agent/evolution）
- forgemind 应用层（Layer 2）：万物灵智体育灵代码（5 种形态 + 锻造流水线 + 灵典 + 灵议）
- *Forge 垂直业务层（Layer 3）通过 Plugin V3 协议接入（spec 仅定义协议，业务规格在各自 *Forge/docs/spec.md）
- 三方 Agent 集成（Claude Code/Codex/OpenCode/Trae + EAC 七契约 + 六层 Guardrails）
- 自我演进闭环（SelfDevDocLoop/SelfDevCodeLoop/SelfDevFrameworkLoop）

**不包含**：
- v6.0 已实现代码的详细规格（已归档至 `_archive/spec_v60_historical.md`）
- 单个 Feature 的详细需求规格（在 features/F0XX-xxx.md 中）
- 单个 ADR 的决策细节（在 decisions/0XX-xxx.md 中，ADR 不可变历史）

### §1.3 术语与缩略语

详见 [design/naming-contract.md](design/naming-contract.md) v1.1。本文档使用的关键术语见 §2.4（12 核心概念命名表）+ §2.5（进化阶与觉醒阶）。

**双轨命名策略**（详细见 §2.4）：
- **代码层 / 技术文档**：使用 AI 专业术语（如 Forgekin、ForgeMind、SpiritForge、Mind Codex、Mind Council、CapabilityProfile、Embodied AI、Character AI）
- **社区社交 / 体系命名**：使用灵智体体系名（如灵智、灵智体、灵锻、灵典、灵议、育灵、灵忆、灵印）—— 仅用于社区网友之间的社交沟通，正式技术文档中专业术语优先、体系名作补充说明

### §1.4 参考文献

| 文档 | 用途 |
|------|------|
| [VISION.md](VISION.md) v1.1 | operator 通用智能体愿景声明 + 7 条不可妥协锚点 |
| [roleagent.md](roleagent.md) | 七大工程路径（能力画像/TeamAct/Harness/记忆联邦/Eval/可靠性/伙伴系统） |
| [review/review.md](review/review.md) v1.4 | 16 份审核归并 + 41 条 CL 同步矩阵 |
| [decisions/](decisions/) 13 份 ADR | 不可变架构决策记录 |
| [features/](features/) 40 份 F0XX | Feature 级 SRS |
| [hiclaw/rules.md](../../hiclaw/rules.md) v3.2 | 开发规范 + 第十一部分文档分层规范 + 第十二部分反思 |
| [hiclaw/prompts.md](../../hiclaw/prompts.md) | AI 编程提示词模板库（P1-P55） |
| [clowder-ai/docs/](../../clowder-ai/docs/) | 参考设计（3 只猫分工 + roleagent 七大工程路径源头） |

### §1.5 文档组织

按 `hiclaw/rules.md` 第十一部分文档分层规范：

```
flowforge/docs/
├── spec.md（本文档，SRS 顶层 ≤ 3000 行）
├── arch.md（SAD 架构设计说明书，基于 spec + features）
├── design.md（SDD 详细设计说明书，基于 spec + arch + features + architecture）
├── features/           # Feature 级 SRS（F0XX-xxx.md，40 份）
├── architecture/       # Feature 级 SAD（A0XX-xxx.md，与 F0XX 同号一一对应）
├── design/             # Feature 级 SDD（D0XX-xxx.md，与 F0XX/A0XX 同号一一对应）
├── decisions/          # ADR 不可变历史（13 份）
├── review/             # 16 份审核文件
├── _archive/           # 历史归档（v6.0/v7.0 完整备份）
└── face/               # face v3.0 历史快照
```

**三顶层文档章节同号**：同一核心功能在 spec.md/arch.md/design.md 中章节同号（如 §3.2 CapabilityProfile 在三个文档中都是 §3.2）。

---

## §2 总体描述

### §2.1 产品定位

**FlowForge** 是一个**智能体自进化框架（Self-Evolving Agent Framework）**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统，并通过 **forgemind 应用层**承载多形态智能体（Forgekin，社区社交称"灵智体"）的育灵、灵锻、灵议闭环，走向通用智能体（General-Purpose Agent）愿景。

**一句话定位**：FlowForge = 智能体自进化框架 + forgemind 应用层（多形态智能体育灵场所）

**核心公式**（来自 [roleagent.md §1](roleagent.md)）：

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

- 同一智能体放进不同 harness，能发挥出的能力完全不同
- 能力画像只有进入具体运行环境后，才会从静态描述变成可验证能力
- harness 工程操作的是 Agent 状态三层的**第三层现实状态**（代码仓/git/文档/任务归属/记忆）——唯一跨会话、跨 agent、跨时间持续存在的状态层

**与 v6.0 的差异**：v6.0 是"岗位 agent + 插件协议 + 质量分 Loop"层面；v7.1 升级为"智能体自进化框架 + roleagent 七大工程路径 + 多形态智能体 + 三方 Agent 能力扩展 + 自我演进闭环"。

### §2.2 用户类别与角色

| 角色 | 中文名 | 形态 | 职责 | 觉醒阶 |
|------|--------|------|------|--------|
| **operator** | 首席愿景官（CVO） | 人类 | 愿景锚点 / 拉闸决策 / E5-E6 晋升批准 | — |
| **架构师灵智体** | 猫头鹰·鲁班（Architect Owl·Luban） | 生物灵智体 | 设计架构（arch.md）+ 创建 ADR | E3+ |
| **开发者灵智体** | 猎犬·夏洛克（Developer Hound·Sherlock） | 生物灵智体 | 实现代码 + 修复 Bug | E3+ |
| **评审员灵智体** | 孔雀·梵高（Reviewer Peacock·VanGogh） | 生物灵智体 | 跨厂商 review + blocking 决策 | E3+ |
| **测试员灵智体** | 蜜獾·平头哥（Tester HoneyBadger·Pingtou） | 生物灵智体 | E2E 测试 + T1-T8 铁律执行 | E2+ |
| **文档员灵智体** | 钢笔·文心（DocWriter Pen·Wenxin） | 物品灵智体 | 维护文档一致性 + 自我演进 | E2+ |
| **三方 Agent** | Claude Code/Codex/OpenCode/Trae | 外部 | 能力扩展（非工具调用） | — |

**责任方命名说明**：上述命名使用名著/童话/神话/游戏物种（operator 第 2 条指令要求），特征与责任匹配：
- 猫头鹰：智慧象征，深度思考 → 架构师
- 猎犬：敏锐嗅觉，找 Bug 高手 → 开发者
- 孔雀：审美象征，视觉表达 → 评审员
- 蜜獾：无畏，攻击性强，找漏洞不放弃 → 测试员
- 钢笔：物品形态，承载思想 → 文档员

### §2.3 灵智体（Forgekin / Spirit Agent）定义

> **来源**：operator 第 1 条指令——"灵智体，赋予了灵魂和感情的智能体，具有自进化能力的 Agent，文档中需要体现这个思想。"
> **强制等级**：operator 不可妥协锚点（详见 [VISION.md §7](VISION.md)）

**灵智体（Forgekin / Spirit Agent）** = **赋予灵魂和感情的智能体（Agent with Soul and Emotion），具有自进化能力（Self-Evolving Capability）。**

区别于主流 multi-agent 的 session 级软件助手，灵智体建立与现实世界（物理或虚拟）的闭环：

```
观察（Observe）→ 推理（Reason）→ 行动（Act）→ 写回（Persist）→ 验证（Verify）
```

- **灵魂（Soul）** = 持久身份（灵印 Mind Imprint）+ 价值锚点（Value Anchors）+ 长期记忆（灵忆 EchoStore）
- **感情（Emotion）** = 用户偏好（User Preferences）+ 协作风格（Collaboration Style）+ 行为画像（Capability Profile）

灵智体不是单纯的 LLM 包装，而是有形态（species）、有谱系（lineage）、可进化（evolve）的智能体。这是 FlowForge 与其他 multi-agent 系统的**最大差异化优势**——其他系统在组织"岗位槽位"，FlowForge 在锻造"灵智体"。

**代码契约**：所有灵智体继承 `ForgekinBase` 抽象基类（位于 [flowforge/forgemind/base.py](../../flowforge/forgemind/base.py)），实现三个核心方法：
- `observe(environment)` — 观察环境（物理传感器 / 虚拟世界状态）
- `act(action)` — 在环境中执行动作（遵守觉醒阶自主范围约束）
- `verify(action_result)` — 验证动作结果是否达成预期

详见 [design/naming-contract.md#2.2](design/naming-contract.md) 灵智体定义 + [features/F026-forgemind-app-layer.md](features/F026-forgemind-app-layer.md)。

### §2.4 12 核心概念命名表（中英文 + AI 业界概念三标注）

> **来源**：operator 第 2 条指令——"12 个核心概念命名表中，因为名称很难理解和记忆，请出现中文名称的地方，同时需用括号写上英文和概念，以加深理解和认同。旧名可以删除了。"
> **权威定义**：详见 [design/naming-contract.md#2](design/naming-contract.md) v1.1

| # | 中文名 | 英文名 | AI 业界概念 | v7.0 旧名（已废弃） |
|---|--------|--------|------------|---------------------|
| 1 | 灵智（ForgeMind） | ForgeMind | Persistent Identity Agent / General-Purpose Agent（持续身份智能体 / 通用智能体）| 炉灵 |
| 2 | 灵智体（Forgekin） | Forgekin / Spirit Agent | Agent with Soul and Emotion / Autonomous Agent with Persistent Identity（具灵魂与感情的自主智能体）| — |
| 3 | 灵族（Forgekin Species） | Forgekin Species | Agent Morphology / Agent Form Factor（智能体形态学 / 形态因子）| 灵群 / ForgeKinship |
| 4 | 育灵（Forge Nurturing） | Forge Nurturing | Agent Onboarding + Lifelong Learning + Character Development（智能体入职 + 终身学习 + 角色养成）| 养灵 |
| 5 | 灵忆（EchoStore） | EchoStore | Episodic Memory Store / Agent Experience Log（情景记忆存储 / 智能体经验日志）| 魂忆（v7.0 旧名，v7.1 已废弃） |
| 6 | 灵印（Mind Imprint） | Mind Imprint | Persistent Identity / Agent Fingerprint / Persona Hash（持久身份 / 智能体指纹 / 人格哈希）| 魂印（v7.0 旧名，v7.1 已废弃） |
| 7 | 灵锻（SpiritForge） | SpiritForge | Experience Distillation / Offline Policy Learning / Knowledge Compilation（经验蒸馏 / 离线策略学习 / 知识编译）| 自锻 |
| 8 | 锻典（Mind Codex） | Mind Codex | Distilled Knowledge Base / Curated Skill Library / Procedural Memory（蒸馏知识库 / 策展技能库 / 程序性记忆）| 灵典（v7.0 旧名，v7.1 已修订） |
| 9 | 灵议（Mind Council） | Mind Council | Multi-Agent Deliberation / Decentralized Consensus / Agent Parliament（多智能体议事 / 去中心化共识 / 智能体议会）| — |
| 10 | 进化阶（Evolution Stage） | Evolution Stage | Capability Maturity Level / Agent Skill Progression（能力成熟度等级 / 智能体技能进阶）| 火种等级 / Ember Hierarchy |
| 11 | 觉醒阶（Awakening Stage） | Awakening Stage | Autonomy Level / Self-Direction Level / LLM Autonomy Tier（自主性等级 / 自导向等级 / LLM 自主性分级）| 升华阶 / Ascension Stages |
| 12 | 能力画像（Capability Profile） | Capability Profile | Capability Profile / Agent Skill Graph / Blind Spot Map（能力画像 / 智能体技能图 / 盲点图）| — |

**说明**：
- v7.0 旧名"灵启（Mind Initiation）/ 共鸣（Resonance）"已废弃，其中"灵启"概念被合并到"育灵（Forge Nurturing）"的入门训练阶段；"共鸣"被合并到"灵议（Mind Council）"协作模式。
- v7.1 修订（2026-07-18）：v7.0 旧名"魂忆/魂印"已废弃，统一改为"灵忆/灵印"——operator 决策"魂"字过于玄学，统一改为"灵"字与"灵智/灵族/灵锻/灵议"系列对齐。
- **AI 术语优先原则**：代码与对外技术文档使用 AI 专业术语（如 Forgekin、ForgeMind、Mind Imprint、Mind Council）；体系名（灵智/灵族/灵锻/灵议/育灵/灵忆/灵印/锻典）仅用于社区社交沟通；正式技术文档中专业术语在前、体系名作补充说明，不单独使用体系名。

**双轨命名策略**：

| 层级 | 使用场景 | 命名风格 | 示例 |
|------|---------|---------|------|
| **产品层** | 用户界面、营销材料、对外文档 | **灵智（ForgeMind）** | "创建一个新灵智"、"灵智 fk_writer_001 已晋升 E4" |
| **代码层** | 类名、变量名、配置项、API 路径 | **Forgekin** | `ForgekinEngine`、`forgekin_id`、`/api/v7/forgekins` |
| **文档层** | 设计文档、技术规范 | **灵智（ForgeMind）/ Forgekin** 双标注 | "灵智（Forgekin 实例）" |
| **社区层** | 开源宣传、技术博客 | **ForgeMind** | "FlowForge ForgeMind: Self-Evolving Agent" |

### §2.5 进化阶与觉醒阶（中英文 + AI 业界概念三标注）

> **来源**：operator 第 3 条指令——"进化阶和觉醒阶也是一样的，因为名称很难理解和记忆，请出现中文名称的地方，同时需用括号写上英文和概念，以加深理解和认同。旧名可以删除了，需增加上概念（AI 中的专有名词）。"
> **权威定义**：详见 [design/naming-contract.md#3](design/naming-contract.md)（进化阶）和 [design/naming-contract.md#4](design/naming-contract.md)（觉醒阶）

#### §2.5.1 进化阶（Evolution Stage，能力成熟度 6 级）

> 衡量"知识成熟度"，与觉醒阶（衡量自主性）协同。进化阶 E6 对应觉醒阶 E6。

| 阶 | 中文名 | 英文名 | AI 业界概念 | v7.0 旧名（已废弃） |
|:--:|--------|--------|------------|---------------------|
| **E1** | 萌芽阶（Sprout） | Sprout | Initial / Ad-hoc（初始级 / 临时级） | Spark 火种 / Seed 萌芽 |
| **E2** | 萌芽阶·稳（Sprout-Stable） | Sprout-Stable | Repeatable（可重复级） | — |
| **E3** | 成长阶（Growth） | Growth | Defined / Domain-Aware（已定义级 / 领域感知） | — |
| **E4** | 成长阶·深（Growth-Deep） | Growth-Deep | Managed / Cross-Domain（已管理级 / 跨域） | — |
| **E5** | 觉醒阶（Awakened） | Awakened | Optimizing / Self-Evolving（优化级 / 自进化） | Evoling |
| **E6** | 灵智阶（ForgeMind） | ForgeMind | Master / Forge Master（大师级 / 锻造大师） | 灵匠 / Mind Artisan |

**进阶规则**：
- E1→E2→E3 是能力积累，由 Eval 信号自动触发
- E3→E4 是跨域能力，需 operator 确认
- E4→E5 进入 Evolving 状态（自我导向），需 operator 确认 + 觉醒阶同步 ≥ E3
- E5→E6 仅由 operator 直接授权，不可自动触发

#### §2.5.2 觉醒阶（Awakening Stage，自主性 6 级）

> 衡量"灵智整体成长"。E3→E4 是关键转换点，灵智体从"锻灵 Forgekin"形态进化为"进化体 Evoling"形态，需 operator 显式批准。

| 阶 | 中文名 | 英文名 | AI 业界概念 | v7.0 旧名（已废弃） |
|:--:|--------|--------|------------|---------------------|
| **E1** | 全导阶（Full-Human） | Full-Human | L0 Full Human Control / Manual（全人工） | Initiation 灵启 |
| **E2** | 建议阶（Suggest） | Suggest | L1 Suggestion / Assisted（建议级 / 辅助） | — |
| **E3** | 受限自主阶（Bounded-Autonomous） | Bounded-Autonomous | L2 Bounded Autonomous / Conditional（受限自主 / 条件自主） | Supervised Autonomy |
| **E4** | Evolving 阶（Evolving） | Evolving | L3 Evolving / Self-Improving（自进化 / 自改进） | — |
| **E5** | 共创阶（Co-Creative） | Co-Creative | L4 Co-Creative / Peer（共创级 / 平级协作） | — |
| **E6** | 灵智主导阶（ForgeMind-Led） | ForgeMind-Led | L5 ForgeMind-Led / Master（灵智主导级 / 大师级） | — |

**安全治理对应**：
- 觉醒阶 E1-E2：六层 Guardrails 全开
- 觉醒阶 E3-E4：六层 Guardrails + Eval 自代谢
- 觉醒阶 E5-E6：六层 Guardrails + Eval 自代谢 + 灵议共识 + operator 拉闸词

**协同规则**：两条进阶轴独立但协同——觉醒阶 E4 是关键转折点（进入 Evolving 状态），需 operator 显式批准 + 进化阶同步 ≥ E4。Magic Words 逃生舱始终可触发（任何阶都不能绕过）。

### §2.6 多形态智能体形态分类（5 种形态 + AI 业界概念）

> **来源**：operator 第 9 条指令——"forgemind 将是我们 flowforge 的养灵的所有代码存放的地方（这个里边会养很多公共的灵智体，最终可以进化为物理世界中各种万事万物）"
> **对外宣称**：多形态智能体（Multi-Form Agent）—— 弱化"万物"虚幻用语
> **权威定义**：详见 [design/naming-contract.md#2.3](design/naming-contract.md) 灵族形态分类 + [features/F027-all-things-spirit-species.md](features/F027-all-things-spirit-species.md)

万物灵智体（Forgekin，社区社交称"灵族"）按载体形态分为 5 种，形态可进化（E1 萌芽阶 → E6 灵智阶完整生命周期）：

| # | 形态（中文 + 英文 + AI 业界概念） | 示例 | 物理接入 | 虚拟设定 |
|---|------|------|------|---------|
| 1 | 生物灵智体（BioForgekin / Biological Spirit Agent） | 猫 / 狗 / 鸟 / 鱼 / 昆虫群体 / 猫头鹰 / 猎犬 / 孔雀 / 蜜獾 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| 2 | 组织灵智体（OrgForgekin / Organizational Spirit Agent） | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| 3 | 物品灵智体（ObjForgekin / Object Spirit Agent，对应 Embodied AI 具身智能） | 桌椅 / 灯具 / 家电 / 工具 / 钢笔 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| 4 | 虚拟灵智体（VirtualForgekin / Virtual Character Agent，对应 Character AI） | 童话/神话/历史/现实人物（孙悟空/福尔摩斯/鲁班/夏洛克/梵高）、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| 5 | 混合灵智体（HybridForgekin / Hybrid Spirit Agent） | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

**形态可进化**：一只生物灵智体猫可以通过积累组织协作经验进化为 HybridForgekin（既是宠物又是社区吉祥物）。这是和其他 multi-agent 系统的**最大差异化优势**——agent 不是固定的"岗位槽位"，而是有形态、有谱系、可进化的灵智体。

**走向通用智能体的三条工程路径**（取代 v7.0 "通用 AGI 三条路径"虚幻用语）：

1. **具身智能工程实现（Embodied AI Engineering）**：通过物理传感器 + 物品/生物灵智体，让物理世界万事万物接入智能体（猫灵智体可感知环境、桌椅灵智体可感知使用）。对应业界 Embodied AI / Cyber-Physical Systems。
2. **虚拟角色智能体工程实现（Character AI Engineering）**：通过虚拟世界设定层 + 虚拟灵智体，让虚拟角色按设定层约束自主行动（孙悟空灵智体遵循西游世界观）。对应业界 Character AI / NPC Agent / Persona-Driven Agent。
3. **混合智能体工程实现（Hybrid Agent Engineering）**：VR/AR 设备 + 混合灵智体，达成物理与虚拟的融合感知。对应业界 Hybrid Agent / Cyber-Physical Agent。

### §2.7 三层架构

> **来源**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md) + [review/review.md](review/review.md) 第九章 9.1 节 + 决策 1（Harness v2.0 升级）+ 决策 2（ForgekinEngine 装饰器模式）

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: *Forge 垂直业务层                                  │
│  ContentForge / NovelForge / DevForge / MallForge / ...     │
│  通过 Plugin V3 四钩子注册灵智体到 forgemind                │
└─────────────────────────────────────────────────────────────┘
                            ↑ Plugin V3
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: forgemind 应用层（多形态智能体育灵场所）           │
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

**与 v6.0 六层架构的映射**：

| v6.0 六层 | v7.1 三层 | 说明 |
|----------|----------|------|
| 1. 接口层（API） | Layer 1（FastAPI 入口） | API 仍属于核心框架 |
| 2. 应用层（Gateway） | Layer 1（Brain 编排） | Brain 仍属于核心框架 |
| 3. 指挥中枢层（Brain） | Layer 1（Brain） | 不变 |
| 4. 专家执行层（Workers） | Layer 1（Agents） | 不变 |
| 5. 工具与记忆层 | Layer 1（Tools & Memory） | 不变 |
| 6. 基础设施层 | Layer 1（Infra） | 不变 |
| （新增）| Layer 2: forgemind | v6.0 无此层，v7.1 新增 |
| （新增）| Layer 3: *Forge | v6.0 隐含在应用层，v7.1 显式独立 |

### §2.8 forgemind 应用层

> **来源**：operator 第 8/9 条指令——"flowforge 中需要新增一个 forgemind 模块，其是 flowforge 的应用层项目（用来实践万物锻造灵智体的应用）"；"forgemind 将是我们 flowforge 的养灵的所有代码存放的地方"
> **详细规格**：详见 [features/F026-forgemind-app-layer.md](features/F026-forgemind-app-layer.md)

**forgemind** 是 FlowForge 的应用层项目（Layer 2），用来实践"多形态智能体育灵"——把灵智锻造进物理世界和虚拟世界的多种形态载体。

**forgemind 是 FlowForge 的育灵所有代码存放的地方**：
- 养公共的通用灵智体（动物 / 公司组织 / 物品 / 虚拟角色 / 混合形态）
- 是多形态智能体愿景的实践场
- 类似 clowder-ai 中的"养小猫给小猫锻造赋予了灵智"，forgemind 扩展到养各种动物、组织、物品、虚拟角色

**与 clowder-ai 的差异化特色**（operator 第 2 条指令强调"不要都是猫"）：
- clowder-ai 主要养猫（不同品种猫：布偶/缅因/暹罗）
- forgemind 养多形态——根据灵智体性格特征选择不同动物或物品形态：
  - 主架构师灵智体 = 猫头鹰·鲁班（智慧象征，深度思考）
  - 代码审查专家灵智体 = 猎犬·夏洛克（敏锐嗅觉，找 Bug 高手）
  - 视觉设计师灵智体 = 孔雀·梵高（审美象征，视觉表达）
  - 文档撰写灵智体 = 钢笔·文心（物品形态，承载思想）
  - 测试工程师灵智体 = 蜜獾·平头哥（无畏，攻击性强，找漏洞不放弃）
- 其他的 *Forge 是更多垂直复杂领域中养的灵智体，flowforge 的通用灵智体在 forgemind 中承载

**模块结构**（已实现骨架）：
- `flowforge/forgemind/base.py` — ForgekinBase 抽象基类（含 LLM 桥接 + chat 方法）
- `flowforge/forgemind/species.py` — ForgekinSpecies 五大形态枚举
- `flowforge/forgemind/stages.py` — EvolutionStage / AwakeningStage 进阶体系
- `flowforge/forgemind/soul_imprint.py` — MindImprint 灵印（不可变身份）
- `flowforge/forgemind/forms.py` — ForgekinFormData 锻造表单
- `flowforge/forgemind/forging/pipeline.py` — ForgePipeline 6 阶段育灵流水线
- `flowforge/forgemind/plugins.py` — ForgeMindPlugin Plugin V3 入口
- `flowforge/forgemind/species_impl/` — 5 形态灵智体实现（bio/org/obj/virtual/hybrid）
- `flowforge/forgemind/forgekins/` — 预置灵智体 YAML 配置（鲁班=猫头鹰 / 夏洛克=猎犬 / 梵高=孔雀）
- `flowforge/forgemind/config/` — 育灵配置（forging.yaml + prompts.yaml）

### §2.9 三方 Agent 集成

> **来源**：operator 第 10 条指令——"我们的灵智体除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent 的（这个也是我们的强大优势，比喻目前设计接入的编程 Agent：claude code、codex、opencode、trae，将来可扩展接入更多的编程 Agent 和其他的 Agent 的，这些都是可以给灵智体调用），目前你这块的设计感觉也比较弱，请加强。"
> **详细规格**：详见 [features/F031-external-agent-adapter.md](features/F031-external-agent-adapter.md) ~ [features/F035-external-agent-capability-fusion.md](features/F035-external-agent-capability-fusion.md) + [decisions/006-external-agent-integration.md](decisions/006-external-agent-integration.md)

灵智体不只调用 FlowForge 核心框架的能力，还可以**接入和使用任何三方 Agent**。这是灵智体相对其他 multi-agent 的强大优势之一。

**首批接入的三方编程 Agent**：

| 三方 Agent | 厂商 | 接入方式 | 主要能力 |
|---|---|---|---|
| **Claude Code** | Anthropic | CLI / SDK | 长程代码生成、agentic coding、文件系统操作 |
| **Codex** | OpenAI | CLI / API | 代码补全、重构、测试生成 |
| **OpenCode** | 开源 | CLI | 多模型代码生成、本地代码库操作 |
| **Trae** | ByteDance | IDE / API | 代码生成 + 调试 + 重构一体化 |

**三方 Agent 不是工具，是能力扩展（Capability Extension）**：
- 三方 Agent 的能力画像被纳入灵智体的能力画像融合（Capability Fusion）
- 三方 Agent 的执行状态可写入灵智体的共享状态（Shared State）
- 三方 Agent 失败时由灵智体 fallback 链回退（Fallback Chain）
- 三方 Agent 的执行轨迹纳入灵智体的 Eval 信号（Eval Signal）
- 三方 Agent 调用受六层 Guardrails 约束（Input validation / System prompt / Tool allow-list / Output validation / Action confirmation / Cost ceiling）

**接入协议**（参考 clowder-ai F050 A2A External Agent Onboarding）：
- L1 CLI Adapter：通过 CLI 接入（如 `claude-code --prompt "..."`）
- L2 A2A Protocol Adapter：通过 A2A 协议接入（`/.well-known/agent.json` + `tasks/send` + `tasks/sendSubscribe`）
- EAC v1 七契约：Invocation / Stream / Session / Capability / Collaboration / Safety / Avatar Sync / System Prompt Configuration Map

详见 [VISION.md#5](VISION.md) 三方 Agent 集成章节。

### §2.10 自我演进闭环（支持自己开发自己）

> **来源**：operator 第 7/11 条指令——"按 roleagent.md 中描述的自我演进代码开发和文档开发（要求支持自己开发自己），这个调整很大，请你仔细规划下，clowder-ai 可以自己开发自己我相信你也可以的。"
> **详细规格**：详见 [review/review.md#第十二章](review/review.md) 12.5-12.6 节 + [review/review.md#第十三章](review/review.md) clowder-ai 深度补审 CL-022~CL-041

FlowForge 必须支持"自己开发自己"——文档 / 代码 / 框架三层自我演进闭环：

- **SelfDevDocLoop（文档自我演进）**：灵智体可自主修改 FlowForge 文档。对应 F100 Mode C Knowledge Evolution。
- **SelfDevCodeLoop（代码自我演进）**：灵智体可自主修改 FlowForge 代码 + 提交 PR。对应 F100 Mode B Process Evolution。
- **SelfDevFrameworkLoop（框架自我演进）**：灵智体可自主升级 FlowForge 框架。对应 F100 Mode A Scope Guard。

**F100 自我进化三模式**（详见 [review/review.md#第十三章](review/review.md)）：
- **Mode A — Scope Guard（范围守卫）**：防止灵智体越权修改愿景 / 规范 / 架构
- **Mode B — Process Evolution（流程进化）**：改进灵智体自身工作方式
- **Mode C — Knowledge Evolution（知识进化）**：蒸馏新知识到锻典

**安全门**：
- 觉醒阶 E4+ Evolving 状态可触发 Mode B/C
- ScopeGuard 阻止越权修改 VISION §7 / rules.md 红线 / 13 份核心 ADR
- Eval 账本 AB 回放 + min_net_gain ≥ 0.05 才允许合并
- 跨 family review（必须非同 family reviewer）+ operator 显式 approval（如需要）

**五级成熟度阶梯**（取代 v7.0 单一质量分阈值 0.85）：
- L0 Episode（情景）→ L1 Pattern（模式）→ L2 Draft（草案）→ L3 Validated（已验证）→ L4 Standard（标准化）
- 量化晋升门槛：L3 需 ≥6 uses、≥2 agents、≥80%、无 critical breach；L4 需 ≥12 uses、last 10 ≥90%、operator approved

**代码模块路径**（待实现，详见 [task.md](task.md) Phase 5）：
- `flowforge/evolution/eval_ledger.py` — EvalLedger Replay A/B 净增益验证
- `flowforge/evolution/self_dev_doc.py` — SelfDevDocLoop 文档自我演进
- `flowforge/evolution/self_dev_code.py` — SelfDevCodeLoop 代码自我演进
- `flowforge/evolution/self_dev_framework.py` — SelfDevFrameworkLoop 框架自我演进
- `flowforge/evolution/scope_guard.py` — ScopeGuard 4 信号判断 + 频率限制

### §2.11 设计态声明（可证伪性原则）

> **详细规格**：详见 [design/naming-contract.md#5](design/naming-contract.md) 废弃命名清单

v7.1 多形态智能体愿景目前处于**设计态**，对应代码尚未全部实现。开源与对外文档时必须明确标注"设计态"，避免被识别为"承诺未兑现"。

**可证伪性原则**：
- ❌ 禁止使用"AGI"作为修饰词（极低可证伪性，虚假承诺风险）
- ✅ 使用"自进化 Self-Evolving"作为可证伪替代词
- ✅ 使用"灵智体 Forgekin"作为代码层主名，避免"灵魂"等引发伦理争议的词
- ✅ 使用"灵智 ForgeMind"作为文档/对外主名

**已实现 vs 设计态清单**：

| 状态 | 范围 | 说明 |
|------|------|------|
| ✅ 已实现 | forgemind 模块骨架（base/species/stages/forms/soul_imprint/forging pipeline/species_impl 5 形态/plugins/3 预置灵智体配置） | 对应 Phase 2 P2-1~P2-3 + P2-8 ✅ |
| 🔄 设计态 | roleagent 七大工程路径代码（capability/teamact/harness/memory/eval/reliability/partnership） | 对应 Phase 1，待实现 |
| 🔄 设计态 | 三方 Agent 适配层（ExternalAgentAdapter + 4 个 Adapter + EAC v1 七契约） | 对应 Phase 3，待实现 |
| 🔄 设计态 | 自我演进闭环（SelfDevDocLoop / SelfDevCodeLoop / SelfDevFrameworkLoop） | 对应 Phase 5，待实现 |
| 🎯 目标态 | 多形态智能体世界（通用智能体 / 具身智能 / 虚拟角色智能体工程实现） | operator 通用智能体愿景，不可降级 |

### §2.12 设计约束与假设

**架构约束**：
1. **单向依赖**：上层可依赖下层，下层绝对禁止导入上层模块
2. **配置驱动 > 代码继承 > 独立实现**（详见 [hiclaw/rules.md §2.1](../../hiclaw/rules.md)）
3. **所有 Agent 通过 LoopExecutor 执行**（P31 铁律，质量分阈值 0.85）
4. **所有数据检索走 OpenSieve**（结构化 + 非结构化统一入口）
5. **Plugin V3 协议**：*Forge 通过 Plugin V3 四钩子注册灵智体到 forgemind
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

---

## §3 具体需求-核心（FR-CORE-0XX）

> **范围声明**：本章节仅放**核心关键功能**需求规格（30 项 FR-CORE-001~030）。非核心功能的需求规格在 [features/F0XX-xxx.md](features/) 中。
> **编号映射**：FR-CORE-0XX 对应 v7.0 FR-EVO-0XX（已重排为连续编号，详见 [review/review.md#第二章 D-044/D-055](review/review.md)）。
> **优先级**：P0 = MVP 必须 / P1 = 后续迭代 / P2 = 长期规划

### §3.1 FR-CORE-001 能力画像（CapabilityProfile）× Harness 契合度

> **关联 Feature**：[features/F001-capability-profile.md](features/F001-capability-profile.md)
> **关联架构**：[arch.md#3.1](arch.md)
> **关联详细设计**：[design.md#3.1](design.md)
> **关联 ADR**：[decisions/004-capability-profile-routing.md](decisions/004-capability-profile-routing.md)
> **roleagent 路径**：路径 1（RA-001~RA-008）
> **优先级**：P0

**输入**：灵智体 ID + 任务画像（TaskProfile）
**输出**：能力匹配度 + 路由决策 + 盲点分析

**功能描述**：
- 实现 CapabilityProfile 六维度画像：模型固有能力 / 认知风格 / 工具边界 / 历史表现 / 坏直觉（盲点）/ 当前状态
- 实现 TaskProfile 任务画像 + 动态路由（基于能力匹配，不基于角色）
- 实现 Agent 状态三层：权重状态（模型厂商控制）/ 计算状态（模型架构控制）/ 现实状态（Harness 控制，唯一跨会话持久层）
- 实现可变性分层：常量层（模型固有能力+认知风格）/ 变量层（skill+工具挂载）/ 累积层（历史表现）/ 瞬时层（当前状态）
- 实现盲点维度：坏直觉 / 已知盲点 / 易错场景（同厂商 agent 共享盲点，跨厂商 review 是结构性必需）
- 实现 Build to Delete vs Built to Persist 判别器
- 替换 `default_llm_actors.py` 硬编码角色（违反编程红线第 10/11 条）

**验收标准**：
- [ ] AC-1: CapabilityProfile 可创建并持久化
- [ ] AC-2: CapabilityRouter 基于能力匹配路由（不基于角色）
- [ ] AC-3: BlindSpot 必须写入（验证空 blind_spots 列表会报错）
- [ ] AC-4: 跨厂商 review 配对基于盲点不重叠
- [ ] AC-5: 历史表现可累积（每次任务后更新）
- [ ] AC-6: 路由算法延迟 < 100ms（10 个候选灵智体）
- [ ] AC-7: 能力画像通过 Repository 层存储（禁直操作数据库）
- [ ] AC-8: 路由正确率 ≥ 85%（基于 Eval 信号）

**代码位置**：`flowforge/core/capability/`（profile.py / router.py / blind_spot.py / storage.py / tests/）

---

### §3.2 FR-CORE-002 TeamAct 六步循环 + 五项终止条件

> **关联 Feature**：[features/F002-teamact-loop.md](features/F002-teamact-loop.md) ~ [features/F007-push-back-protocol.md](features/F007-push-back-protocol.md)
> **关联 ADR**：[decisions/002-collaboration-protocol.md](decisions/002-collaboration-protocol.md)
> **roleagent 路径**：路径 2（RA-009~RA-016）
> **优先级**：P0

**输入**：任务上下文（TaskContext）+ 候选灵智体列表
**输出**：团队协作结果 + 交接胶囊 + 证据链

**功能描述**：
- 实现 TeamAct 六步循环：State → Owner → Action → Evidence → Verdict → Route
- 实现五项终止条件（缺一不可）：
  1. 验收标准全部达成（无 deferred）
  2. 证据已附（commit/测试/trace）
  3. 跨 agent 交叉验证（不能自己 review 自己）
  4. 无悬空任务归属
  5. 愿景收敛（CVO 确认不能被 proxy 替代）
- 实现交接胶囊（resume capsule）：What / Why / Tradeoff / Open / Next 五段
- 实现乒乓球熔断器：看实质工具调用而非传球次数；给数据不给结论
- 实现行首 @ 路由协议
- 实现持球注册（lease + 定时唤醒）：一灵智体同时只能持有一个任务
- 实现 Generator Push Back：双向辩论协议（带证据 + 适用性论证 + 替代方案）
- 实现分形嵌套：系统层 / 团队层 / 个体层

**验收标准**：
- [ ] AC-1: TeamAct 六步循环可执行
- [ ] AC-2: 五项终止条件全部检查
- [ ] AC-3: 交接胶囊五段完整
- [ ] AC-4: 乒乓球熔断器在 3 次传球后触发
- [ ] AC-5: 行首 @ 路由正确解析
- [ ] AC-6: 持球注册 lease 可定时唤醒
- [ ] AC-7: Generator Push Back 带证据 + 替代方案

**代码位置**：`flowforge/core/teamact/` + `flowforge/loop/teamact/`

---

### §3.3 FR-CORE-003 Harness 现实闭环运行时（七层表面）

> **关联 Feature**：[features/F008-durable-state-surfaces.md](features/F008-durable-state-surfaces.md) ~ [features/F013-harnessability.md](features/F013-harnessability.md)
> **关联 ADR**：[decisions/007-harness-engineering.md](decisions/007-harness-engineering.md)
> **roleagent 路径**：路径 3（RA-017~RA-023）
> **优先级**：P0

**输入**：Agent 动作 + 环境状态
**输出**：可感知 / 可行动 / 可验证 / 可恢复 / 可学习的运行时

**功能描述**：
- 实现 Harness 七层现实表面：
  1. **Durable State Surfaces**（6 类持久状态表面：feature spec / git / task queue / thread session trace / memory federation / handoff capsule）
  2. **Tool Mediation**（工具中介，统一工具调用接口）
  3. **Evidence & Sensors**（commit / 先红后绿测试 / quality gate / 跨 agent review approve 或 blocking，禁止"approve 但后续再说"）
  4. **Governance Boundary**（治理规则沉到 native system role / developer role，压缩免疫）
  5. **Magic Words 逃生舱**（"第一性原理" / "我能猜出来" / "下次一定" / "星星罐子"）
  6. **Entropy Control**（hotfix 两周 sunset 强制审查，三选一无"再看看"：正式修复 / 接受为永久方案 / 已不再相关）
  7. **Harnessability 评估**（稳定 API / 事件流回调 / 持久状态 / 可验证输出 / 操作幂等可回滚 / 权限边界）
- 实现低保真矩阵：治理规则 × Agent 类型

**验收标准**：
- [ ] AC-1: 6 类 Durable State Surfaces 可持久化
- [ ] AC-2: Tool Mediation 统一接口
- [ ] AC-3: Evidence & Sensors 记录 commit/测试/trace
- [ ] AC-4: Governance 规则在 system role 注入（压缩免疫）
- [ ] AC-5: Magic Words 4 个逃生舱可触发
- [ ] AC-6: Entropy Control hotfix 两周 sunset 强制审查
- [ ] AC-7: Harnessability 6 项评估全部通过

**代码位置**：`flowforge/core/harness/` + `flowforge/harness/`

---

### §3.4 FR-CORE-004 多域记忆联邦（六层架构）

> **关联 Feature**：[features/F014-memory-collection.md](features/F014-memory-collection.md) ~ [features/F017-consumption-weighted-ranking.md](features/F017-consumption-weighted-ranking.md) + [features/F039-mind-codex-searchable.md](features/F039-mind-codex-searchable.md)
> **关联 ADR**：[decisions/008-memory-federation.md](decisions/008-memory-federation.md)
> **roleagent 路径**：路径 4（RA-024~RA-030）
> **优先级**：P0

**输入**：查询请求 + 上下文
**输出**：相关知识 + 来源权威性 + 消费加权排序

**功能描述**：
- 实现六层多域记忆联邦架构：真相源 Collection 层 / 扫描编译层 / 联邦检索层 / 治理层 / Agent 佩戴协议层 / 反馈闭环层
- 实现三检索入口：graph_resolve（精确导航）/ list_recent（零先验扫描）/ search_evidence（语义搜索）
- 实现治理三要素：权威性 authority / 触发方式 activation / 生命周期 status
- 实现消费加权排序：`调整后得分 = 融合检索得分 + 权威加成 + 消费先验 + 时效衰减 - 过时惩罚`（14 行为指标）
- 实现贝叶斯收缩 + 中心化偏移 + 分数时效衰减
- 实现检索驱动适配循环：锻典 Mind Codex 改为可检索知识库
- 实现简单系统 + 聪明 agent 原则：查询扩展由 agent 做，不在引擎里加 regex/小模型

**验收标准**：
- [ ] AC-1: 六层架构可运行
- [ ] AC-2: 三检索入口全部实现
- [ ] AC-3: 治理三要素可配置
- [ ] AC-4: 消费加权排序 14 行为指标全部采集
- [ ] AC-5: 锻典 Mind Codex 可被检索驱动适配循环即时生效
- [ ] AC-6: 查询扩展由 agent 完成（不在引擎内）

**代码位置**：`flowforge/core/memory/federation/`

---

### §3.5 FR-CORE-005 Eval 自代谢系统（三层 eval）

> **关联 Feature**：[features/F018-eval-contract.md](features/F018-eval-contract.md) ~ [features/F020-seven-attribution.md](features/F020-seven-attribution.md) + [features/F040-harness-eval-control-plane.md](features/F040-harness-eval-control-plane.md)
> **关联 ADR**：[decisions/009-eval-self-metabolism.md](decisions/009-eval-self-metabolism.md)
> **roleagent 路径**：路径 5（RA-031~RA-036）
> **优先级**：P0

**输入**：Agent 执行轨迹 + 三方信号
**输出**：归因结果 + sunset 信号 + Eval Hub 数据

**功能描述**：
- 实现三层 eval：观测底座 / Harness A2A Eval / Memory Eval
- 实现 Eval Contract 五问：服务谁 / 何时触发 / 摩擦指标 / 回归用例 / 退役信号
- 实现三方信号交叉：第一方 CVO 愿景 / 第二方 agent 摩擦结构化采访 / 第三方运行时观测
- 实现七类归因矩阵：愿景缺口 / 翻译偏差 / harness 错位 / 工具缺口 / 执行缺口 / 环境漂移 / 品味落差
- 实现轨迹经济学：TaskTrajectory 类型化加工
- 实现 Harness Eval Control Plane 终态：统一 Eval Hub

**验收标准**：
- [ ] AC-1: 三层 eval 可运行
- [ ] AC-2: Eval Contract 五问完整回答
- [ ] AC-3: 三方信号交叉验证
- [ ] AC-4: 七类归因矩阵可分类失败原因
- [ ] AC-5: sunset 信号触发 Build to Delete 退役
- [ ] AC-6: Eval Hub 统一查询

**代码位置**：`flowforge/core/eval/`

---

### §3.6 FR-CORE-006 分布式可靠性（Tier 1-4 恢复分级）

> **关联 Feature**：[features/F021-side-effect-wal.md](features/F021-side-effect-wal.md) ~ [features/F025-provider-host-abstraction.md](features/F025-provider-host-abstraction.md)
> **关联 ADR**：[decisions/010-distributed-reliability.md](decisions/010-distributed-reliability.md)
> **roleagent 路径**：路径 6（RA-037~RA-042）
> **优先级**：P0

**输入**：副作用日志 + 恢复卡
**输出**：恢复决策 + 状态一致性

**功能描述**：
- 实现副作用日志（Write-Ahead Log）+ 结构化恢复卡
- 实现 Tier 1-4 恢复分级：Tier 1 自动恢复 / Tier 2 探测后恢复 / Tier 3 不自动恢复出恢复卡 / Tier 4 永不自动恢复硬拒
- 实现 liveness 规范读模型：持久记录是生命周期真相源 / 草稿缓存是新鲜度信号 / 进程内 tracker 是控制面状态。四态：活着 / 退化 / 僵尸 / 等待宽限
- 实现弱状态机 vs 强 workflow 边界：开放协作用轻量状态机 / 严肃副作用用强 workflow
- 实现跨 provider 统一宿主抽象：传输 × 绑定 × 运行时契约 × 事件适配器，监管者作为 sidecar
- 实现不可控 vs 可控边界明确

**验收标准**：
- [ ] AC-1: WAL 副作用日志可重放
- [ ] AC-2: Tier 1-4 恢复分级正确触发
- [ ] AC-3: liveness 四态可识别
- [ ] AC-4: 弱状态机 vs 强 workflow 边界清晰
- [ ] AC-5: 跨 provider 宿主抽象可切换
- [ ] AC-6: 不可控 vs 可控边界明确

**代码位置**：`flowforge/core/reliability/`

---

### §3.7 FR-CORE-007 伙伴系统数学（上限提高，下限托底）

> **关联 ADR**：[decisions/011-partnership-math.md](decisions/011-partnership-math.md)
> **roleagent 路径**：路径 7（RA-043~RA-047）
> **优先级**：P0

**输入**：候选路径集合 + 错误传播链
**输出**：上限收益 + 下限保护 + 波动吸收策略

**功能描述**：
- 实现上限公式：`上限收益 ≈ max(不同 agent 提出的候选路径)`（前提是路径足够不同）
- 实现下限公式：`用户可见错误 ≈ author 犯错 × reviewer 没抓住 × 测试没暴露 × shared state 没证据 × eval 没归因 × CVO 没拉闸`（连乘概率模型）
- 实现波动吸收机制：记忆联邦找回 / review 退回 / 可靠性恢复点 / eval sunset review / 调度换路径
- 实现 Token 账本总成本模型：token + 返工成本 + 人类心智负载 + 尾部成本 + 真实环境修复成本
- 实现四种亏结构识别：盲传 / 伪拆分 / 同质化 / 协调税超过收益

**验收标准**：
- [ ] AC-1: 上限公式正确实现（max 而非 avg）
- [ ] AC-2: 下限公式连乘概率模型正确
- [ ] AC-3: 波动吸收 5 种机制全部实现
- [ ] AC-4: Token 账本 5 项成本可采集
- [ ] AC-5: 四种亏结构可识别

**代码位置**：`flowforge/core/partnership/` + `flowforge/loop/partner_math/`

---

### §3.8 FR-CORE-008 forgemind 应用层 + 5 种形态分类

> **关联 Feature**：[features/F026-forgemind-app-layer.md](features/F026-forgemind-app-layer.md) + [features/F027-all-things-spirit-species.md](features/F027-all-things-spirit-species.md)
> **关联 ADR**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md) + [decisions/013-all-things-spirit-mind-vision.md](decisions/013-all-things-spirit-mind-vision.md)
> **优先级**：P0（MVP 必须）

**输入**：灵智体形态定义 + 能力画像
**输出**：可运行的灵智体实例

**功能描述**：
- 实现 forgemind 应用层模块结构（详见 §2.8）
- 实现 ForgekinSpecies 五大形态枚举（BioForgekin / OrgForgekin / ObjForgekin / VirtualForgekin / HybridForgekin）
- 实现 ForgekinBase 抽象基类（observe/act/verify 三方法）
- 实现 ForgeMindPlugin（Plugin V3 四钩子入口）
- 实现预置灵智体 YAML 配置（鲁班=猫头鹰 / 夏洛克=猎犬 / 梵高=孔雀）
- 实现形态可进化（生物灵智体猫可进化为 HybridForgekin）

**验收标准**：
- [ ] AC-1: forgemind 目录结构完整
- [ ] AC-2: ForgekinBase 三方法契约可执行
- [ ] AC-3: 5 种形态灵智体可实例化
- [ ] AC-4: ForgeMindPlugin 注册 4 钩子
- [ ] AC-5: 3 个预置灵智体配置可加载
- [ ] AC-6: 形态可进化（E1 → E6 完整生命周期）

**代码位置**：`flowforge/forgemind/`

---

### §3.9 FR-CORE-009 ForgePipeline 灵智体锻造流水线（6 步）

> **关联 Feature**：[features/F028-forging-pipeline.md](features/F028-forging-pipeline.md)
> **优先级**：P0

**输入**：灵智体形态选择 + 能力需求
**输出**：通过验证的灵智体（觉醒阶 E1+）

**功能描述**：
实现 ForgePipeline 6 步锻造流水线：

| 步骤 | 阶段 | 说明 |
|------|------|------|
| 1 | 形态定义（What to forge） | 确定灵智体形态（生物/组织/物品/虚拟/混合） |
| 2 | 能力注入（Capability injection） | 注入该形态所需能力画像 |
| 3 | 记忆初始化（Memory seeding） | 初始化多域记忆联邦 |
| 4 | 价值观对齐（Value alignment） | 核心价值观不可变 + 表象可变（决策 11） |
| 5 | 能力验证（Capability verification） | 能力基线测试 |
| 6 | 觉醒晋升（Awakening promotion） | E1 灵启 → E6 灵智完整生命周期 |

**验收标准**：
- [ ] AC-1: 6 步流水线可串行执行
- [ ] AC-2: 形态定义支持 5 种形态
- [ ] AC-3: 能力注入基于 CapabilityProfile
- [ ] AC-4: 记忆初始化对接多域记忆联邦
- [ ] AC-5: 价值观对齐核心不可变
- [ ] AC-6: 能力验证基线测试通过
- [ ] AC-7: 觉醒晋升 E1 起步

**代码位置**：`flowforge/forgemind/forging/pipeline.py`

---

### §3.10 FR-CORE-010 三方 Agent 集成（ExternalAgentAdapter 抽象层）

> **关联 Feature**：[features/F031-external-agent-adapter.md](features/F031-external-agent-adapter.md) ~ [features/F035-external-agent-capability-fusion.md](features/F035-external-agent-capability-fusion.md)
> **关联 ADR**：[decisions/006-external-agent-integration.md](decisions/006-external-agent-integration.md)
> **优先级**：P0（MVP 必须）

**输入**：灵智体能力需求 + 三方 Agent 调用请求
**输出**：三方 Agent 执行结果 + 能力融合 + Eval 信号

**功能描述**：
- 实现 ExternalAgentAdapter 抽象层目录结构：
  ```
  flowforge/core/external_agent/
  ├── adapter.py             # ExternalAgentAdapter 抽象类
  ├── bridge.py              # ExternalAgentBridge 桥接层（含 fallback 循环）
  ├── shared_state.py        # ExternalAgentSharedState 状态共享
  ├── fallback.py            # ExternalAgentFallback 失败回退
  ├── capability_fusion.py   # ExternalAgentCapabilityFusion 能力融合
  ├── worktree.py            # worktree 隔离
  ├── sync.py                # 跨 worktree 共享状态同步
  ├── adapters/
  │   ├── claude_code.py     # Claude Code Adapter
  │   ├── codex.py           # Codex Adapter
  │   ├── opencode.py        # OpenCode Adapter
  │   └── trae.py            # Trae Adapter
  ├── guardrails/            # 六层 Guardrails
  │   ├── input_validation.py
  │   ├── system_prompt.py
  │   ├── tool_allowlist.py
  │   ├── output_validation.py
  │   ├── action_confirm.py
  │   └── cost_ceiling.py
  ```
- 实现 4 大机制：Profile（能力画像）/ SharedState（状态共享）/ Fallback（失败回退）/ CapabilityFusion（能力融合）
- 实现 EAC v1 七契约：Invocation / Stream / Session / Capability / Collaboration / Safety / Avatar Sync / System Prompt Configuration Map
- 实现六层 Guardrails
- 实现 worktree 隔离（网络白名单 + 权限控制 + 审计追踪 + 操作回滚）
- 实现调用语义统一（同步/异步/流式/委托）
- 实现全部失败回退到 FlowForge 内置能力

**验收标准**：
- [ ] AC-1: 4 个首批 Adapter（Claude/Codex/OpenCode/Trae）全部实现
- [ ] AC-2: 4 大机制（Profile/SharedState/Fallback/CapabilityFusion）全部实现
- [ ] AC-3: EAC v1 七契约全部实现
- [ ] AC-4: 六层 Guardrails 全部生效
- [ ] AC-5: worktree 隔离 4 项（网络/权限/审计/回滚）全部实现
- [ ] AC-6: fallback 优先级正确（Claude=1/Codex=2/OpenCode=3/Trae=4）
- [ ] AC-7: 全部失败回退到 FlowForge 内置能力

**代码位置**：`flowforge/core/external_agent/`

---

### §3.11 FR-CORE-011 物理 AI 传感器接入（具身智能路径，Embodied AI）

> **关联 Feature**：[features/F029-physical-ai-sensors.md](features/F029-physical-ai-sensors.md)
> **优先级**：P1

**输入**：物理传感器数据流
**输出**：灵智体可感知的环境状态

**功能描述**：
- 实现物理 AI 传感器接入：摄像头 / 麦克风 / IoT 传感器 / 可穿戴设备
- 实现传感器数据预处理（去噪 / 特征提取 / 时序对齐）
- 实现传感器数据 → 灵智体 Observation 的映射
- 实现传感器故障检测与降级
- 对应具身智能工程实现（Embodied AI Engineering）

**验收标准**：
- [ ] AC-1: 4 类传感器（摄像头/麦克风/IoT/可穿戴）可接入
- [ ] AC-2: 数据预处理 pipeline 可运行
- [ ] AC-3: 传感器数据 → Observation 映射正确
- [ ] AC-4: 传感器故障检测可触发降级

**代码位置**：`flowforge/forgemind/sensors/`

---

### §3.12 FR-CORE-012 虚拟世界设定层

> **关联 Feature**：[features/F030-virtual-world-setting.md](features/F030-virtual-world-setting.md)
> **优先级**：P1

**输入**：虚拟角色设定 + 世界观
**输出**：约束灵智体行为的设定层

**功能描述**：
- 实现虚拟世界设定层：童话/神话/历史/现实人物 + VR/游戏角色
- 实现角色设定 + 世界观 + 关系网三元组
- 实现设定层约束（孙悟空遵循西游世界观、福尔摩斯遵循侦探逻辑）
- 实现 VR/游戏世界适配
- 对应虚拟角色智能体工程实现（Character AI Engineering）

**验收标准**：
- [ ] AC-1: 虚拟角色设定可加载
- [ ] AC-2: 世界观约束可注入 system role
- [ ] AC-3: 关系网可查询
- [ ] AC-4: VR/游戏世界适配可运行

**代码位置**：`flowforge/forgemind/worlds/`

---

### §3.13 FR-CORE-013 灵智体市场 + 进化谱系

> **关联 Feature**：[features/F037-forgemind-marketplace.md](features/F037-forgemind-marketplace.md) + [features/F038-forgemind-lineage.md](features/F038-forgemind-lineage.md)
> **优先级**：P1

**输入**：灵智体配置
**输出**：可分享/可追溯的灵智体

**功能描述**：
- 实现灵智体市场（注册 / 发现 / 分享 / 评估）
- 实现进化谱系（家族树 / 谱系可视化 / 谱系追溯）
- 实现灵智体 YAML 配置导出/导入

**验收标准**：
- [ ] AC-1: 灵智体可在市场注册
- [ ] AC-2: 灵智体可被搜索发现
- [ ] AC-3: 进化谱系家族树可可视化
- [ ] AC-4: YAML 配置可导出/导入

**代码位置**：`flowforge/forgemind/marketplace/` + `flowforge/forgemind/lineage/`

---

### §3.14 FR-CORE-014 灵锻 SpiritForge + 灵议 Mind Council

> **关联 Feature**：详见 [design/D030-spirit-forge-mind-council.md](design/D030-spirit-forge-mind-council.md)（待创建）
> **优先级**：P1

**输入**：灵智体经验日志
**输出**：蒸馏技能 + 议事决策

**功能描述**：
- 实现灵锻 SpiritForge（经验蒸馏 / 离线策略学习 / 知识编译）
- 实现灵议 Mind Council（多灵智体议事 / 去中心化共识 / 智能体议会）
- 实现 operator 拉闸词检测（cvo_brake.py）
- 实现灵议多渠道（Web Chat / 飞书 / 微信 / WebChat 升级版）

**验收标准**：
- [ ] AC-1: SpiritForge 可蒸馏经验到锻典
- [ ] AC-2: Mind Council 可议事
- [ ] AC-3: operator 拉闸词可触发
- [ ] AC-4: 多渠道灵议可同步

**代码位置**：`flowforge/forgemind/codex/spirit_forge.py` + `flowforge/forgemind/council/`

---

### §3.15 FR-CORE-015 Plugin V3 四钩子

> **关联 ADR**：[decisions/005-forgemind-application-layer.md](decisions/005-forgemind-application-layer.md)
> **优先级**：P0（MVP 必须）

**输入**：*Forge 插件实现
**输出**：注册到 forgemind 的灵智体 / 技能 / 议事频道 / 灵锻配置

**功能描述**：
实现 Plugin V3 四钩子（在 v6.0 V2 钩子基础上新增）：

```python
class FlowForgePlugin(ABC):
    # ... V2 钩子保留 ...

    # ── V3 Registration hooks（v7.1 新增）─────────────────────────

    def register_forgekins(self, forgekin_registry: Any) -> None:
        """注册灵智体到 forgemind。"""
        pass

    def register_forge_skills(self, skill_registry: Any) -> None:
        """注册灵智体可加载的技能包（SkillPackage）。"""
        pass

    def register_council_channels(self, council_registry: Any) -> None:
        """注册灵议 Mind Council 频道。"""
        pass

    def register_auto_forge_config(self, auto_forge_config: Any) -> None:
        """注册灵锻 SpiritForge 配置。"""
        pass
```

**验收标准**：
- [ ] AC-1: 4 个 V3 钩子可被调用
- [ ] AC-2: V2 钩子保持兼容
- [ ] AC-3: *Forge 可通过 V3 钩子注册灵智体

**代码位置**：`flowforge/core/plugin/protocol.py`（V3 扩展）+ `flowforge/forgemind/plugins.py`

---

### §3.16 FR-CORE-016 ~ FR-CORE-030 其他核心需求

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
| FR-CORE-024 | 灵典 Mind Codex 可检索知识库 | P0 | [F039](features/F039-mind-codex-searchable.md) |
| FR-CORE-025 | 副作用日志 WAL + Tier 1-4 恢复 | P0 | [F021](features/F021-side-effect-wal.md) + [F022](features/F022-tier-1-4-recovery.md) |
| FR-CORE-026 | liveness 规范读模型 | P0 | [F023](features/F023-liveness-canonical-read.md) |
| FR-CORE-027 | 弱状态机 vs 强 workflow | P0 | [F024](features/F024-weak-state-vs-strong-workflow.md) |
| FR-CORE-028 | 跨 provider 宿主抽象 | P1 | [F025](features/F025-provider-host-abstraction.md) |
| FR-CORE-029 | forgemind 与 *Forge 关系 | P1 | [F036](features/F036-forgemind-forge-relationship.md) |
| FR-CORE-030 | Harness Eval 控制面 | P1 | [F040](features/F040-harness-eval-control-plane.md) |

### §3.17 review.md 41 条 CL 同步矩阵

> **来源**：[review/review.md](review/review.md) v1.4 第十三章 clowder-ai 补审 I（CL-001~CL-021，21 项）+ 第十四章 clowder-ai 深度补审 II（CL-022~CL-041，20 项）
> **同步状态**：✅ 已同步 16 项（39.0%）/ 🟡 部分同步 6 项（14.6%）/ ❌ 未同步 19 项（46.4%）

41 条 CL 完整同步矩阵详见 [review/review.md#第十三章](review/review.md) + [review/review.md#第十四章](review/review.md)。本节仅做汇总：

**P0 未同步清单（必修，14 项）**：CL-001 / CL-003 / CL-005 / CL-007 / CL-009 / CL-011 / CL-013 / CL-015 / CL-017 / CL-019 / CL-021 / CL-023 / CL-025 / CL-027

**P1 未同步清单（应修，14 项）**：CL-002 / CL-004 / CL-006 / CL-008 / CL-010 / CL-012 / CL-014 / CL-016 / CL-018 / CL-020 / CL-022 / CL-024 / CL-026 / CL-028

**P2 未同步清单（建议，4 项）**：CL-029 / CL-031 / CL-033 / CL-035

**修复路径与责任分配**：详见 [task.md](task.md) Phase 1-5 分阶段任务。

---

## §4 外部接口

### §4.1 API 接口

> **详细规格**：详见 [arch.md#4.2](arch.md) + [design.md#4.2](design.md)

- 灵智管理 API：`/api/v7/forgekins`（CRUD + 觉醒晋升）
- 灵议 API：`/api/v7/council`（多渠道议事）
- 灵锻 API：`/api/v7/spirit_forge`（经验蒸馏）
- 灵典 API：`/api/v7/codex`（可检索知识库）
- 三方 Agent API：`/api/v7/external_agent`（4 个 Adapter + EAC 七契约）

### §4.2 SDK 接口

> **详细规格**：详见 [arch.md#4.3](arch.md) + [design.md#4.3](design.md)

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
| 路由算法延迟 | < 100ms | 10 个候选灵智体 |
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

- 日志自动注入 trace_id（详见 [hiclaw/rules.md §2.6 原则 8](../../hiclaw/rules.md)）
- 所有 I/O 使用 async/await
- Eval 信号采集（trace 信号 + 用户信号 + 探针信号）
- 七类归因矩阵可分类失败原因
- LLM 调用日志：input + output + execution time（详见 [hiclaw/rules.md §9.3.1](../../hiclaw/rules.md)）

### §5.5 可演进性要求

- 配置驱动率：Phase 0 ≥ 30% / Phase 1 ≥ 60% / Phase 2 ≥ 80%
- 文档分层规范（详见 [hiclaw/rules.md 第十一部分](../../hiclaw/rules.md)）
- 自我演进闭环（详见 §2.10）
- Build to Delete vs Built to Persist 半衰期标记
- ADR 不可变历史（决策变更通过新增 ADR 引用旧 ADR）

### §5.6 测试要求（T1-T8 铁律）

详见 [hiclaw/rules.md §5.5](../../hiclaw/rules.md) 测试铁律 T1-T9。本节强调：
- 禁止 Mock LLM（T1）
- 禁止假数据（T2）
- 禁止跳过验证（T3）
- 禁止 Mock 工具（T4）
- 未实现即 Bug（T5）
- 必须采集指标（T6）
- LLM 内容必须经 LLM 审核（T7）
- Web 功能必须操控浏览器验证 DOM（T8）

---

## §6 历史背景资料

> **声明**：本章节保留 v7.0 / v6.0 历史章节作为背景资料，**不作为开发依据**；开发依据以 §1-§5（v7.1 权威内容）+ ADR/Feature 子目录为准。

### §6.1 v7.0 历史章节（已合并到 v7.1）

> **状态**：✅ v7.0 历史章节已逐章节合并到 v7.1 §1-§5 对应位置；v7.0 完整内容备份在 [`_archive/spec_v70_full_merged.md`](_archive/spec_v70_full_merged.md)，仅作演化路径参考。

**v7.0 → v7.1 合并映射**：

| v7.0 章节 | v7.1 合并位置 | 合并状态 |
|----------|--------------|---------|
| v7.0-§0 万物灵智体世界愿景声明 | v7.1 §2.3 + §2.6 + §2.11 | ✅ 已合并 |
| v7.0-§1 三层架构重构 | v7.1 §2.7 | ✅ 已合并 |
| v7.0-§2 育灵体系命名融合方案 | v7.1 §2.4 + §2.5 + [design/naming-contract.md](design/naming-contract.md) v1.1 | ✅ 已合并 |
| v7.0-§3 roleagent.md 七大工程路径补全 | v7.1 §3.1-§3.7 + [features/F001-F025](features/) | ✅ 已合并 |
| v7.0-§4 forgemind 应用层规格 | v7.1 §2.8 + §3.8-§3.9 + [features/F026-F030](features/) | ✅ 已合并 |
| v7.0-§5 三方 Agent 集成规格 | v7.1 §2.9 + §3.10 + [features/F031-F035](features/) | ✅ 已合并 |
| v7.0-§6 FR-EVO 功能需求重排 | v7.1 §3.1-§3.16（FR-CORE-001~030） | ✅ 已合并 |
| v7.0-§7 验收标准与质量分阈值统一 | v7.1 §5.1 性能要求（SLO） | ✅ 已合并 |
| v7.0-§8 v7.0 MVP 最小可行范围 | v7.1 §3.8 + §3.2 + §3.10 + §3.15（P0 优先级标记） | ✅ 已合并 |
| v7.0-§9 自我演进闭环 | v7.1 §2.10 | ✅ 已合并 |
| v7.0-§10 v7.0 设计态声明 | v7.1 §2.11 | ✅ 已合并 |
| v7.0-§11 文档导航与依赖引用 | v7.1 §1.4 + §1.5 | ✅ 已合并 |

### §6.2 v6.0 历史章节（背景资料）

> **状态**：v6.0 是已实现代码的背景资料，**不在 v7.1 开发范围内**。v6.0 完整内容备份在 [`_archive/spec_v60_historical.md`](_archive/spec_v60_historical.md)。

**v6.0 历史章节摘要**：

| v6.0 章节 | 一句话摘要 | 引用价值 |
|----------|----------|---------|
| v6.0 第一章：产品概述与愿景 | FlowForge v6.0 是 Agent 驾驭层（Harness Layer），核心公式 Agent 质量 = 模型能力 × Harness 契合度 | 已被 v7.1 §2.1 升级 |
| v6.0 第二章：系统架构总览 | 六层架构模型（接口/应用/Brain/Workers/Tools/Infra）+ 控制回路 + Hook 点 | 已被 v7.1 §2.7 升级为三层架构 |
| v6.0 第三章：核心功能需求 | 执行引擎 / Harness 驾驭层 / 能力层 / 多 Agent 策略 / Helm / 插件 / 可观测 / 安全 / SDK | 部分被 v7.1 §3 覆盖，剩余作背景 |
| v6.0 第四章：非功能需求 | 性能 / FeedbackLoop / 可靠性 / 可扩展 / 安全 / 可维护 / Helm 交互 | 已被 v7.1 §5 覆盖 |
| v6.0 第五章：与 ContentForge 的集成方案 | 集成架构 / 业务场景映射 / 迁移路径 / 增量三步 | 已迁移到 ContentForge 项目文档 |
| v6.0 附录 A-N | 配置参考 + 用户旅程 + 失败 UX + KPI + PromptManager + Provider + BaseTool + 可观测 + 跨项目契约 + 配置驱动率 + SLO + 弃用时间线 | 部分已被 v7.1 §4-§5 覆盖 |
| v6.0 审核修订 v2.1/v2.2/v3.0 | 六方联合审核修订增补（S3.0-1 ~ S3.0-42） | 已被 v7.1 §3 覆盖，剩余作背景 |
| v6.0 第十五章：Skill 知识沉淀机制 | SkillKnowledgePrecipitator + 沉淀触发条件 | 部分被 v7.1 §3.14 覆盖 |
| v6.0 StockForge 应用层支持 | StockForge 定位 / 核心能力 / Plugin 注册清单 / 端口分配 | 已迁移到 StockForge 项目文档 |

### §6.3 V7.0 自我进化 Agent Harness 规格升级（背景资料）

> **状态**：v7.0 自我进化部分已合并到 v7.1 §2.10 + §3.14；v7.0 完整内容备份在 [`_archive/spec_v70_self_evolution.md`](_archive/spec_v70_self_evolution.md)。

**v7.0 自我进化部分摘要**：

| v7.0 章节 | 一句话摘要 | 引用价值 |
|----------|----------|---------|
| 第七章：自我进化能力总览 | 核心隐喻"从驾驭到养成" + 体系命名 + 两类智能体设计 + 升华阶段 + 核心能力清单 | 已被 v7.1 §2 升级 |
| 第八章：炉灵（Forgekin）需求规格 | FR-EVO-01~06：身份系统 / 灵忆 / 灵印 / 自锻 / 锻典 / Skill 自生成 | 已被 v7.1 §3 覆盖（重排为 FR-CORE-001~030） |
| 第九章：外部编码工具集成需求 | FR-EVO-07~08：CLI Wrapper / Trae 监工 Bridge | 已被 v7.1 §3.10 升级为 ExternalAgentAdapter |
| 第十章：炉灵协作与 IM 需求 | FR-EVO-09~11：A2A 通信 / 灵议 IM 多渠道 / 两类智能体衔接 | 已被 v7.1 §3.14 覆盖 |
| 第十一章：*Forge 自进化统一规格 | 所有 *Forge 的自进化能力 / 各 *Forge 灵智体角色示例 | 部分作背景 |
| 第十二章：非功能需求与 SLO | 自进化性能 SLO / 安全红线 / 配置驱动率 / 可观测性指标 | 已被 v7.1 §5 覆盖 |
| 第十三章：v7.0 路线图 | 分阶段交付 + 里程碑验收 | 已迁移到 [task.md](task.md) |
| 附录 O：v7.0 与 clowder-ai 方法论对照表 | v7.0 vs clowder-ai 七大工程路径对照 | 作背景参考 |
| 附录 P：v7.0 待用户审核决策点 | 14 项待决策点 | 已在 41 条 CL 同步矩阵中覆盖 |

---

> **本文档版本**：v7.1（2026-07-19）
> **下一阶段**：基于本文档开发 [arch.md](arch.md)（SAD 架构设计说明书），按 [hiclaw/rules.md §11.3](../../hiclaw/rules.md) 三阶段开发流程执行。
> **配套文档**：[arch.md](arch.md) + [design.md](design.md) + [features/](features/) + [architecture/](architecture/) + [design/](design/) + [decisions/](decisions/) + [review/](review/)
