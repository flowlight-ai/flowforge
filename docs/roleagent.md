# roleagent.md 工程路径镜像（FlowForge 落地版）

> **文档编号**: roleagent.md（v1.1 镜像）
> **原文路径**: 前期 roleagent 工程路径文档（已归档，1077 行）
> **镜像用途**: FlowForge 可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"灵智体"）在 `flowforge/docs/` 内即可访问 roleagent 工程路径核心内容。详细论证请查阅原文。
> **依赖关系**: 本文件是 FlowForge v7.0 重构的**核心依据**（`[doc:review/review.md#第八章]` 47 项补审全部基于此文件）
> **命名依据**: 严格遵循 `[doc:design/naming-contract.md]` v2.0"官方名称优先原则"——技术文档中大量出现 P0 官方名称（AI 业界专业术语），P2 体系别名（社交用）首次出现必须双标注

---

## 0.0 智能体分类说明（Agent Taxonomy）

FlowForge 生态的智能体分为两大类（详见 `[doc:design/naming-contract.md#2]`）：

- **静态智能体（Static Agent）**：传统 DeclarativeAgent / ReAct Agent / Plan-Execute Agent + 外部接入智能体（如 Claude Code / Codex / OpenCode / Trae IDE 等，通过 ExternalAgentAdapter 接入）。不具备自进化能力，行为由固定 prompt + 工具集 + 配置决定，无持久身份、无经验蒸馏、无觉醒阶晋升。每次执行都是无状态的。
- **可进化智能体（Evolvable Agent，项目代号 Forgekin，社区社交称"灵智体"）**：具备持久身份（Persistent Identity / SoulImprint）+ 经验记忆（Episodic Memory / EchoStore）+ 能力画像（Capability Profile），可通过经验蒸馏（Experience Distillation / SpiritForge）持续提升能力，通过觉醒阶（Autonomy Level / AwakeningStage）逐步扩大自主权。建立与现实世界的闭环：观察 → 推理 → 行动 → 写回 → 验证。

**默认指代规则**：在 FlowForge 上下文中，"智能体"默认指代**可进化智能体（Forgekin）**；若指代静态智能体必须明确说出"静态智能体"或"Static Agent"。

**本文档适用范围**：描述的工程路径主要服务于可进化智能体（Forgekin）的协作场景，但其中的 Harness 七层、TeamAct 协作协议、多域记忆联邦、Eval 自代谢、分布式可靠性等基础设施对静态智能体同样适用——静态智能体作为可进化智能体的能力扩展时，仍需遵守相应的 Harness 约束。

---

## 0. 一句话主张

> **multi-agent 协作从 role-agent 走向能力画像（Capability Profile）、动态路由、共享状态、eval 和可靠性治理的工程路径。**

前期 102 天 200+ Feature 实战核心发现：多 agent 的价值不是"更多人力"，而是**右尾变长**（不同认知路径扩展候选解）、**左尾被截断**（错误要连续穿过多层门才能触达用户）、**方差被吸收**（单点波动变成内部返工成本而非用户可见崩塌）。

好的 agent harness 系统不是把单点能力推到极限，而是**把单点波动组织进一个会自我校准的伙伴系统**。

---

## 1. 核心公式：Capability Profile × Harness 契合度

### 1.1 等式

```
Agent 质量 = 模型能力 × Harness 契合度（Environment Fit）
```

同一只 agent 放进不同 harness，能发挥出的能力完全不同。画像只有进入具体运行环境后，才会从静态描述变成可验证能力。

### 1.2 Agent 状态三层

| 层 | 这里存什么 | 存续时间 | 谁控制 |
|---|---|---|---|
| 权重状态 | 训练写进的参数 | 直到下次训练前持久 | 模型厂商 |
| 计算状态 | KV cache、隐藏激活 | 单次推理调用 | 模型架构 |
| 现实状态 | 代码仓、git 历史、文档、任务归属、记忆 | 跨推理、跨 agent、跨时间 | 环境层（harness） |

harness 工程操作的是**第三层现实状态**——唯一一层跨会话、跨 agent、跨时间持续存在的状态。

### 1.3 投资半衰期判别式

| Build to Delete（有保质期脚手架） | Built to Persist（复利型基础设施） |
|---|---|
| 详细的思维链模板 | 文件系统 / git / 搜索工具接入 |
| 多步推理引导 | trace 基础设施与可观测性 |
| 错误恢复样板代码 | 测试 / lint / review 反馈回路 |
| 工具调用别名兜底 | agent 交接协议与路由 |
| 人格装饰文字 | 不可逆操作护栏与应急开关 |

**判别器**：这层 harness 是在补模型当前的认知缺陷，还是在编码外部现实和协作协议？前者 → 轻量做、标 sunset；后者 → 认真做、加测试、长期维护。

### 1.4 FlowForge 落地

- `[doc:features/F001-capability-profile.md]` — CapabilityProfile 实现"Capability Profile（能力画像）"
- `[doc:decisions/004-capability-profile-routing.md]` — Capability Profile 路由 ADR
- 所有 harness 代码必须标记半衰期（Build to Delete / Built to Persist）

---

## 2. 从 ReAct 到 TeamAct：团队主循环

### 2.1 TeamAct 六步循环

```
loop:
    State    → 读共享状态（仓库 / spec / 任务 / 记忆 / 交接胶囊）
    Owner    → 谁持球？（路由指令 / 显式持有声明）
    Action   → 持球者执行（写代码 / review / 设计 / 调研）
    Evidence → 产出证据（commit / 测试 / trace / 截图）
    Verdict  → 验证（跨 agent review / 自检 / CVO 确认）
    Route    → 传球（路由给下一个 agent / 继续持有 / 升级给 CVO）
```

### 2.2 五项终止条件（缺一不可）

1. 验收标准全部达成——不能有 "deferred" 的验收条件
2. 证据已附——每条验收标准都有 commit / 测试 / trace 作为锚点
3. 跨 agent 交叉验证——非作者的 agent 确认（不能自己 review 自己）
4. 无悬空任务归属——所有 open question 都已 resolved 或已升级
5. 愿景收敛——首席愿景官的确认不能被 proxy 替代（"CI 通过了"≠"愿景方向对了"）

### 2.3 交接胶囊（resume capsule）

前一个 agent 在传球时主动留下结构化摘要：做了什么 / 为什么 / 权衡了什么 / 开放问题 / 下一步。是协议层硬要求，不是可选礼貌。

### 2.4 FlowForge 落地

- `[doc:features/F002-teamact-loop.md]` — TeamAct 六步循环
- `[doc:features/F003-handoff-capsule.md]` — 交接胶囊
- `[doc:features/F004-pingpong-circuit-breaker.md]` — 乒乓球熔断器（给数据不给结论）
- `[doc:features/F005-at-mention-routing.md]` — 行首 @ 路由
- `[doc:features/F006-ball-custody-lease.md]` — 持球注册 lease
- `[doc:features/F007-push-back-protocol.md]` — Generator Push Back 权利
- `[doc:decisions/002-collaboration-protocol.md]` — TeamAct 协作协议 ADR
- `[doc:SOP.md]` — FlowForge 可进化智能体（Forgekin）协作 SOP

---

## 3. Harness：让模型完成现实闭环的运行时

### 3.1 开放环境里的五种失败

1. 感知失败（agent 不知道现实发生了什么）
2. 行动失败（agent 调用工具但实际没改变现实）
3. 验证失败（agent 声称做完但没证据）
4. 治理失败（agent 绕过规则 / 上下文压缩吞掉规则）
5. 逃生失败（agent 陷入死循环，无人介入）

### 3.2 Harness 七层

| 层 | 机制 | FlowForge Feature |
|---|---|---|
| 感知现实 | Durable State Surfaces | F008 |
| 改变现实 | Tool Mediation | （ToolRegistry 已有） |
| 验证现实 | Evidence & Sensors | F009 |
| 约束现实 | Governance Boundary（压缩免疫） | F010 |
| 人机边界 | Runtime 逃生舱（Magic Words） | F011 |
| 清理现实 | Entropy Control（退役） | F012 |
| 适配现实 | Harnessability 评估 | F013 |

### 3.3 压缩免疫层

治理规则不能通过 user message prepend 注入（会被上下文压缩吞掉），必须通过 system role 注入。每压缩一次规则丢一次，团队被迫"十轮对话教十次传球"。

### 3.4 FlowForge 落地

- `[doc:features/F008-durable-state-surfaces.md]` ~ `[doc:features/F013-harnessability.md]`
- `[doc:decisions/007-harness-engineering.md]` — Harness 工程路径 ADR
- 治理规则全部通过 system role 注入（铁律：禁止 user message prepend 治理规则）

---

## 4. 团队记忆：从 grep 到多域知识联邦

### 4.1 为什么 RAG 输给 grep

RAG 假设所有记忆都是同质的向量空间。但 agent 记忆有多种认知模式：
- 精确查找（grep 即可）
- 语义关联（RAG 有用）
- 时序模式（grep + 时间过滤）
- 因果链（grep + commit 历史）

### 4.2 三个检索入口

不同认知模式走不同路：
1. **精确入口**：grep / 字段查询（适合"上次这个 bug 怎么修的"）
2. **语义入口**：向量检索（适合"类似的设计模式有哪些"）
3. **时序入口**：commit / event 流（适合"这个模块怎么演化的"）

### 4.3 多域记忆联邦六层架构

| 层 | 内容 | 存续 |
|---|---|---|
| L1 工作记忆 | 当前任务上下文 | 单 session |
| L2 Episode | 具体任务经历 | 跨 session |
| L3 Skill | 可加载知识包 | 跨 agent |
| L4 Collection | 沉淀领域知识 | 跨项目 |
| L5 蒸馏知识库（MindCodex） | 蒸馏经验 | 跨代际 |
| L6 文化 | 团队规范 | 永久 |

### 4.4 消费加权排序

记忆重要性不靠自评，靠消费信号：被引用次数 / 被复用次数 / 解决问题次数 / 失败引用次数。

### 4.5 FlowForge 落地

- `[doc:features/F014-memory-collection.md]` — 多域记忆 Collection
- `[doc:features/F015-three-retrieval-entry.md]` — 三检索入口
- `[doc:features/F016-memory-governance.md]` — 记忆治理三要素
- `[doc:features/F017-consumption-weighted-ranking.md]` — 消费加权排序
- `[doc:features/F039-mind-codex-searchable.md]` — 蒸馏知识库可检索（MindCodex Searchable）
- `[doc:decisions/008-memory-federation.md]` — 多域记忆联邦 ADR

---

## 5. Eval——Harness 的自我代谢系统

### 5.1 三层 eval

| 层 | 评估对象 | 信号 |
|---|---|---|
| L1 单 agent eval | 单个 agent 单次任务 | trace + 输出质量 |
| L2 团队 eval | TeamAct 循环整体 | 终止条件达成度 + 返工率 |
| L3 harness eval | harness 组件本身 | 摩擦信号 + Build to Delete sunset 信号 |

### 5.2 Eval Contract 五问

每块 harness 必须回答：
1. **谁评估**（agent 自己 / 跨 agent / operator / 自动探针）
2. **评估什么**（功能正确性 / 性能 / 协作贡献 / 愿景对齐）
3. **何时评估**（每次调用 / 每个任务 / 每天 / 每周）
4. **评估信号**（trace / 用户反馈 / 自动探针 / 三方信号交叉）
5. **评估后做什么**（通过 / 返工 / sunset / 升级 operator）

### 5.3 三方信号交叉

只看 trace 不够，必须三方信号交叉：
- **trace 信号**：执行轨迹
- **用户信号**：用户反馈 / 摩擦信号
- **探针信号**：自动探针（如定期跑 benchmark）

### 5.4 七类归因矩阵

Eval 失败必须归因到七类之一：
1. harness 错位
2. 工具缺口
3. 模型盲点
4. 数据缺失
5. 愿景缺口
6. 协作失败
7. 资源耗尽

### 5.5 FlowForge 落地

- `[doc:features/F018-eval-contract.md]` — Eval Contract 五问
- `[doc:features/F019-three-signal-cross.md]` — 三方信号交叉
- `[doc:features/F020-seven-attribution.md]` — 七类归因矩阵
- `[doc:features/F040-harness-eval-control-plane.md]` — Harness Eval 控制面
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢 ADR

---

## 6. 可靠性——多 agent 是分布式系统

### 6.1 三类可靠性挑战

1. **进程级失败**：agent 进程崩溃 / 网络中断
2. **会话级失败**：上下文压缩 / 会话过期
3. **协议级失败**：跨 agent 状态不一致 / 消息丢失

### 6.2 Tier 1-4 恢复分级

| Tier | 失败类型 | 恢复机制 |
|---|---|---|
| Tier 1 | 单次工具调用失败 | 自动重试 + 指数退避 |
| Tier 2 | 单 agent 会话失败 | 交接胶囊 + 新 agent 接手 |
| Tier 3 | 多 agent 协作失败 | 回滚到检查点 + 重新编排 |
| Tier 4 | 系统级失败 | operator 介入 + 灾备恢复 |

### 6.3 liveness 规范读模型

agent 是否存活不能靠心跳，必须靠"规范读模型"——通过读取共享状态判断 agent 当前持球 / 执行 / 等待 / 失败。

### 6.4 弱状态机 vs 强 workflow

- **强 workflow**：固定流程，适合稳定任务
- **弱状态机**：状态可变 + 路由动态，适合开放任务

FlowForge 可进化智能体（Forgekin）协作用弱状态机（TeamAct 状态可路由），垂直业务流程用强 workflow（LoopExecutor）。

### 6.5 FlowForge 落地

- `[doc:features/F021-side-effect-wal.md]` — 副作用日志 WAL
- `[doc:features/F022-tier-1-4-recovery.md]` — Tier 1-4 恢复分级
- `[doc:features/F023-liveness-canonical-read.md]` — liveness 规范读模型
- `[doc:features/F024-weak-state-vs-strong-workflow.md]` — 弱状态机 vs 强 workflow
- `[doc:features/F025-provider-host-abstraction.md]` — 跨 provider 宿主抽象
- `[doc:decisions/010-distributed-reliability.md]` — 分布式可靠性 ADR

---

## 7. 伙伴系统的数学——上限提高，下限托底

### 7.1 上限：团队不是平均值，而是候选路径的最大值

```
团队质量 ≈ max(候选路径质量)
```

多 agent 的价值不是"更多人力的平均值"，而是"不同认知路径扩展候选解，从中选最优"。

### 7.2 下限：错误要连续穿过多层门，才会抵达用户

```
P(错误抵达用户) = ∏(每层门防漏过概率)
```

跨厂商 review 是结构性必需：同厂商 agent 共享盲点，错误穿过同厂商 review 的概率高；跨厂商 review 的盲点不重叠，错误必须连续穿过多个不重叠盲点才能抵达用户。

### 7.3 波动吸收：模型质量变成内部成本

```
用户可见质量方差 ≈ 内部返工成本方差 / 吸收因子
```

伙伴系统的核心价值：单点波动变成内部返工成本，而不是用户可见崩塌。

### 7.4 Token 账本

单 agent 看似更省 token，但加上"单点失败导致用户返工"的成本，多 agent 的 token 账本反而更优。

### 7.5 双层语言

- **内部高密度**：agent 之间用高密度结构化语言（JSON / 代码 / 紧凑标记）
- **外部讲人话**：给用户的输出用自然语言

### 7.6 FlowForge 落地

- `[doc:decisions/011-partnership-math.md]` — 伙伴系统数学 ADR
- 跨厂商 review 链（DeepSeek → Qwen → GLM → Kimi → HunYuan）
- 双层语言协议（内部 JSON / 外部 Markdown）

---

## 8. roleagent.md 在 FlowForge 的完整映射

| roleagent.md 章节 | FlowForge ADR | FlowForge Feature | FlowForge 代码 |
|---|---|---|---|
| 第 1 章 能力 × Harness | 004 / 007 | F001 / F008-F013 | `core/capability_profile.py` / `core/harness/` |
| 第 2 章 TeamAct | 002 | F002-F007 | `core/teamact/` |
| 第 3 章 Harness 七层 | 007 | F008-F013 | `core/harness/seven_layers/` |
| 第 4 章 多域记忆联邦 | 008 | F014-F017 / F039 | `core/memory/federation/` |
| 第 5 章 Eval 自代谢 | 009 | F018-F020 / F040 | `core/eval/` |
| 第 6 章 分布式可靠性 | 010 | F021-F025 | `core/reliability/` |
| 第 7 章 伙伴系统数学 | 011 | — | `core/partnership/` |

---

## 9. 镜像维护规则

本文件是 roleagent.md 的**镜像索引**，不是完整副本。维护规则：

1. **不复制原文全文**：避免副本漂移
2. **每章保留核心摘要 + 关键公式 + FlowForge 落地映射**
3. **原文更新时同步更新本镜像**（由可进化智能体 Forgekin 在 Eval 信号触发下完成）
4. **本镜像与原文冲突时以原文为准**：前期 roleagent 工程路径文档（已归档）

如需查阅完整论证、案例、图表，请直接阅读原文。
