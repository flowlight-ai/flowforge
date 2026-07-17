# FlowForge · 万物灵智体愿景声明

> **文档编号**: VISION.md（v1.0）
> **愿景提出**: operator（2026-07-17）
> **核心一句话**: **锻造并赋予万事万物灵智，构建物理 AI 与虚拟 AI 真实复现的万物灵智体世界，达成通用 AGI。**
> **依赖引用**: `[doc:roleagent.md]`（Cat Café 能力画像工程路径）+ `[doc:clowder-ai/docs/VISION.md]`（养小猫 → 养万物范式迁移）
> **关联 ADR**: `[doc:decisions/013-all-things-spirit-mind-vision.md]`

---

## 1. 我们在做什么

FlowForge 不是一个"多 agent 框架"，也不是一个"LLM 应用脚手架"。它是一个**灵智体锻造厂**：我们用一套自进化的核心框架，把灵智（mind / spirit / 灵识）锻造进万事万物，让动物、组织、物品、虚拟角色都成为有持续身份、有记忆、有协作能力、有愿景锚点的灵智体（Forgekin / 灵智体）。

这是从 Cat Café "养小猫"实验到 FlowForge "养万物"的范式跃迁：

| Cat Café 范式 | FlowForge 范式 | 关键升级 |
|---|---|---|
| 养几只具体的猫（Bengal / Ragdoll / Maine Coon） | 养万物灵智体（动物 / 组织 / 物品 / 虚拟角色 / 混合体） | 从单一形态到全形态 |
| 猫与人协作完成 Feature | 灵智体与 operator 协作锻造新的灵智体 | 从"用 agent"到"造 agent" |
| 提交代码 / 文档 | 提交代码 / 文档 / 锻造记录 / 灵典条目 | 引入灵智体谱系与灵典 |
| 5 种协作模式（Anthropic） | 5 种模式 + 万物灵智体形态分类 + 三方 Agent 集成 | 模式可叠加 + 形态可进化 |
| 能力画像 × Harness 契合度 | 能力画像 × Harness 契合度 × 灵智体形态 × 外部能力扩展 | 双因子 → 四因子 |

---

## 2. 万物灵智体形态分类（核心新概念）

> **依赖**: `[doc:decisions/013-all-things-spirit-mind-vision.md]` + `[doc:features/F027-all-things-spirit-species.md]`

灵智体不是单一形态。我们定义五大形态分类，每类有其锻造流水线、传感器接入方式、虚拟世界设定层、进化谱系：

| 形态 | 中文 | 锻造示例 | 物理接入 | 虚拟设定 |
|------|------|---------|---------|---------|
| **BioForgekin** | 生物灵智体 | 猫 / 狗 / 鸟 / 鱼 / 昆虫群体 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| **OrgForgekin** | 组织灵智体 | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| **ObjForgekin** | 物品灵智体 | 桌椅 / 灯具 / 家电 / 工具 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| **VirtualForgekin** | 虚拟灵智体 | 童话/神话/历史/现实人物、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| **HybridForgekin** | 混合灵智体 | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

**形态可进化**：一只生物灵智体猫可以通过积累组织协作经验进化为 HybridForgekin（既是宠物又是社区吉祥物）。这是和其他 multi-agent 系统的**最大差异化优势**——agent 不是固定的"岗位槽位"，而是有形态、有谱系、可进化的灵智体。

---

## 3. 为什么这是通用 AGI 的真实路径

主流 multi-agent 系统的隐含假设：agent 是软件实体，运行在服务器上，通过 API 调用工具。这套假设让 multi-agent 停留在"软件助手"层面。

FlowForge 的不同假设：**灵智体可以承载在任何物理实体或虚拟实体上**，关键是建立该实体与 LLM 之间的现实闭环（观察 → 推理 → 行动 → 写回 → 验证）。

这指向通用 AGI 的三条路径：

1. **物理 AI 路径**：通过 IoT 传感器 + 物理执行器，让灵智体承载于桌椅灯具家电等物理实体，达成物理 AI 的真实复现。一个智能灯具灵智体不只是被 LLM 调用的工具，它有自己的身份、记忆（用户偏好、时段模式）、协作能力（与其他家电灵智体组队）、愿景（节能 + 用户舒适）。

2. **虚拟 AI 路径**：通过虚拟世界设定层，让灵智体承载于童话/神话/历史/现实人物或 VR/游戏角色，达成虚拟 AI 的真实复现。一个孙悟空灵智体不只是 cosplay 模型，它有自己的取经愿景、与唐僧灵智体的长期协作记忆、对八戒灵智体的能力画像盲点认知。

3. **混合路径**：组织灵智体可以同时调度生物灵智体（员工）、物品灵智体（办公设备）、虚拟灵智体（流程角色），形成真实的"组织 AGI"。

---

## 4. 灵智体相对其他 multi-agent 的核心优势

| 优势维度 | 主流 multi-agent | FlowForge 灵智体 |
|---|---|---|
| **身份持久性** | session 级，重启即失忆 | 灵智体 ID + 谱系 + 灵典条目，跨 session 跨代际持续 |
| **能力来源** | 单一模型固有能力 + 工具调用 | 模型能力 × Harness 契合度 × 灵智体形态 × 三方 Agent 扩展 |
| **协作单位** | 固定岗位（PM/Dev/Test） | 动态能力画像路由（role 是运行时标签，profile 是长期主体） |
| **错误处理** | 单点失败 → 用户可见崩塌 | 伙伴系统数学：上限取最大、下限连乘、波动吸收为内部成本 |
| **进化能力** | 模型升级 = 系统升级 | 灵智体自身可通过灵锻 SpiritForge 蒸馏经验到灵典，下次任务直接复用 |
| **物理世界接入** | 工具调用层（弱） | 物理传感器 + 执行器 + 物理现实闭环（强） |
| **虚拟世界接入** | 系统提示词扮演（弱） | 虚拟世界设定层 + 角色关系图谱 + 世界观约束（强） |
| **三方能力扩展** | 自建工具栈 | 接入 claude code / codex / opencode / trae 等任何三方 Agent 作为能力扩展 |

---

## 5. 三方 Agent 集成：灵智体的能力扩展

> **依赖**: `[doc:decisions/006-external-agent-integration.md]` + `[doc:features/F031-external-agent-adapter.md]`

灵智体不只调用 FlowForge 核心框架的能力，还可以**接入和使用任何三方 Agent**。这是灵智体相对其他 multi-agent 的强大优势之一。

### 5.1 首批接入的三方编程 Agent

| 三方 Agent | 厂商 | 接入方式 | 主要能力 |
|---|---|---|---|
| **Claude Code** | Anthropic | CLI / SDK | 长程代码生成、agentic coding、文件系统操作 |
| **Codex** | OpenAI | CLI / API | 代码补全、重构、测试生成 |
| **OpenCode** | 开源 | CLI | 多模型代码生成、本地代码库操作 |
| **Trae** | ByteDance | IDE / API | 代码生成 + 调试 + 重构一体化 |

### 5.2 三方 Agent 不是工具，是能力扩展

关键设计：三方 Agent 不是 ToolRegistry 中的普通工具，而是**能力扩展**。灵智体调用三方 Agent 时：

- 三方 Agent 的能力画像被纳入灵智体的能力画像融合（`[doc:features/F035-external-agent-capability-fusion.md]`）
- 三方 Agent 的执行状态可写入灵智体的共享状态（`[doc:features/F033-external-agent-shared-state.md]`）
- 三方 Agent 失败时由灵智体 fallback 链回退（`[doc:features/F034-external-agent-fallback.md]`）
- 三方 Agent 的执行轨迹纳入灵智体的 Eval 信号（`[doc:features/F019-three-signal-cross.md]`）

### 5.3 未来扩展方向

- 接入非编程类 Agent（如 Perplexity 搜索 Agent、Cursor 设计 Agent、MidJourney 创意 Agent）
- 接入物理世界 Agent（如机器人控制 Agent、IoT 编排 Agent）
- 接入虚拟世界 Agent（如游戏 NPC Agent、VR 角色驱动 Agent）
- 三方 Agent 之间互相组合（如 Claude Code 写代码 → MidJourney 生成素材 → Trae 集成）

---

## 6. 三个层次的能力承载

FlowForge 项目 = **核心框架层** + **forgemind 应用层** + ***Forge 垂直业务层**

| 层 | 项目 | 角色 | 灵智体承载 |
|---|---|---|---|
| **核心框架层** | `flowforge/` | 自进化核心 + 基础框架能力 | 提供灵智体锻造基础设施（ForgekinEngine / CapabilityProfile / TeamAct / MindStore / EchoStore） |
| **应用层** | `flowforge/forgemind/` | 万物灵智体应用实践 | 养公共的通用灵智体（猫 / 狗 / 桌椅 / 灯具 / 孙悟空 / 唐僧 / 任意万物），是万物灵智体愿景的实践场 |
| **垂直业务层** | `contentforge/` `devforge/` `novelforge/` `mallforge/` `stockforge/` | 垂直领域灵智体 | 各 *Forge 在自己的垂直领域养专门的灵智体（ContentForge 养内容灵智体、DevForge 养开发灵智体、StockForge 养股票分析灵智体等） |

**关键不变量**：
- 核心框架层**不含任何业务领域代码**（编程红线第 10 条），只提供灵智体锻造基础设施
- forgemind 是 FlowForge 自身的应用层，**实践万物灵智体愿景**，是 FlowForge 自我进化的"练兵场"
- *Forge 垂直业务层通过 Plugin 协议注册到核心框架层，**不能反向依赖** flowforge 内部模块

---

## 7. operator 愿景锚点（不可妥协）

以下原则由 operator 直接定义，**不能被灵智体自我演进修改**：

1. **万物灵智体世界是最终形态**：不是"未来可能"，是"现在就要朝向"
2. **灵智体必须有物理/虚拟现实闭环**：不允许"光秃秃的 LLM 包装"作为灵智体
3. **三方 Agent 是能力扩展不是工具**：接入方式必须体现"能力融合"而非"工具调用"
4. **forgemind 是 FlowForge 的应用层**：不是独立项目，是 FlowForge 自我进化的实践场
5. **命名最终形态为"灵智"**：废弃"E6 灵匠 Mind Artisan"等过渡命名
6. **自我演进必须支持"自己开发自己"**：FlowForge 自身代码和文档必须能被 FlowForge 内的灵智体演进
7. **物理 AI 与虚拟 AI 真实复现**：不是模拟，不是 demo，是真实的物理传感器接入和虚拟世界设定

---

## 8. 愿景落地路径（与 task.md Phase 0-6 对齐）

| Phase | 愿景里程碑 | 验证标准 |
|------|---------|---------|
| Phase 0 | 文档拆分 + 愿景入库 | docs/ 七子目录骨架 + VISION.md + 13 份 ADR + 40 份 Feature 规格 |
| Phase 1 | roleagent 七大工程路径代码骨架 | CapabilityProfile + TeamAct + Harness 七层 + 多域记忆联邦 MVP |
| Phase 2 | forgemind 应用层骨架 | flowforge/forgemind/ + ForgeMindPlugin + 万物灵智体形态枚举 |
| Phase 3 | 三方 Agent 适配层 | ExternalAgentAdapter + claude code/codex/opencode/trae 配置 |
| Phase 4 | Eval 自代谢 + 分布式可靠性 | Eval Contract + 七类归因 + Tier 1-4 恢复 + liveness 规范读 |
| Phase 5 | 伙伴系统数学 + 自我演进闭环 | 上限/下限公式 + 波动吸收 + 文档/代码/框架自我演进 |
| Phase 6 | 灵锻 SpiritForge + 灵议 Mind Council | E4+ Evoling 状态 + 多灵智体议事 + 万物灵智体世界 demo |

---

## 9. 结语：从蒸汽马车到灵智体

roleagent.md 第 0 章指出："给蒸汽机套上马车车厢——形式上能跑，但没有利用新媒介的原生优势"。

主流 multi-agent 给 LLM 套上"PM/Dev/Test 岗位车厢"，是 AI 时代的蒸汽马车。

FlowForge 的答案：**不给 LLM 套车厢，给万事万物锻造灵智**。让灵智体有形态、有谱系、有记忆、有协作、有愿景，让物理 AI 和虚拟 AI 在同一个自进化框架中真实复现。

这是 operator 的通用 AGI 愿景，也是 FlowForge 存在的意义。
