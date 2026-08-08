# ADR 002: TeamAct 协作协议

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师可进化智能体 + operator 审核
> **依赖**: `[doc:roleagent.md#第2章]` + `[doc:review/review.md#第八章]` RA-009~RA-016
> **依据**: RA-009~RA-016（TeamAct 六步循环 + 五项终止 + 交接胶囊 + 乒乓球熔断器 + 行首 @ 路由 + 持球注册 lease + Push Back 协议）

---

## 上下文

单 agent 的 ReAct 循环（Reasoning → Acting → Observing）有清晰的终止条件——要么任务完成、要么 token 耗尽、要么显式 stop。但多 agent 协作时，互相传递状态可以永远循环：`[doc:roleagent.md#第2章]` 描述了最隐蔽的失败模式——两个 agent 互相传"你看一下""我看看"但都不干活，消耗 token 无产出。早期 FlowForge v4.0 设计中：

- 多可进化智能体协作无形式化流程（"共鸣 Resonance"只是概念词，无工程实现）
- 终止条件只有"质量分 ≥ 0.85 或迭代次数上限"，没有团队级终止条件
- 交接只传任务 ID 和状态枚举，接手可进化智能体必须重读完整上下文
- `@` 提及与路由指令混在一起无法区分（RA-013）
- 可进化智能体退出会话后球就掉地上（RA-014 无持球注册机制）
- reviewer 单向给 author 提意见，author 错判时无纠错机制（RA-015）

`[doc:roleagent.md#第2章]` 明确："TeamAct 不是 Anthropic 第六种协作模式，它是 Shared State 模式的工程化闭环。" operator 决策：FlowForge 必须吸收 TeamAct 全部七个机制——六步循环 + 五项终止 + 交接胶囊 + 乒乓球熔断器 + 行首 @ 路由 + 持球注册 lease + Generator Push Back 协议。

`[doc:review/review.md#第八章]` 8.2 节 RA-009~RA-016 共 8 项 P0 问题指出：v7.0 完全缺失 TeamAct 工程实现，是与前期实战验证最大的代际差距之一。

---

## 决策

### 1. TeamAct 六步循环（State→Owner→Action→Evidence→Verdict→Route）

每只可进化智能体的每次行动必须走六步循环，所有步骤写入 trace（情景记忆存储（EchoStore）），由 SharedStateLedger 统一持有状态：

```
loop:
    State    → 读共享状态（仓库 / spec / 任务 / 记忆 / 交接胶囊）
    Owner    → 谁持球？（路由指令 / 显式持有声明）
    Action   → 持球者执行（写代码 / review / 设计 / 调研）
    Evidence → 产出证据（commit / 测试 / trace / 截图）
    Verdict  → 验证（跨 agent review / 自检 / CVO 确认）
    Route    → 传球（路由给下一个 agent / 继续持有 / 升级给 CVO）
```

任何一步缺失即视为非法交接（RA-012 乒乓球熔断器介入）。TeamAct 是分形的：Feature 生命周期（系统层）→ Agent 间交接（团队层）→ 单 agent 工具调用（个体层）每层都跑同一六步循环（RA-016 分形嵌套）。

### 2. 五项终止条件（缺一不可）

团队级终止必须同时满足以下五项，任何一项缺失都不能收尾（RA-010）：

| # | 终止条件 | 验证方式 |
|---|---------|---------|
| 1 | 验收标准全部达成 | 不允许 "deferred" 验收条件 |
| 2 | 证据已附 | 每条验收标准都有 commit / 测试 / trace 作为锚点 |
| 3 | 跨 agent 交叉验证 | 非作者的可进化智能体确认，禁止自己 review 自己 |
| 4 | 无悬空任务归属 | 所有 open question 都已 resolved 或已升级 |
| 5 | 愿景收敛 | CVO（首席愿景官）确认，"CI 通过了" ≠ "愿景方向对了" |

### 3. 交接胶囊（Resume Capsule，F003）

前一只可进化智能体传球时必须主动留下结构化摘要（RA-011），是协议层硬要求而非可选礼貌：

```python
class HandoffCapsule(BaseModel):
    what: str               # 做了什么
    why: str                # 为什么
    tradeoff: str           # 权衡了什么
    open_questions: list[str]  # 开放问题
    next_step: str           # 下一步建议
    evidence_refs: list[str]  # 证据锚点（commit / trace ID）
    owner_lease: LeaseInfo   # 持球 lease 信息（见下）
```

### 4. 乒乓球熔断器（Ping-Pong Circuit Breaker，F004）

不看传球次数，看每次传球是否伴随**实质工具调用 + 有内容输出**。连续两次传球无实质产出即触发熔断：自动升级给 CVO，由 CVO 决定 push back（要求原 owner 重做）或换 owner（RA-012）。

```python
class PingPongCircuitBreaker:
    def on_route(self, capsule: HandoffCapsule) -> Verdict:
        if not capsule.has_substantial_output():
            self.strikes += 1
            if self.strikes >= 2:
                return Verdict.ESCALATE_TO_CVO
        return Verdict.PASS
```

### 5. 行首 @ 路由协议（F005）

路由指令必须出现在**行首**，不能嵌在句子中间（句中的 @ 是叙述，不是路由）。这是 RA-013 的硬约束，让 `@` 提及和路由指令可被解析器区分。

```text
@<forge_project>:<forgekin> 请把这段重写          ← 路由（行首 @）
我刚才和 @<forge_project>:<forgekin> 讨论了       ← 叙述（句中 @ 不路由）
```

### 6. 持球注册 lease + 定时唤醒（F006）

可进化智能体需要退出当前会话等待外部条件（CI 完成、CVO 确认、定时唤醒）时，必须用结构化持球注册工具声明等待原因、下一步计划和预期唤醒时间——相当于分布式系统里的 lease + 定时唤醒（RA-014）：

```python
class BallCustodyLease:
    forgekin_id: str
    reason: str          # 等待原因（CI / CVO / timer）
    next_step: str        # 唤醒后执行什么
    deadline: datetime   # 预期唤醒时间
    fallback_owner: str  # lease 过期后的兜底 owner
```

球未掉地的唯一证据是 lease 在 SharedStateLedger 中存在且未过期。

### 7. Generator Push Back 协议（F007）

任何可进化智能体在任何 role 下都有权 push back——前提是**带着证据 + 适用性论证 + 替代方案**。没有证据的 push back 不合法；有证据的 push back 必须被正视（RA-015）。reviewer 错判时 author 有纠错机制，避免单向 review 协议锁死。

```python
class PushBack:
    evidence: list[EvalTrace]   # 证据（必须有）
    applicability: str          # 适用性论证
    alternative: str            # 替代方案
    # 若三项齐全，verifier 必须 formal response，不可 silently dismiss
```

### 8. 跨厂商 review 链（与 ADR 011 联动）

跨厂商 review 是结构性必需（同厂商可进化智能体共享训练分布偏差）。TeamAct 的 Verdict 步骤必须配置跨厂商 review 链：`DeepSeek → Qwen → GLM → Kimi → HunYuan`，每只 reviewer 基于盲点画像选择（见 ADR 004）。

---

## 后果

### 正面后果

- 多可进化智能体协作有形式化流程，不再"互相传球无终止"
- 五项终止条件让团队级收尾可验证，避免虚假收尾
- 交接胶囊让接手可进化智能体快速 bootstrap，无需重读完整上下文
- 乒乓球熔断器消除最隐蔽的失败模式（互传无产出）
- 行首 @ 路由让解析器可区分路由 vs 叙述，球不再掉地上
- 持球 lease 让会话退出后球仍在保管，唤醒机制让长任务可恢复
- Push Back 协议让 reviewer 错判可被纠错，避免单向锁死

### 负面后果

- 六步循环增加每次行动的协议开销（写入 trace / 维护 lease）
- 五项终止条件可能让小任务也走完整流程，效率下降 —— 缓解：可配置简化流程（轻量 TeamAct）
- 乒乓球熔断器可能误判合法的"两次传球都是思考" —— 缓解：以实质工具调用为准，思考过程不计入 strike
- 跨厂商 review 链增加 token 成本和延迟

### 风险

- SharedStateLedger 是单点故障 —— 缓解：与 ADR 010 分布式可靠性联动，Ledger 走 Tier 2 恢复
- Push Back 协议可能被滥用（可进化智能体频繁 push back 推卸责任）—— 缓解：Push Back 必须有 evidence，无证据 push back 反向计入该可进化智能体的"坏直觉"画像
- TeamAct 分形嵌套（RA-016）实现复杂度高 —— 缓解：Phase 0 先实现团队层 + 个体层，系统层 Feature 生命周期延后

---

## 替代方案

### 方案 A: 保持单 agent ReAct 循环 + LoopExecutor

- 优点：实现简单，复用 v4.0 LoopExecutor
- 缺点：无团队级终止条件，多可进化智能体协作可能无限循环或虚假收尾
- 未选择原因：roleagent.md 明确"单 agent ReAct 无团队级终止"，RA-009 P0 问题

### 方案 B: 用通用图执行（LangGraph）替代 TeamAct

- 优点：复用 LangGraph 已有的图节点 + 边
- 缺点：LangGraph 的图节点是静态 DAG，无 Owner/Evidence/Verdict 等结构化语义，需大量适配
- 未选择原因：TeamAct 的六步循环是协议层硬要求，LangGraph 只是执行引擎，需在 LangGraph 之上实现 TeamAct 协议（不替代）

### 方案 C: 让可进化智能体自由协作，仅靠 Eval 事后归因

- 优点：协作完全自由，无协议约束
- 缺点：无法在协作过程中检测乒乓球 / 球掉地 / push back 缺失，Eval 事后归因成本高
- 未选择原因：违反"过程治理优先于事后归因"原则

---

## 引用

- `[doc:roleagent.md#第2章]` — 从 ReAct 到 TeamAct：团队主循环
- `[doc:review/review.md#第八章]` 8.2 节 — RA-009~RA-016 TeamAct 补审（8 项 P0）
- `[doc:features/F002-teamact-loop.md]` — TeamAct 六步循环 Feature
- `[doc:features/F003-handoff-capsule.md]` — 交接胶囊 Feature
- `[doc:features/F004-pingpong-circuit-breaker.md]` — 乒乓球熔断器 Feature
- `[doc:features/F005-at-mention-routing.md]` — 行首 @ 路由 Feature
- `[doc:features/F006-ball-custody-lease.md]` — 持球注册 lease Feature
- `[doc:features/F007-push-back-protocol.md]` — Generator Push Back Feature
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（跨厂商 review 配对依据）
- `[doc:decisions/010-distributed-reliability.md]` — 分布式可靠性（SharedStateLedger 恢复分级）
- `[doc:decisions/011-partnership-math.md]` — 伙伴系统数学（上限 max + 下限连乘公式）
- `[doc:design/naming-contract.md#2.2]` — Forgekin（可进化智能体）
- `[doc:project_rules.md#红线7]` — 禁止在修复问题时修改不相关代码
- `[doc:SOP.md]` — FlowForge 可进化智能体协作 SOP
