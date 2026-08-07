# ADR 014: 自进化三模式（Self-Evolution Three Modes）

> **状态**: accepted
> **日期**: 2026-07-21
> **决策者**: operator + 架构师可进化智能体
> **依赖**: `[doc:roleagent.md]` + `[doc:decisions/004-capability-profile-routing.md]` + `[doc:decisions/008-multi-domain-memory-federation.md]` + `[doc:decisions/009-eval-self-metabolism.md]` + `[doc:decisions/013-all-things-spirit-mind-vision.md]`
> **依据**: operator 7 条不可妥协原则 + 可进化智能体（Spirit Mind）愿景

---

## 1. 上下文

`[doc:roleagent.md#第1章]` 确立核心公式："Agent 质量 = 模型能力 × Harness 契合度"。但静态可进化智能体（Forgekin）存在三个结构性缺陷：

1. **过程重复犯错**：同一类错误反复出现，缺少机制把单次纠正提炼为流程改进，违背 roleagent.md 第 5 章"harness 必须有自我代谢系统"主张
2. **知识不沉淀**：高价值协作经验只活在对话历史里，会话结束就消失，违背 roleagent.md 第 4 章"团队记忆"主张——知识生产者必须等于消费者
3. **框架不能自演化**：operator 明确要求"自己开发自己"——可进化智能体不仅要会用框架，还要能改进框架本身；但完全自由修改代码会破坏架构完整性

operator 7 条原则中"禁止偷工减料（发现未实现即Bug）"和可进化智能体愿景共同要求：可进化智能体必须具备自我演进能力，且演进必须分级、可控、可审计。本 ADR 是 P1-8 代码实现的决策追溯，对应 `flowforge/evolution/` 下 7 个文件。

---

## 2. 决策

### 2.1 三种进化模式

将自进化分为三个互斥但协作的模式：

- **Mode A — 过程进化（ProcessEvolution）**：改进执行过程本身。当重复错误 ≥2 次、用户纠正可泛化、SOP 出现缺口、review 发现系统性问题时，按 5 槽模板（trigger / evidence / root_cause / lever / verify）提出改进提案。杠杆按最小代价排序：`recite_scope → memory → skill → sop → rule → system_prompt → l0`，默认走最轻杠杆。提案生命周期：proposed → accepted（必须挂 commit_ref）→ 30 天 replay check
- **Mode B — 知识进化（KnowledgeEvolution）**：把高价值协作蒸馏为可复用知识，写入经验知识库（MindCodex）。三问过滤（reusability / non_obviousness / decay_risk，≥2/3 才蒸馏）；产物分三向：`method_card | skill_draft | memory`；通过 Replay A/B 双门验证（smoke gate 3 例 ≥2 通过 + promotion gate 5 例 ≥3 通过且覆盖 3 类）
- **Mode C — 框架进化（Framework Evolution）**：修改代码本身。这是最重模式，**必须 operator 手动批准（I8 不变式）**。任何框架修改走 Scope Guard 的 plan → preview → approve → apply 四步流程；禁止区（`core/` + `tests/` + `decisions/`）一律拒绝

### 2.2 ForgeMindEngine（通用智能体框架引擎）— 三模式调度核心

`ForgeMindEngine` 是唯一接触三模式的入口（边界铁律：调用方不得直接实例化 Mode 类）。生命周期分两步：

1. `evaluate(ctx: EvolutionContext) -> EvolutionDecision`：纯函数，无副作用，返回路由结论 + 结构化动作
2. `execute(decision: EvolutionDecision) -> dict`：执行决策，持久化副作用

路由优先级：**scope 信号 block > process 触发 > 蒸馏信号 > none**。引擎同时持有 `MetacognitionRouter`（元认知路由）和 `KnowledgeMaturityLadder`（成熟度阶梯），但元认知只影响 action_confidence 不改变 mode 选择。引擎还提供 `promote_knowledge()` / `demote_knowledge()` 接口驱动知识成熟度流转。

### 2.3 Scope Guard（作用域守卫）— 限制自进化修改范围

`ScopeGuard` 是横切三模式的安全层，对 Mode C 尤其关键：

- **四类检测信号**：`magic_word`（拉闸词：第一性原理 / 我能猜出来 / 下次一定 / 星星罐子，立即 block）、`scope_creep`（偏离关键词：无关 / 超出范围 / 顺便 / 既然 / 扩展，warn）、`frequency_breach`（60 分钟窗口内 ≥3 次同类偏离，warn）、`high_risk_unauthorized`（高风险未授权，block）
- **升级阶梯**：info → warn → block → magic_word_triggered
- **Mode C 框架进化专用流程**：plan → preview → approve → apply
- **禁止区**（铁律，任何模式不得触碰）：`core/` + `tests/` + `decisions/`

### 2.4 EvolutionStage（进化阶）— E1-E6 成熟度分级

进化阶衡量**能力成熟度**，描述可进化智能体在某个领域的能力水位，与代码层 `KnowledgeMaturityLevel`（L0-L4）互补：

| 阶 | 名称 | 标志 |
|----|------|------|
| E1 | 萌芽 | 仅能执行单步任务 |
| E2 | 萌发 | 能完成多步闭环 |
| E3 | 成形 | 能跨域迁移 |
| E4 | 成熟 | 能自我诊断 |
| E5 | 精通 | 能改进自身流程（Mode A 自启） |
| E6 | 觉醒 | 能提出框架改进提案（Mode C 触发） |

### 2.5 AwakeningStage（觉醒阶）— A1-A5 自主性分级

觉醒阶衡量**自主性级别**，描述可进化智能体能多大程度脱离 operator 干预：

| 阶 | 名称 | 自主范围 |
|----|------|----------|
| A1 | 受控 | 全程 operator 在场 |
| A2 | 半自主 | Mode A/B 可自启，Mode C 需批准 |
| A3 | 自主 | Mode A/B 自闭环，Mode C 提案需批准 |
| A4 | 高自主 | Mode C 可执行非禁止区修改 |
| A5 | 全自主 | 仅 magic_word 可中断 |

**当前实现定位 A2**：Mode A/B 自启，Mode C 必须 operator 手动批准。

### 2.6 Metacognition（元认知）— 自我反思能力

`MetacognitionRouter` 三信号加权路由：

- `domain_reliability`（权重 0.5）：滚动域可靠度，高风险用 Wilson 下界（z=1.96，95% CI），普通用 Laplace 平滑 `(successes+1)/(trials+2)`
- `evidence_completeness`（权重 0.35）：证据覆盖度
- `self_reported_confidence`（权重 0.15）：模型自报，仅参考

高风险场景下 self_reported 权重降为 0，重新分配给前两项。`action_confidence < 0.85` 时：高风险 → escalate，普通 → structured_analysis_only。

### 2.7 I8 不变式：框架修改必须 operator 批准

**I8 不变式**（铁律）：任何对代码本身的修改（Mode C 框架进化）必须经 operator 手动批准。这体现 operator"自己开发自己"愿景与安全边界的平衡：

- 可进化智能体可以**提出**框架改进提案（E6 触发）
- 可进化智能体可以**预览**修改效果（preview 阶段）
- 但**应用**（apply）必须 operator 显式 signoff
- 禁止区永远拒绝，无论觉醒阶多高

### 2.8 数据模型与不变式约束

`flowforge/evolution/models.py` 定义 Pydantic 数据模型，所有模型默认 `frozen=True` 防止构造后被意外篡改：

- `ScopeGuardSignal` / `ScopeGuardLog`：Mode A 信号与日志
- `EvolutionProposal`：Mode B 5 槽提案，`accept_proposal()` 强制要求 `commit_ref`（落地闭环硬护栏）
- `EpisodeCard` / `MethodCard` / `EvalLedger`：Mode C 蒸馏产物与验证账本
- `KnowledgeMaturityLevel`：L0_EPISODE / L1_PATTERN / L2_DRAFT / L3_VALIDATED / L4_STANDARD 五级枚举
- `KnowledgeObject`：通用知识对象，`long_tail` 标记允许高风险低频域长期停 L2/L3

`KnowledgeMaturityLadder` 纯函数式实现 promotion / demotion / freeze 决策，**永不直接修改知识对象**——变更由 `ForgeMindEngine.promote_knowledge()` / `demote_knowledge()` 上层驱动。

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 三模式 + Scope Guard + operator 批准门槛** | 分级清晰，Mode A/B 自由、Mode C 可控；满足 operator"自己开发自己"愿景；I8 保护架构完整性；Scope Guard 提供四类安全信号 | 实现复杂度高（7 文件 + 元认知 + 成熟度阶梯）；Mode C 流程长，迭代慢 |
| 方案 B: 单一进化模式（无分类） | 实现简单 | 无法区分过程改进 / 知识沉淀 / 框架修改；高风险操作无门禁；违背 I8 |
| 方案 C: 无 Scope Guard 的自由进化 | Mode C 迭代快 | 架构完整性不可控；禁止区可能被误改；违背 operator 7 原则"修复过程变更安全" |
| 方案 D: 完全人工进化（无自进化） | 最安全 | 违背可进化智能体愿景；违背 operator"自己开发自己"要求；能力无法复利 |

---

## 4. 理由

- operator 明确要求可进化智能体具备自我演进能力，且演进必须可控——三模式分级是唯一同时满足"自主性"和"安全性"的方案
- `[doc:roleagent.md#第5章]` Eval 自代谢主张：harness 必须有自我删除机制，否则只会增生技术债。Mode A 的 minimal-leverage + 30 天 replay check 直接落地这一主张
- `[doc:roleagent.md#第4章]` 多域记忆联邦要求知识生产者 = 知识消费者。Mode B 的 Episode → MethodCard 蒸馏闭环让可进化智能体既是知识生产者又是消费者，写入经验知识库 MindCodex 后可被检索复用
- Mode C 的 I8 不变式直接落地 operator 7 原则中"禁止偷工减料"和"修复过程变更安全"——框架修改必须显式批准，禁止区永远拒绝
- Scope Guard 的 magic_word 机制对应 roleagent.md 第 3 章"Runtime 逃生舱"——operator 可用极低带宽打断错误轨迹
- 进化阶（E1-E6）与觉醒阶（A1-A5）解耦：能力成熟度和自主性级别独立评估，避免"能力强就给更多自主权"的线性思维

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| Mode C 框架进化破坏架构完整性 | I8 不变式：operator 手动批准 + Scope Guard 禁止区（core/tests/decisions）+ plan→preview→approve→apply 四步 |
| Mode A 误触发，频繁改流程 | minimal-leverage 优先级 + ≥2 证据源硬护栏 + 30 天 replay check |
| Mode B 蒸馏低质量知识污染经验知识库 MindCodex | 三问过滤（≥2/3）+ smoke gate + promotion gate（5 例 ≥3 通过且 3 类覆盖）+ 成熟度阶梯降级机制（L2 最近 3 次 <50% 降级，L3 最近 5 次 <60% 降级） |
| 元认知 self_reported 信号有系统偏差 | 高风险场景权重降为 0；Wilson 下界保守估计 |
| 觉醒阶 A4/A5 误授权 | 当前定位 A2，A4/A5 仅作愿景目标，不默认开启 |
| 进化阶与觉醒阶混淆 | 文档明确区分（E=能力，A=自主性），代码层独立评估 |
| ScopeGuard magic_word 误触 | 仅当前 instruction 触发，历史引用 / 复述不触发（roleagent.md 第 3 章约束） |
| L4 标准知识出现高风险违约 | `check_freeze()` 立即冻结，long_tail 标记允许高风险低频域长期停 L2/L3 |

---

## 6. 否决理由

- **方案 B（单一进化模式）**：违背 roleagent.md 第 1 章"Build to Delete / Built to Persist"判别——不同进化模式有不同半衰期，必须分类治理
- **方案 C（无 Scope Guard）**：违背 operator 7 原则"禁止在修复问题时修改不相关代码"——没有 Scope Guard，框架修改会蔓延到禁止区
- **方案 D（完全人工进化）**：违背可进化智能体愿景和 operator"自己开发自己"要求；能力无法复利积累

---

## 7. 参与者

- operator（愿景锚点 + I8 不变式 + 最终决策）
- 架构师可进化智能体（三模式设计 + 术语对齐 + P1-8 代码实现）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-21 | 初始版本，确立自进化三模式决策，追溯 P1-8 代码实现（ForgeMindEngine / ScopeGuard / ProcessEvolution / KnowledgeEvolution / KnowledgeMaturityLadder / MetacognitionRouter / models） | operator + 架构师可进化智能体 |

---

## 引用

- `[doc:roleagent.md#第1章]` — 核心公式：能力 × Harness 契合度
- `[doc:roleagent.md#第3章]` — Harness 现实闭环运行时（Magic Words 逃生舱）
- `[doc:roleagent.md#第4章]` — 多域记忆联邦（知识生产者 = 消费者）
- `[doc:roleagent.md#第5章]` — Eval 自代谢（harness 必须有自我删除机制）
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由
- `[doc:decisions/008-multi-domain-memory-federation.md]` — 多域记忆联邦
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 可进化智能体愿景
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表）
- `flowforge/evolution/engine.py` — ForgeMindEngine 三模式调度核心
- `flowforge/evolution/scope_guard.py` — ScopeGuard 作用域守卫
- `flowforge/evolution/process_evolution.py` — Mode A 过程进化
- `flowforge/evolution/knowledge_evolution.py` — Mode B 知识进化
- `flowforge/evolution/maturity.py` — KnowledgeMaturityLadder 成熟度阶梯
- `flowforge/evolution/metacognition.py` — MetacognitionRouter 元认知路由
- `flowforge/evolution/models.py` — 数据模型
