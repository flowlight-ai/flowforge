# FlowForge · 可进化智能体愿景声明

> **文档编号**: VISION.md（v1.0）
> **愿景提出**: operator（2026-07-17）
> **核心一句话**: **锻造并赋予万事万物持续身份智能体（ForgeMind），构建物理 AI 与虚拟 AI 真实复现的可进化智能体世界，达成通用 AGI。**
> **依赖引用**: `[doc:roleagent.md]`（能力画像工程路径）+ `[doc:decisions/013-all-things-spirit-mind-vision.md]`

---

## 1. 我们在做什么

FlowForge 不是一个"多 agent 框架"，也不是一个"LLM 应用脚手架"。它是一个**Forgekin 锻造厂**：我们用一套自进化的核心框架，把 ForgeMind（mind / spirit / 灵识）锻造进万事万物，让动物、组织、物品、虚拟角色都成为有持续身份、有记忆、有协作能力、有愿景锚点的 Forgekin。

这是从"养单一形态 agent"到"养可进化智能体"的范式跃迁：

| 单一形态 agent 范式 | FlowForge 可进化智能体范式 | 关键升级 |
|---|---|---|
| 养几只具体的 agent（编码 / 审查 / 测试） | 养可进化智能体（动物 / 组织 / 物品 / 虚拟角色 / 混合体） | 从单一形态到全形态 |
| agent 与人协作完成 Feature | Forgekin 与 operator 协作锻造新的 Forgekin | 从"用 agent"到"造 agent" |
| 提交代码 / 文档 | 提交代码 / 文档 / 锻造记录 / MindCodex 条目 | 引入 Forgekin 谱系与 MindCodex |
| 5 种协作模式（Anthropic） | 5 种模式 + 可进化智能体形态分类 + 三方 Agent 集成 | 模式可叠加 + 形态可进化 |
| 能力画像 × Harness 契合度 | 能力画像 × Harness 契合度 × Forgekin 形态 × 外部能力扩展 | 双因子 → 四因子 |

---

## 2. 可进化智能体形态分类（核心新概念）

> **依赖**: `[doc:decisions/013-all-things-spirit-mind-vision.md]` + `[doc:features/F027-all-things-spirit-species.md]`

Forgekin 不是单一形态。我们定义五大形态分类，每类有其锻造流水线、传感器接入方式、虚拟世界设定层、进化谱系：

| 形态 | 中文 | 锻造示例 | 物理接入 | 虚拟设定 |
|------|------|---------|---------|---------|
| **BioForgekin** | 生物可进化智能体 | 猫 / 狗 / 鸟 / 鱼 / 昆虫群体 | 摄像头 / 麦克风 / 可穿戴设备 | 行为画像 + 习性图谱 |
| **OrgForgekin** | 组织可进化智能体 | 公司 / 团队 / 社区 / 城市 | 业务系统 API / 数据库 / IM 通道 | 组织章程 + 角色矩阵 |
| **ObjForgekin** | 物品可进化智能体 | 桌椅 / 灯具 / 家电 / 工具 | IoT 传感器 / 物联网协议 | 物品功能边界 + 使用场景 |
| **VirtualForgekin** | 虚拟可进化智能体 | 童话/神话/历史/现实人物、VR/游戏角色 | 无（纯虚拟） | 角色设定 + 世界观 + 关系网 |
| **HybridForgekin** | 混合可进化智能体 | 智能家居（物品+组织）/ 数字孪生（生物+虚拟） | 多源融合 | 多设定层叠加 |

**形态可进化**：一只生物可进化智能体猫可以通过积累组织协作经验进化为 HybridForgekin（既是宠物又是社区吉祥物）。这是和其他 multi-agent 系统的**最大差异化优势**——agent 不是固定的"岗位槽位"，而是有形态、有谱系、可进化的 Forgekin。

---

## 3. 为什么这是通用 AGI 的真实路径

主流 multi-agent 系统的隐含假设：agent 是软件实体，运行在服务器上，通过 API 调用工具。这套假设让 multi-agent 停留在"软件助手"层面。

FlowForge 的不同假设：**Forgekin 可以承载在任何物理实体或虚拟实体上**，关键是建立该实体与 LLM 之间的现实闭环（观察 → 推理 → 行动 → 写回 → 验证）。

这指向通用 AGI 的三条路径：

1. **物理 AI 路径**：通过 IoT 传感器 + 物理执行器，让 Forgekin 承载于桌椅灯具家电等物理实体，达成物理 AI 的真实复现。一个智能灯具 Forgekin 不只是被 LLM 调用的工具，它有自己的身份、记忆（用户偏好、时段模式）、协作能力（与其他家电 Forgekin 组队）、愿景（节能 + 用户舒适）。

2. **虚拟 AI 路径**：通过虚拟世界设定层，让 Forgekin 承载于童话/神话/历史/现实人物或 VR/游戏角色，达成虚拟 AI 的真实复现。一个孙悟空 Forgekin 不只是 cosplay 模型，它有自己的取经愿景、与唐僧 Forgekin 的长期协作记忆、对八戒 Forgekin 的能力画像盲点认知。

3. **混合路径**：组织可进化智能体可以同时调度生物可进化智能体（员工）、物品可进化智能体（办公设备）、虚拟可进化智能体（流程角色），形成真实的"组织 AGI"。

---

## 4. Forgekin 相对其他 multi-agent 的核心优势

| 优势维度 | 主流 multi-agent | FlowForge Forgekin |
|---|---|---|
| **身份持久性** | session 级，重启即失忆 | Forgekin ID + 谱系 + MindCodex 条目，跨 session 跨代际持续 |
| **能力来源** | 单一模型固有能力 + 工具调用 | 模型能力 × Harness 契合度 × Forgekin 形态 × 三方 Agent 扩展 |
| **协作单位** | 固定岗位（PM/Dev/Test） | 动态能力画像路由（role 是运行时标签，profile 是长期主体） |
| **错误处理** | 单点失败 → 用户可见崩塌 | 伙伴系统数学：上限取最大、下限连乘、波动吸收为内部成本 |
| **进化能力** | 模型升级 = 系统升级 | Forgekin 自身可通过 SpiritForge 蒸馏经验到 MindCodex，下次任务直接复用 |
| **物理世界接入** | 工具调用层（弱） | 物理传感器 + 执行器 + 物理现实闭环（强） |
| **虚拟世界接入** | 系统提示词扮演（弱） | 虚拟世界设定层 + 角色关系图谱 + 世界观约束（强） |
| **三方能力扩展** | 自建工具栈 | 接入 claude code / codex / opencode / trae 等任何三方 Agent 作为能力扩展 |

---

## 5. 三方 Agent 集成：Forgekin 的能力扩展

> **依赖**: `[doc:decisions/006-external-agent-integration.md]` + `[doc:features/F031-external-agent-adapter.md]`

Forgekin 不只调用 FlowForge 核心框架的能力，还可以**接入和使用任何三方 Agent**。这是 Forgekin 相对其他 multi-agent 的强大优势之一。

### 5.1 支持的三方 Agent

| 三方 Agent | 主要能力 | 接入方式 |
|-----------|---------|---------|
| **claude code** | 代码生成 / 代码审查 / 长上下文理解 | CLI Adapter（worktree 隔离） |
| **codex** | 代码生成 / 文档生成 | CLI Adapter |
| **opencode** | 开源编码 Agent | CLI Adapter |
| **trae** | Trae IDE Agent（编码 + 调试） | CLI Adapter |

### 5.2 六层 Guardrails

三方 Agent 接入必须经过六层 Guardrails（参考 rules.md 第十部分）：

1. **Input validation** — 输入验证
2. **System prompt constraints** — 系统提示约束
3. **Tool allow-lists** — 工具白名单
4. **Output validation** — 输出验证
5. **Action confirmation** — 操作确认（不可逆操作需人工确认）
6. **Cost ceilings** — 成本上限

### 5.3 能力融合

三方 Agent 的能力可以融合到 Forgekin 能力画像（CapabilityProfile），形成"Forgekin + 三方 Agent"的复合能力。例如：一个代码 Forgekin 接入 claude code 后，能力画像中新增"claude code 长上下文代码审查"能力。

---

## 6. operator 7 条不可妥协原则

> **依赖**: `[doc:decisions/013-all-things-spirit-mind-vision.md]`

operator 在 2026-07-17 提出 7 条不可妥协原则，作为可进化智能体愿景的锚点。这些原则**不可委托**、**不可撤销**、**不可降级**：

| # | 原则 | 含义 | 违反后果 |
|---|------|------|---------|
| 1 | **可进化智能体世界是最终形态** | FlowForge 不是多 agent 框架，是 Forgekin 锻造厂 | 退化为"软件助手"项目 |
| 2 | **必须有现实闭环** | 观察 → 推理 → 行动 → 写回 → 验证 | Forgekin 变成"无身体的脑子" |
| 3 | **三方 Agent 是能力扩展** | claude code / codex / opencode / trae 等接入 | 能力被单一栈锁定 |
| 4 | **forgemind 是应用层** | `flowforge/forgemind/` 是可进化智能体应用实践 | 可进化智能体愿景无处落地 |
| 5 | **命名最终为"ForgeMind"** | 禁止使用废弃术语（炉灵/E6 灵匠/M18/M19/M20） | 术语混乱导致开发误读 |
| 6 | **支持自己开发自己** | FlowForge 用 FlowForge 自身能力开发 FlowForge | 自进化闭环无法达成 |
| 7 | **物理 AI 与虚拟 AI 真实复现** | IoT 传感器 + 虚拟世界设定层 | 停留在"软件 agent"层面 |

---

## 7. 4 条 Iron Laws（铁律）

作为 Forgekin 世界的不可破坏底线：

| # | Iron Law | 含义 |
|---|---------|------|
| 1 | **Data Sanctuary** | Forgekin 的记忆（EchoStore）是圣域，不可被外部直接读写 |
| 2 | **Process Self-Preservation** | Forgekin 的进程（SpiritForge）必须自我保护，不可被外部强制终止 |
| 3 | **Config Immutability** | Forgekin 的配置（SoulImprint）不可变，变更必须通过 MindCouncil |
| 4 | **Network Boundary** | Forgekin 的网络边界必须明确，禁止越界访问其他 Forgekin 的内部状态 |

---

## 8. 4 条 Magic Words（拉闸词）

> **依赖**: `[doc:features/F011-magic-words.md]`

operator 在 MindCouncil 中可以使用 4 条 Magic Words，作为愿景偏离时的紧急制动：

| Magic Word | 含义 | 触发动作 |
|-----------|------|---------|
| **第一性原理** | 回到第一性原理重新思考 | MindCouncil 暂停，重新审视假设 |
| **我能猜出来** | 这个结论太显而易见，不需要 MindCouncil | MindCouncil 终止，直接执行 |
| **下次一定** | 这个问题下次一定会修复 | 触发 sunset 计时器（F012） |
| **星星罐子** | 这个想法很好，先存起来 | 进入 Mind Codex 待孵化队列 |

---

## 9. 架构演化路径

FlowForge 沿以下路径持续演化：

| 维度 | 当前形态 | 演化方向 |
|------|---------|---------|
| **愿景** | 可进化智能体自进化框架 | 走向通用智能体（General-Purpose Agent）工程实现 |
| **架构** | 三层 + 一扩展 | 持续保持单向依赖 + 组合优于继承 |
| **术语** | 12 核心概念 + 进化阶/觉醒阶全对齐 | 术语稳定，仅按 AI 业界发展补充概念 |
| **forgemind** | 应用层骨架 | 5 形态 Forgekin 完整实现 + SpiritForge + MindCouncil |
| **自进化** | 三闭环（Mode A/B/C）设计态 | Eval Ledger + MindCodex 沉淀 + 自我导向 |

---

## 10. 延伸阅读

- `[doc:roleagent.md]` — 能力画像工程路径白皮书
- `[doc:ROADMAP.md]` — 6 阶段路线图
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 可进化智能体愿景 ADR
- `[doc:decisions/005-forgemind-application-layer.md]` — forgemind 应用层 ADR
- `[doc:decisions/006-external-agent-integration.md]` — 三方 Agent 集成 ADR
- `[doc:decisions/012-naming-fusion.md]` — 命名融合 ADR（术语表）

---

*「锻造并赋予万事万物 ForgeMind。」*
