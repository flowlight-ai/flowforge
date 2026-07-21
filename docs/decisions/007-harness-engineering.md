# ADR 007: Harness 工程路径（七层驾驭层）

> **状态**: accepted
> **日期**: 2026-07-21
> **决策者**: operator + 架构师灵智体（Forgekin / 架构师灵智体）
> **依赖**: `[doc:roleagent.md#第3章]` + `[doc:decisions/004-capability-profile-routing.md]`
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径

---

## 1. 上下文

`[doc:roleagent.md#第3章]` 指出："模型本身像一个缸中之脑。它能推理，能生成方案……但它天然没有稳定的现实感知、现实记忆、现实行动后果、现实验证，也没有可靠的人机边界。"

role-agent 直接调用 LLM 会失败，原因在于开放环境中的五类模型自身解决不了的问题：

1. **状态持久性**：长任务跨 session、跨 thread、跨天推进，模型上下文窗口撑不住，压缩会丢信息
2. **目标一致性**：Agent 容易漂移、自嗨，或被 RLHF 训练出"该收尾了"的惯性反射而提前宣布完成
3. **行动可验证性**：模型说"我做了"不等于做对了，自评存在系统偏差
4. **熵增抑制**：长期运行会积累冗余规则、过期文档、临时补丁、重复记忆
5. **人机边界**：模型没有稳定的"我现在不该继续"自觉，不可逆操作必须有外部边界

`[doc:roleagent.md#第1章]` 给出核心公式：**Agent 质量 = 模型能力 × Harness 契合度**。能力画像（CapabilityProfile）只有进入具体运行环境后，才会从静态描述变成可验证能力。当前 FlowForge 仓库中 `[doc:flowforge/core/harness/]` 已落地七层 guardrail 的 P1 代码骨架，本 ADR 把这七层正式确立为 FlowForge 的 Harness 工程路径决策。

---

## 2. 决策

七层驾驭层在代码中分别对应 `flowforge/core/harness/` 下的七个模块。每层都是"Built to Persist（复利型基础设施）"——编码外部现实、协作协议和可验证边界，模型越强越值钱。

### 2.1 Durable State Surface（持久状态表面 / DurableStateSurface）

`[doc:roleagent.md#第3章]`："感知现实——让 agent 不再失忆上岗。"

代码实现于 `flowforge/core/harness/durable_state.py`：

- `DurableState`：不可变快照数据类，含 `snapshot_id` / `state_dict` / `created_at` / `parent_snapshot_id`，支持父子链
- `DurableStateSurface.snapshot(state_dict, parent_snapshot_id)`：deep-copy 入存，返回 `snapshot_id`
- `DurableStateSurface.restore(snapshot_id)`：deep-copy 出存，调用方修改不污染快照
- `DurableStateSurface.list_snapshots()`：枚举所有快照

tradeoff 明确：状态越外部化，系统越可恢复；表面越多越需要治理（故与第 6 层 EntropyControl 配套）。生产环境可换 SQLite/PostgreSQL 后端而不改 surface API——这是压缩免疫的"现实状态层"，承载灵忆 EchoStore 的持久化语义。

### 2.2 Tool Mediation（工具中介 / ToolMediator）

`[doc:roleagent.md#第3章]`："改变现实——能力半径变大后，边界必须显式化。"

代码实现于 `flowforge/core/harness/tool_mediation.py`：

- `ToolMediator.register_tool(name, handler, allowlist)`：注册工具时绑定允许调用者名单
- `ToolMediator.invoke(tool_name, args, caller)`：异步入口，调用前先校验 `caller in allowlist`，否则抛 `ToolAllowlistViolation`
- `ToolResult`：含 `success` / `output` / `error` / `duration_ms`，handler 失败被捕获为 `success=False` 而非抛出，让上层决策
- 自动检测 sync/async handler（`inspect.iscoroutinefunction`）

这是项目规则"工具调用必须通过 ToolRegistry.execute()"的结构性 enforcement——比在 prompt 里写"请不要调用某工具"可靠得多。

### 2.3 Evidence Sensors（证据传感器 / EvidenceCollector）

`[doc:roleagent.md#第3章]`："验证现实——做了不等于做对了。"

代码实现于 `flowforge/core/harness/evidence_sensors.py`：

- `EvidenceCollector.record_evidence(source, content, evidence_type)`：未验证即入库，返回 `Evidence`
- `EvidenceCollector.verify(evidence_id, verifier)`：显式打标，必须由非作者 verifier 完成
- `EvidenceCollector.list_unverified()`：暴露待验证证据，给 review pipeline 用
- `EvidenceCollector.cross_check(evidence_a, evidence_b)`：基于 `difflib.SequenceMatcher` 计算 [0.0, 1.0] 相似度，支持跨厂商 review 的一致性检查

完成感从模型嘴里移到证据链里——commit、先红后绿测试、cross-check ratio 都是不可伪造的客观信号。

### 2.4 Governance（治理 / GovernanceBoundary）

`[doc:roleagent.md#第3章]`："约束现实——长任务跑久了，压缩不理解什么是治理规则。"

代码实现于 `flowforge/core/harness/governance.py`：

- `GovernanceRule`：结构化规则对象（`rule_id` / `description` / `severity` / `created_at`），**永不序列化进 prompt**
- `GovernanceBoundary.add_rule(rule_id, description, severity)`：注册规则
- `GovernanceBoundary.check_violation(action)`：case-insensitive 子串匹配，返回 `list[GovernanceViolation]`

关键设计：治理规则作为结构化对象在程序侧检查，**不进入 LLM prompt context**——这就是压缩免疫的实现路径。这区别于 roleagent.md 早期教训："user message prepend 的规则每压缩一次丢一次"。

### 2.5 Magic Words（魔法词 / MagicWordsRegistry）

`[doc:roleagent.md#第3章]`："人机边界——Runtime 逃生舱，让人类用极低带宽打断 agent 的错误轨迹。"

代码实现于 `flowforge/core/harness/magic_words.py`：

- `MagicWordAction` 枚举：`HALT` / `PAUSE` / `ESCALATE` / `ROLLBACK`
- `DEFAULT_MAGIC_WORDS`：双语词表（"stop" / "停止" / "halt" / "中止" / "abort" / "pause" / "暂停" / "escalate" / "升级" / "rollback" / "回滚"）
- `MagicWordsRegistry.with_defaults()`：预装默认词表
- `MagicWordsRegistry.register_word(word, action)`：扩展词表
- `MagicWordsRegistry.detect(text)`：返回 `list[DetectedMagicWord]`，含 `position` 与 ±20 字符 `context`

模块注释明确：此 registry 区别于 `flowforge.forgemind.magic_words`（CVO 中断协议），是 harness 层任一层都可监听的逃生舱。约束：仅在当前 CVO 指令中触发，复述历史中的短语不触发——避免治理协议本身变成误触源。

### 2.6 Entropy Control（熵控 / EntropyController）

`[doc:roleagent.md#第3章]`："清理现实——Harness 有两种死法，第二种是规则只增不减变成技术债。"

代码实现于 `flowforge/core/harness/entropy_control.py`：

- `EntropyEntry`：含 `artifact_id` / `created_at` / `last_touched` / `ttl_seconds`
- `EntropyController.register_artifact(artifact_id, ttl_seconds)`：注册待清理对象
- `EntropyController.touch(artifact_id)`：重置 `last_touched`，延后过期
- `EntropyController.list_expired()`：返回 `now - last_touched > ttl_seconds` 的 artifact
- `EntropyController.cleanup_expired()`：批量删除并返回计数

对应 roleagent.md 的"hotfix 合入后两周自动触发升级 review"和"Build to Delete 类规则要标 sunset"——TTL 机制让脚手架不能无限期占用注意力预算。

### 2.7 Harnessability（可驾驭性评分 / HarnessabilityScorer）

`[doc:roleagent.md#第3章]`："适配现实——不是每个系统都同样适合交给 agent。"

代码实现于 `flowforge/core/harness/harnessability.py`：

- 权重常量：`WEIGHT_DURABLE_STATE=0.20` / `WEIGHT_TOOL_ALLOWLIST=0.20` / `WEIGHT_EVIDENCE=0.20` / `WEIGHT_GOVERNANCE=0.15` / `WEIGHT_MAGIC_WORD=0.15` / `WEIGHT_ENTROPY=0.10`（合 1.0）
- `GOVERNANCE_FULL_RULE_COUNT=5`：5 条规则即得满分
- `HarnessabilityFactors`：6 维输入数据类（governance_rule_count 是整数，其余 5 维 [0.0, 1.0]）
- `HarnessabilityScorer.score(factors)`：加权平均后 clamp 到 [0.0, 1.0]
- `HarnessabilityScorer.grade(score)`：A(≥0.9) / B(≥0.8) / C(≥0.6) / D(≥0.4) / F

这一层把第 1 章公式 `Agent 质量 = 模型能力 × Harness 契合度` 中的右项量化为可计算指标——是 ADR-004 中 `harness_fit_score` 字段的实际供给源。

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 七层独立模块 + 加权评分** | 每层可独立测试与演进；权重显式可调；评分驱动 ADR-004 的 `harness_fit_score`；与 roleagent.md 第 3 章七节一一对应 | 7 个文件 + 1 个 scorer 增加初次实现成本；需要后续把内存存储换成 SQLite/PostgreSQL 后端 |
| 方案 B: 单一 monolithic Harness 类 | 实现简单，调用方少 import | 违反单一职责；七层耦合后无法独立演进；测试粒度过粗；评分算法无法独立替换 |
| 方案 C: 全部塞进 system prompt 让 LLM 自我治理 | 零代码 | 违反"压缩免疫"铁律——治理规则会被上下文压缩吞掉；与 roleagent.md 第 3 章核心主张直接冲突 |

---

## 4. 理由

- operator 明确要求走向"能力画像、动态路由、共享状态、eval 和可靠性治理"的工程路径，Harness 是这条路径的现实闭环运行时
- `[doc:roleagent.md#第3章]` 明确主张"现实闭环不能只靠注意力维持……Harness 会把关键约束放到更可靠的表面上：文件、任务、工具协议、队列、钩子、测试、审查、trace、人工确认和记忆系统"
- 七层对应 roleagent.md 列出的开放环境五类失败模式 + Tool Mediation + Harnessability，覆盖完整
- 治理层采用结构化对象（`GovernanceRule`）而非 prompt 文本——直接吸取"user message prepend 被压缩吞掉"的历史教训
- Harnessability 量化是 ADR-004 `harness_fit_score` 字段的实际供给源，与已 accepted 的 ADR-004 形成闭环
- 七层模块全部为 Built to Persist：编码外部现实、协作协议、可验证边界——模型越强越值钱

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 内存存储 (`dict`) 在生产场景丢数据 | 接口设计为可换后端（SQLite/PostgreSQL），surface API 不变；P2 阶段引入持久化实现 |
| ToolMediator allowlist 维护成本随工具数量上升 | 配置驱动注册（YAML），与项目规则"工具调用必须通过 ToolRegistry"对齐 |
| Governance 子串匹配可能误判（如"force"出现在合法描述中） | P2 阶段引入结构化 action schema，匹配从 substring 升级为字段精确比对 |
| Magic Words 默认词表可能与正常用户输入冲突 | 仅在 CVO 当前指令中触发；复述历史短语不触发；`detect` 返回 context 供人工复核 |
| EntropyControl TTL 设置不当导致有用 artifact 被误删 | `touch()` 允许延后过期；`list_expired` 与 `cleanup_expired` 分离，可先审计再清理 |
| Harnessability 权重静态写死，无法适配不同领域 | 权重以模块常量形式存在，未来可由 Loop 配置注入（与质量分阈值 0.85 同套机制） |

---

## 6. 否决理由

- **方案 B（单一 monolithic Harness 类）**：违反项目规则"组合优于继承"和单一职责原则；七层在 roleagent.md 中本就是独立工程层，强行合并会让演进耦合；测试粒度过粗，无法独立验证某一层的压缩免疫性
- **方案 C（全部塞进 system prompt）**：与 roleagent.md 第 3 章核心主张直接冲突——治理规则进入 prompt 就会被上下文压缩吞掉，正是 Cat Café 早期踩过的坑（"治理规则每压缩一次丢一次，团队被迫十轮对话教十次传球"）；同时违反项目规则"禁止硬编码提示词"和 P16

---

## 7. 参与者

- operator（愿景锚点 + 最终决策 + Magic Words 词义来源）
- 架构师灵智体（Forgekin / 架构师灵智体）（七层模块设计 + 权重标定 + 术语对齐项目正式命名）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-21 | 初始版本，确立 Harness 七层工程路径决策，对齐 `flowforge/core/harness/` 七个 P1 模块实现 | operator + 架构师灵智体 |

---

## 引用

- `[doc:roleagent.md#第1章]` — 核心公式：能力 × Harness 契合度
- `[doc:roleagent.md#第3章]` — Harness：让模型完成现实闭环的运行时（七层）
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（harness_fit_score 字段消费方）
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表：灵忆 EchoStore / 灵印 SoulImprint / 灵议 MindCouncil / 灵智体 Forgekin / 育灵 Forge Nurturing）
- `[doc:flowforge/core/harness/durable_state.py]` — DurableStateSurface 实现
- `[doc:flowforge/core/harness/tool_mediation.py]` — ToolMediator 实现
- `[doc:flowforge/core/harness/evidence_sensors.py]` — EvidenceCollector 实现
- `[doc:flowforge/core/harness/governance.py]` — GovernanceBoundary 实现
- `[doc:flowforge/core/harness/magic_words.py]` — MagicWordsRegistry 实现
- `[doc:flowforge/core/harness/entropy_control.py]` — EntropyController 实现
- `[doc:flowforge/core/harness/harnessability.py]` — HarnessabilityScorer 实现
- `[doc:project_rules.md#红线10]` — 禁止在 flowforge 中写死业务领域代码
- `[doc:project_rules.md#铁律5]` — 禁止硬编码路径和密钥
