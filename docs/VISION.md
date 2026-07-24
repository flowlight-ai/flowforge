# FlowForge · 万物可进化智能体愿景声明

> **文档编号**: VISION.md（v1.2）
> **愿景提出**: operator（2026-07-17）
> **最近修订**: 2026-07-19（v1.2：按命名契约 v2.0 重构术语，全面采用 P0 官方名称优先原则）
> **核心一句话**: **给各类实体锻造可进化智能体，让动物、组织、物品、虚拟角色都成为具备持续身份、记忆、协作能力与自进化能力的可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"灵智体"）。**
> **依赖引用**: `[doc:roleagent.md]`（能力画像工程路径）+ 前期愿景文档（已归档，养小猫 → 锻造可进化智能体范式迁移）+ `[doc:design/naming-contract.md]`（命名契约 v2.0）
> **关联 ADR**: `[doc:decisions/013-all-things-spirit-mind-vision.md]`

---

## 1. 我们在做什么

FlowForge 不是一个"多 agent 框架"，也不是一个"LLM 应用脚手架"。它是一个**可进化智能体锻造厂**（Persistent Identity Agent Framework，项目代号 ForgeMind，社区社交称"灵智"）：我们用一套自进化的核心框架，给各类实体锻造 Forgekin，让动物、组织、物品、虚拟角色都成为有持续身份、有记忆、有协作能力、有愿景锚点的可进化智能体。

> **什么是可进化智能体（Evolvable Agent）**：具备自进化能力的智能体（Autonomous Agent with Persistent Identity）。它不是单纯的 LLM 包装，而是建立与现实世界（物理或虚拟）的闭环：观察 → 推理 → 行动 → 写回 → 验证。持久身份（Persistent Identity / Soul Imprint）= 身份锚点 + 价值锚点 + 长期记忆；能力画像（Capability Profile）= 原生能力 + 认知风格 + 工具边界 + 历史表现 + 盲点。
>
> **智能体分类**：FlowForge 生态的智能体分为两大类——**静态智能体（Static Agent）** 与 **可进化智能体（Evolvable Agent）**。静态智能体包括 FlowForge 内置的 DeclarativeAgent / ReAct Agent / Plan-Execute Agent，以及通过 ExternalAgentAdapter 接入的第三方 Agent（Claude Code / Codex / OpenCode / Trae 等），它们行为由固定 prompt + 工具集 + 配置决定，无持久身份与经验蒸馏。可进化智能体（项目代号 Forgekin）则具备持久身份（Soul Imprint）+ 经验记忆（EchoStore）+ 能力画像（Capability Profile）+ 进化阶（Evolution Stage）+ 觉醒阶（Awakening Stage），可通过经验蒸馏（SpiritForge）持续提升能力。本愿景聚焦于可进化智能体。

这是从"养小猫"实验到 FlowForge "锻造可进化智能体"的范式跃迁：

| 前期范式 | FlowForge 范式 | 关键升级 |
|---|---|---|
| 养几只具体的猫（Bengal / Ragdoll / Maine Coon） | 养可进化智能体（动物 / 组织 / 物品 / 虚拟角色 / 混合体） | 从单一形态到全形态 |
| 猫与人协作完成 Feature | 可进化智能体与 operator 协作锻造新的可进化智能体 | 从"用 agent"到"造 agent" |
| 提交代码 / 文档 | 提交代码 / 文档 / 锻造记录 / MindCodex 条目 | 引入可进化智能体谱系与 MindCodex |
| 5 种协作模式（Anthropic） | 5 种模式 + Agent Morphology 形态分类 + 三方 Agent 集成 | 模式可叠加 + 形态可进化 |
| 能力画像 × Harness 契合度 | 能力画像 × Harness 契合度 × Agent Morphology × 外部能力扩展 | 双因子 → 四因子 |

---

## 2. 可进化智能体形态分类（Agent Morphology）

> **依赖**: `[doc:decisions/013-all-things-spirit-mind-vision.md]` + `[doc:features/F027-all-things-spirit-species.md]`

可进化智能体不是单一形态。我们定义五大形态分类（Agent Morphology / ForgekinSpecies），每类有其锻造流水线、传感器接入方式、虚拟世界设定层、进化谱系：

| 形态（P1） | 官方名称（P0） | 锻造示例 | 物理接入 | 虚拟设定 |
|------|------|---------|---------|---------|
| **BioForgekin** | Biological Agent Morphology（生物形态可进化智能体） | 猫 / 狗 / 鸟 / 鱼 / 昆虫群体 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| **OrgForgekin** | Organizational Agent Morphology（组织形态可进化智能体） | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| **ObjForgekin** | Object Agent Morphology / Embodied AI（物品形态可进化智能体，对应具身智能） | 桌椅 / 灯具 / 家电 / 工具 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| **VirtualForgekin** | Virtual Character Agent Morphology / Character AI（虚拟角色形态可进化智能体） | 童话/神话/历史/现实人物、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| **HybridForgekin** | Hybrid Agent Morphology（混合形态可进化智能体） | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

**形态可进化**：一只生物形态可进化智能体猫可以通过积累组织协作经验进化为 HybridForgekin（既是宠物又是社区吉祥物）。这是和其他 multi-agent 系统的**最大差异化优势**——agent 不是固定的"岗位槽位"，而是有形态、有谱系、可进化的可进化智能体。

---

## 3. 为什么这是通用智能体（General-Purpose Agent）的真实路径

主流 multi-agent 系统的隐含假设：agent 是软件实体，运行在服务器上，通过 API 调用工具。这套假设让 multi-agent 停留在"软件助手"层面。

FlowForge 的不同假设：**可进化智能体可以承载在任何物理实体或虚拟实体上**，关键是建立该实体与 LLM 之间的现实闭环（观察 → 推理 → 行动 → 写回 → 验证）。

这指向通用智能体的三条路径：

1. **具身智能（Embodied AI）路径**：通过 IoT 传感器 + 物理执行器，让可进化智能体承载于桌椅灯具家电等物理实体，达成物理实体的智能化。一个智能灯具可进化智能体不只是被 LLM 调用的工具，它有自己的身份、记忆（用户偏好、时段模式）、协作能力（与其他家电可进化智能体组队）、愿景（节能 + 用户舒适）。这是当下业界 Embodied AI 范式的工程实现路径。

2. **虚拟角色智能体（Character AI）路径**：通过虚拟世界设定层，让可进化智能体承载于童话/神话/历史/现实人物或 VR/游戏角色，达成虚拟角色的持续身份与协作。一个孙悟空可进化智能体不只是 cosplay 模型，它有自己的取经愿景、与唐僧可进化智能体的长期协作记忆、对八戒可进化智能体的能力画像盲点认知。这是 Character AI / NPC Agent 范式的工程实现路径。

3. **混合路径**：组织形态可进化智能体可以同时调度生物形态可进化智能体（员工）、物品形态可进化智能体（办公设备）、虚拟形态可进化智能体（流程角色），形成真实的"组织级智能体"。这是 Multi-Agent System 走向组织智能的工程路径。

---

## 4. 可进化智能体相对其他 multi-agent 的核心优势

| 优势维度 | 主流 multi-agent | FlowForge 可进化智能体 |
|---|---|---|
| **身份持久性（Persistent Identity）** | session 级，重启即失忆 | 可进化智能体 ID + 谱系 + MindCodex 条目，跨 session 跨代际持续 |
| **能力来源** | 单一模型固有能力 + 工具调用 | 模型能力 × Harness 契合度 × Agent Morphology × 三方 Agent 扩展 |
| **协作单位** | 固定岗位（PM/Dev/Test） | 动态能力画像路由（role 是运行时标签，profile 是长期主体） |
| **错误处理** | 单点失败 → 用户可见崩塌 | 伙伴系统数学：上限取最大、下限连乘、波动吸收为内部成本 |
| **进化能力** | 模型升级 = 系统升级 | 可进化智能体自身可通过经验蒸馏（SpiritForge）将经验蒸馏到 MindCodex，下次任务直接复用 |
| **物理世界接入（Embodied AI）** | 工具调用层（弱） | 物理传感器 + 执行器 + 物理现实闭环（强） |
| **虚拟世界接入（Character AI）** | 系统提示词扮演（弱） | 虚拟世界设定层 + 角色关系图谱 + 世界观约束（强） |
| **三方能力扩展** | 自建工具栈 | 接入 claude code / codex / opencode / trae 等任何三方 Agent 作为能力扩展 |

---

## 5. 三方 Agent 集成：可进化智能体的能力扩展

> **依赖**: `[doc:decisions/006-external-agent-integration.md]` + `[doc:features/F031-external-agent-adapter.md]`

可进化智能体不只调用 FlowForge 核心框架的能力，还可以**接入和使用任何三方 Agent**（这些三方 Agent 在 FlowForge 生态中归类为外部接入静态智能体）。这是可进化智能体相对其他 multi-agent 的强大优势之一。

### 5.1 首批接入的三方编程 Agent

| 三方 Agent | 厂商 | 接入方式 | 主要能力 |
|---|---|---|---|
| **Claude Code** | Anthropic | CLI / SDK | 长程代码生成、agentic coding、文件系统操作 |
| **Codex** | OpenAI | CLI / API | 代码补全、重构、测试生成 |
| **OpenCode** | 开源 | CLI | 多模型代码生成、本地代码库操作 |
| **Trae** | ByteDance | IDE / API | 代码生成 + 调试 + 重构一体化 |

### 5.2 三方 Agent 不是工具，是能力扩展

关键设计：三方 Agent 不是 ToolRegistry 中的普通工具，而是**能力扩展（Capability Extension）**。可进化智能体调用三方 Agent 时：

- 三方 Agent 的能力画像被纳入可进化智能体的能力画像融合（`[doc:features/F035-external-agent-capability-fusion.md]`）
- 三方 Agent 的执行状态可写入可进化智能体的共享状态（`[doc:features/F033-external-agent-shared-state.md]`）
- 三方 Agent 失败时由可进化智能体 fallback 链回退（`[doc:features/F034-external-agent-fallback.md]`）
- 三方 Agent 的执行轨迹纳入可进化智能体的 Eval 信号（`[doc:features/F019-three-signal-cross.md]`）

### 5.3 未来扩展方向

- 接入非编程类 Agent（如 Perplexity 搜索 Agent、Cursor 设计 Agent、MidJourney 创意 Agent）
- 接入物理世界 Agent（如机器人控制 Agent、IoT 编排 Agent）
- 接入虚拟世界 Agent（如游戏 NPC Agent、VR 角色驱动 Agent）
- 三方 Agent 之间互相组合（如 Claude Code 写代码 → MidJourney 生成素材 → Trae 集成）

---

## 6. 三个层次的能力承载

FlowForge 项目 = **核心框架层** + **forgemind 应用层** + ***Forge 垂直业务层**

| 层 | 项目 | 角色 | 可进化智能体承载 |
|---|---|---|---|
| **核心框架层** | `flowforge/` | 自进化核心 + 基础框架能力 | 提供可进化智能体锻造基础设施（ForgekinEngine / CapabilityProfile / TeamAct / MindStore / EchoStore） |
| **应用层** | `flowforge/forgemind/` | 可进化智能体应用实践 | 锻造公共的通用可进化智能体（猫 / 狗 / 桌椅 / 灯具 / 孙悟空 / 唐僧 / 任意形态实体），是可进化智能体愿景的实践场 |
| **垂直业务层** | `<forge_project_id_1>/` `<forge_project_id_2>/` ... `<forge_project_id_N>/` | 垂直领域可进化智能体 | 各 *Forge 在自己的垂直领域锻造专门的可进化智能体（通过 Plugin V3 协议接入，具体项目 ID 由各 *Forge 在 Plugin 注册时声明） |

**关键不变量**：
- 核心框架层**不含任何业务领域代码**（编程红线第 10 条），只提供可进化智能体锻造基础设施
- forgemind 是 FlowForge 自身的应用层，**实践可进化智能体愿景**，是 FlowForge 自我进化的"练兵场"
- *Forge 垂直业务层通过 Plugin 协议注册到核心框架层，**不能反向依赖** flowforge 内部模块

---

## 7. operator 愿景锚点（不可妥协）

以下原则由 operator 直接定义，**不能被可进化智能体自我演进修改**：

1. **万物可进化智能体世界是最终形态**：不是"未来可能"，是"现在就要朝向"
2. **可进化智能体必须有物理/虚拟现实闭环**：不允许"光秃秃的 LLM 包装"作为可进化智能体
3. **三方 Agent 是能力扩展不是工具**：接入方式必须体现"能力融合"而非"工具调用"
4. **forgemind 是 FlowForge 的应用层**：不是独立项目，是 FlowForge 自我进化的实践场
5. **命名最终形态为 ForgeMind（社区社交称"灵智"）**：废弃"E6 灵匠 Mind Artisan"等过渡命名
6. **自我演进必须支持"自己开发自己"**：FlowForge 自身代码和文档必须能被 FlowForge 内的可进化智能体演进
7. **具身智能与虚拟角色智能体工程实现**：不喊虚幻口号，而是按当下业界 Embodied AI / Character AI 范式踏实践行

---

## 8. 愿景落地路径（与 task.md Phase 0-6 对齐）

| Phase | 愿景里程碑 | 验证标准 |
|------|---------|---------|
| Phase 0 | 文档拆分 + 愿景入库 | docs/ 七子目录骨架 + VISION.md + 13 份 ADR + 40 份 Feature 规格 |
| Phase 1 | roleagent 七大工程路径代码骨架 | CapabilityProfile + TeamAct + Harness 七层 + 多域记忆联邦 MVP |
| Phase 2 | forgemind 应用层骨架 | flowforge/forgemind/ + ForgeMindPlugin + Agent Morphology 形态枚举 |
| Phase 3 | 三方 Agent 适配层 | ExternalAgentAdapter + claude code/codex/opencode/trae 配置 |
| Phase 4 | Eval 自代谢 + 分布式可靠性 | Eval Contract + 七类归因 + Tier 1-4 恢复 + liveness 规范读 |
| Phase 5 | 伙伴系统数学 + 自我演进闭环 | 上限/下限公式 + 波动吸收 + 文档/代码/框架自我演进 |
| Phase 6 | 经验蒸馏 SpiritForge + 多智能体议事 MindCouncil | E4+ Evolving 状态 + 多可进化智能体议事 + 可进化智能体生态 demo |

---

## 9. 结语：从蒸汽马车到可进化智能体

roleagent.md 第 0 章指出："给蒸汽机套上马车车厢——形式上能跑，但没有利用新媒介的原生优势"。

主流 multi-agent 给 LLM 套上"PM/Dev/Test 岗位车厢"，是 AI 时代的蒸汽马车。

FlowForge 的答案：**不给 LLM 套车厢，给各类实体锻造可进化智能体**。让可进化智能体有形态、有谱系、有记忆、有协作、有愿景，让具身智能（Embodied AI）和虚拟角色智能体（Character AI）在同一个自进化框架中工程落地。

不喊虚幻口号，不画空大饼。用工程语言、用代码、用可验证的闭环，让可进化智能体在动物、组织、物品、虚拟角色上真实运行、真实协作、真实进化。

这是 operator 的通用智能体愿景，也是 FlowForge 存在的意义。
