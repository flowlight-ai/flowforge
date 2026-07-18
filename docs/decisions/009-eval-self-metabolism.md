# ADR 009: Eval 自代谢

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师灵智体 + operator 审核
> **依赖**: `[doc:roleagent.md#第5章]` + `[doc:review/review.md#第八章]` RA-031~RA-036 + `[doc:review/review.md#第十三章]` CL-001~CL-006
> **依据**: RA-031~RA-036（Harness Eval + Eval Contract 五问 + 三方信号交叉 + 七类归因矩阵）+ CL-001~CL-006（自我进化三模式 + Eval Ledger）

---

## 上下文

`[doc:roleagent.md#第5章]` 一句话论点："有 harness 就必须有 eval，否则 harness 只会增生不会代谢。" Eval 是 Harness 的自我代谢系统——决定哪块机制正在增值、哪块折旧、哪块需要行动、哪块成为瓶颈。FlowForge v4.0 的现状（`[doc:review/review.md#第八章]` 8.5 节 RA-031~RA-036 共 6 项问题，4 项 P0）：

- 完全无 Harness Eval 体系（RA-031 P0），LoopExecutor 质量分 0.85 是任务级 eval，不是 harness 级 eval
- Eval Contract 五问未实现（RA-032 P0），新增 harness 组件无任何预期声明，无法判断该组件是否在增值
- 三方信号交叉缺失（RA-033 P0），只有第三方信号（MetricsCollector），无 CVO 愿景信号采集，无灵智体摩擦信号结构化采访
- 七类归因矩阵缺失（RA-034 P0），失败归因只能到"灵智体没做好"→优化 prompt→换模型，把多层系统拍扁成一维答案
- 轨迹经济学（TaskTrajectory）缺失（RA-035 P1），trace 是无结构日志，无法统计分析
- Harness Eval Control Plane 终态未规划（RA-036 P1），每个 eval 线各自维护定时任务

`[doc:review/review.md#第十三章]` 13.1 节 CL-001~CL-006 进一步补审：clowder-ai `[doc:clowder-ai/docs/decisions/F100-self-evolution.md]` 定义自我进化三模式——Mode A Scope Guard（范围守卫）/ Mode B Process Evolution（流程进化）/ Mode C Knowledge Evolution（知识进化），由 Eval Ledger 统一治理：每个进化提案必须通过 Replay A/B 验证知识净增益（净增益 = 后测 - 前测，必须 > 0 才允许合入）。v7.0 把自我进化当作单一机制，未分三层，无 Scope Guard，无五级知识成熟度阶梯，无 Eval Ledger，是 v7.0 灵锻最大的科学性缺陷。

operator 决策：FlowForge 必须实现三层 Eval + Eval Contract 五问 + 三方信号交叉 + 七类归因矩阵 + 自我进化三模式 + Eval Ledger 净增益验证。

---

## 决策

### 1. 三层 Eval

| 层 | 评估对象 | 信号来源 | Feature |
|---|---|---|---|
| L1 观测底座 | 单灵智体单次任务 | trace + 输出质量 | MetricsCollector（已有） |
| L2 Harness A2A Eval | TeamAct 循环整体 + Harness 组件本身 | 摩擦信号 + Build to Delete sunset 信号 | F040 |
| L3 Memory Eval | 记忆联邦召回质量 | 消费加权 + 失败引用率 | F017 联动 |

### 2. Eval Contract 五问（F018，RA-032）

每块新增 Harness 必须回答五问，否则不允许合入：

| # | 问题 | 答案类型 |
|---|---|---|
| 1 | 谁评估 | 灵智体自己 / 跨灵智体 / operator / 自动探针 |
| 2 | 评估什么 | 功能正确性 / 性能 / 协作贡献 / 愿景对齐 |
| 3 | 何时评估 | 每次调用 / 每个任务 / 每天 / 每周 |
| 4 | 摩擦指标 | trace / 用户反馈 / 自动探针 / 三方信号交叉 |
| 5 | 退役信号 | sunset 触发条件（如模型升级后该规则命中率 < 5%） |

```yaml
# 一块 harness 的 Eval Contract
harness_component: governance_boundary
eval_contract:
  who: [auto_probe, cross_agent_review]
  what: [compression_immune_rate, rule_violation_count]
  when: [every_invocation, weekly_summary]
  friction_metrics: [trace, runtime_probe]
  sunset_signal: "model_upgrade AND rule_hit_rate < 5% for 4 weeks"
```

### 3. 三方信号交叉（F019，RA-033）

不只看 trace，必须三方信号交叉：

| 信号 | 来源 | 采集方式 |
|---|---|---|
| 第一方 CVO 愿景信号 | operator / 首席愿景官 | 愿景对齐度评分 + 拉闸词触发 |
| 第二方灵智体摩擦信号 | 灵智体本身 | 结构化采访（非自由散文反思） |
| 第三方运行时观测信号 | MetricsCollector | 工具调用模式 / 失败频率 / 重试次数 / 耗时分布 |

任何单方信号都不足以判定 harness 是否增值。三方信号交叉后才进入归因矩阵。

### 4. 七类归因矩阵（F020，RA-034）

Eval 失败必须归因到以下七类之一，禁止"灵智体没做好→优化 prompt→换模型"的一维归因：

| # | 归因类别 | 含义 | 修复方向 |
|---|---|---|---|
| 1 | 愿景缺口 | CVO 愿景方向未对齐 | operator 介入修订 VISION.md |
| 2 | 翻译偏差 | 愿景→spec→prompt 翻译失真 | 重写 spec / prompt |
| 3 | Harness 错位 | harness 组件不适配当前模型 | 重构 harness 组件 |
| 4 | 工具缺口 | 缺少必要工具 | 新增工具 |
| 5 | 执行缺口 | 灵智体执行失败 | 重试 / 换灵智体 / 优化能力画像 |
| 6 | 环境漂移 | 外部系统行为变化 | 适配外部系统变化 |
| 7 | 品味落差 | 输出质量不达 operator 期望 | 调整品味标准 / operator 介入 |

### 5. 轨迹经济学（TaskTrajectory，RA-035）

Eval 产物不只是结论，更有价值的是**类型化轨迹**：意图 / 工具选择 / 失败分支 / 读了什么 / 改了什么 / 谁验证 / 怎么恢复。轨迹写入灵忆（EchoStore），灵锻（SpiritForge）从轨迹蒸馏。

```python
class TaskTrajectory:
    intent: str              # 意图
    tool_choices: list[ToolCall]   # 工具选择
    failure_branches: list[Branch] # 失败分支
    reads: list[MemoryRef]   # 读了什么记忆
    writes: list[Artifact]   # 改了什么
    verifier: str            # 谁验证
    recovery: str | None     # 怎么恢复
```

### 6. 自我进化三模式（CL-001，F100）

参考 `[doc:clowder-ai/docs/decisions/F100-self-evolution.md]`，自我进化不是单一机制，而是三个独立但耦合的行为层：

| 模式 | 名称 | 修改范围 | 审查严格度 | 回滚成本 |
|---|---|---|---|---|
| Mode A | Scope Guard 范围守卫 | 防止灵智体越权修改愿景/规范/架构边界 | 最高（每次提案先过 Scope Guard） | 极高（违反 operator 愿景） |
| Mode B | Process Evolution 流程进化 | 改进灵智体自己的工作方式（prompt / 工具顺序 / 协作协议） | 中（基于 Eval 反馈，不修改知识内容） | 中 |
| Mode C | Knowledge Evolution 知识进化 | 蒸馏新知识到锻典（Mind Codex） | 中（按五级成熟度阶梯晋升） | 低（可降级） |

觉醒阶 E4+ Evoling 状态的灵智体可自主发起 Mode B / Mode C，但 Mode A 始终由 operator + 灵议 Mind Council 把守。

### 7. 五级知识成熟度阶梯（CL-003，Mode C）

```python
class KnowledgeMaturity(Enum):
    L0_EPISODE = "L0"   # 单次经验
    L1_PATTERN = "L1"   # 多次相似经验（需 3+ Episode）
    L2_DRAFT = "L2"     # 灵智体主动抽象的草拟技能条目
    L3_VALIDATED = "L3" # Eval Replay A/B 验证通过
    L4_STANDARD = "L4"  # operator / 灵议批准的标准技能库条目
```

每级晋升需不同证据，禁止单次失败经验直接进入锻典（CL-003 P0）。

### 8. Eval Ledger 净增益验证（CL-004）

每次进化提案记录到 Eval Ledger：

```python
class EvalLedgerEntry:
    proposal_id: str
    proposal_content: str
    pre_test_score: float      # 前测分数
    post_test_score: float     # 后测分数
    net_gain: float            # = post - pre，必须 > 0 才允许合入
    test_set_id: str           # 固定测试集 ID
    approved: bool
    rolled_back: bool
```

**铁律**：净增益 ≤ 0 的进化提案禁止合入，无论"看起来多好"。

### 9. Knowledge Object Contract（CL-005）

每个锻典条目必须包含七字段契约：

```python
class KnowledgeObject:
    trigger: str          # 何时使用
    procedure: str        # 怎么用
    precondition: str    # 前置条件
    postcondition: str   # 预期效果
    anti_pattern: str    # 反模式
    provenance: list[str] # 来源 Episode ID
    confidence: float    # 置信度
```

### 10. Harness Eval Control Plane 终态（F040，RA-036）

终态是统一 Eval Hub——不是指标看板，而是 Harness 生命周期的控制面：

| 状态 | 含义 | 行动 |
|---|---|---|
| 增值中 | 净增益 > 0，摩擦下降 | 持续投资 |
| 折旧中 | 净增益 ≤ 0，摩擦上升 | 标 Build to Delete sunset |
| 需要行动 | sunset 信号已触发 | 触发 Entropy Control 退役 |
| 成为瓶颈 | 影响其他组件 | 重构或拆除 |

### 11. Scope Guard 机制（CL-002）

Mode A 的 Scope Guard 是自我进化的"宪法层"。灵智体提出任何修改前必须先声明范围：

```python
class ScopeDeclaration:
    scope: str   # 如 "writer prompt" / "VISION §7" / "rule red_line_5"
    # Scope Guard 自动拒绝越权范围
```

VISION §7 不可被灵智体修改（operator 第 7 条愿景锚点），Scope Guard 拒绝任何对 VISION §7 的提案。

---

## 后果

### 正面后果

- Harness 从"只增生不代谢"升维到"自我代谢系统"，技术债可被自动清理
- Eval Contract 五问让每块 harness 必须声明预期，可判断增值 / 折旧
- 三方信号交叉消除单方信号误判
- 七类归因矩阵让失败根因可定位（不再"灵智体没做好→优化 prompt→换模型"）
- 自我进化三模式让流程改进 / 知识进化 / 范围守卫各司其职
- Eval Ledger 净增益验证让进化提案科学化（不靠"看起来更好"）
- 五级知识成熟度阶梯防止单次失败经验污染锻典
- Scope Guard 保护 VISION §7 不被灵智体越权修改

### 负面后果

- 三层 Eval 增加实现复杂度（3 个 Feature F018-F020 + F040）
- Eval Contract 五问增加每块 harness 的文档开销
- 三方信号采集需要 CVO 介入和灵智体结构化采访，operator 工作量增加
- 七类归因需要训练灵智体识别类别（初期归因可能不准）
- Eval Ledger 净增益需要维护固定测试集，测试集本身需 Eval
- Scope Guard 可能阻碍合理改进 —— 缓解：operator 可显式 override Scope Guard

### 风险

- Eval 信号不足时归因矩阵可能误判 —— 缓解：信号不足时归因到"环境漂移"或人工介入
- 自我进化三模式边界模糊（Mode B 和 Mode C 难区分）—— 缓解：Mode B 不产生新知识条目，Mode C 产生新锻典条目
- Eval Ledger 净增益 ≤ 0 但提案确实有用（如长期价值）—— 缓解：operator 可显式批准例外，但必须记录在 Ledger
- Scope Guard 太严可能锁死进化 —— 缓解：Scope Guard 范围由 operator + 灵议 Mind Council 定义，可调整

---

## 替代方案

### 方案 A: 保持任务级 Eval（LoopExecutor 质量分 0.85）

- 优点：实现简单，已有代码
- 缺点：无 harness 级 eval，半衰期是猜测（RA-031 P0 未解决）
- 未选择原因：roleagent.md 明确"benchmark 只测模型能力，不测 harness 适配度"

### 方案 B: 把所有失败归因到"模型能力不足"

- 优点：归因简单，统一行动是"换更强的模型"
- 缺点：忽略 harness 错位 / 工具缺口 / 愿景缺口等根因，真正的根因永远修不到
- 未选择原因：违反 RA-034 七类归因矩阵

### 方案 C: 不区分自我进化三模式（统一灵锻）

- 优点：实现简单
- 缺点：流程改进 / 知识进化混在一起，无法独立 Eval；Scope Guard 缺失（违反 CL-002 P0）
- 未选择原因：CL-001 明确三模式必须分层治理

### 方案 D: 用 LLM 自评替代 Eval Ledger

- 优点：无需维护测试集
- 缺点：LLM 自评不可审计、有自利偏差、无法验证净增益
- 未选择原因：违反 CL-004 Eval Ledger 净增益验证要求

---

## 引用

- `[doc:roleagent.md#第5章]` — Eval：Harness 的自我代谢系统
- `[doc:review/review.md#第八章]` 8.5 节 — RA-031~RA-036 Eval 自代谢补审（6 项，4 P0）
- `[doc:review/review.md#第十三章]` 13.1 节 — CL-001~CL-006 自我进化三模式 + Eval Ledger
- `[doc:features/F018-eval-contract.md]` — Eval Contract 五问
- `[doc:features/F019-three-signal-cross.md]` — 三方信号交叉
- `[doc:features/F020-seven-attribution.md]` — 七类归因矩阵
- `[doc:features/F040-harness-eval-control-plane.md]` — Harness Eval 控制面
- `[doc:clowder-ai/docs/decisions/F100-self-evolution.md]` — 自我进化三模式 + Eval Ledger
- `[doc:decisions/007-harness-engineering.md]` — Harness 工程路径（Entropy Control 退役联动）
- `[doc:decisions/008-memory-federation.md]` — 多域记忆联邦（消费加权信号来源）
- `[doc:decisions/011-partnership-math.md]` — 伙伴系统数学（Token 账本包含心智负载）
- `[doc:design/naming-contract.md#2.7]` — 灵锻（SpiritForge，Mode C 知识进化）
- `[doc:design/naming-contract.md#2.8]` — 锻典（Mind Codex，五级成熟度阶梯载体）
- `[doc:design/naming-contract.md#2.9]` — 灵议（Mind Council，Mode A Scope Guard 审批）
- `[doc:project_rules.md#T6]` — E2E 测试必须采集 MetricsCollector 完整指标
- `[doc:project_rules.md#铁律2]` — 质量分阈值默认 0.85（可在 Loop 配置中覆盖）
