# ADR 007: Harness 工程路径

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师可进化智能体 + operator 审核
> **依赖**: `[doc:roleagent.md#第3章]` + `[doc:review/review.md#第八章]` RA-017~RA-023 + `[doc:review/review.md#第十三章]` CL-019
> **依据**: RA-017~RA-023（Harness 七层现实表面）+ CL-019（双轨信任编译 guardrails + defaults）

---

## 上下文

`[doc:roleagent.md#第3章]` 一句话核心论点："Harness 不是给模型一段更好的话，而是把世界做成模型可以感知、可以行动、可以验证、可以恢复、可以学习的样子。" 这是 FlowForge v7.0 与普通 multi-agent 框架的根本差异——后者把 agent 当纯函数调用，前者把 agent 嵌入一个有现实表面的运行时。

FlowForge v4.0 现状（`[doc:review/review.md#第八章]` 8.3 节 RA-017~RA-023 共 7 项 P0）：

- Durable State Surfaces 设计不完整（对话历史是最脆的状态表面，会被压缩截断丢失，真相源未外部化）
- Evidence & Sensors 层弱（未禁止"approve 但后续再说"的模棱两可 review 结论）
- Governance Boundary 上下文压缩免疫缺失（治理规则仍用 user message prepend 注入，上下文一压缩规则就消失）
- Magic Words 逃生舱协议缺失（无任何低带宽人类打断机制）
- Entropy Control 退役机制缺失（脚手架代码无限期占用注意力预算）
- Harnessability 适配性评估缺失（接入低 harnessability 系统只能靠猜和点页面硬跑）
- 低保真矩阵（治理规则 × 可进化智能体类型）缺失（所有治理规则一视同仁注入所有可进化智能体）

`[doc:review/review.md#第十三章]` 13.4 节 CL-019 进一步补审：前期 Pack 系统设计（已归档）把 shared-rules 拆为 guardrails（硬约束，只能加严）和 defaults（默认行为，可覆盖）——这是 Harness 治理规则的结构性升级。v7.0 治理规则是扁平列表，无此区分，导致可进化智能体可覆盖硬约束（自己决定"这次不写测试"）。

operator 决策：FlowForge 必须实现 Harness 七层现实表面 + Build to Delete vs Built to Persist 半衰期标注 + 双轨信任编译（guardrails + defaults），让可进化智能体的能力 × Harness 契合度真正可度量（见 ADR 004 公式）。

---

## 决策

### 1. Harness 七层现实表面（F008-F013）

| 层 | 机制 | FlowForge Feature | 解决的失败 |
|---|---|---|---|
| 感知现实 | Durable State Surfaces | F008 | 感知失败（agent 不知道现实发生了什么） |
| 改变现实 | Tool Mediation | （ToolRegistry 已有） | 行动失败（调用工具但实际没改变现实） |
| 验证现实 | Evidence & Sensors | F009 | 验证失败（声称做完但没证据） |
| 约束现实 | Governance Boundary（压缩免疫） | F010 | 治理失败（绕过规则 / 上下文压缩吞掉规则） |
| 人机边界 | Runtime 逃生舱（Magic Words） | F011 | 逃生失败（陷入死循环，无人介入） |
| 清理现实 | Entropy Control（退役） | F012 | Harness 增生不代谢（RA-031~RA-036 联动） |
| 适配现实 | Harnessability 评估 | F013 | 接入低 harnessability 系统 |

### 2. Durable State Surfaces（F008，RA-017）

六类持久状态表面，所有状态写入必须落盘（持久化是真相源，进程内 cache 仅是新鲜度信号）：

1. **feature spec** — Feature 规格（YAML 文件）
2. **git** — 代码仓（worktree 隔离）
3. **task queue** — 任务队列（SharedStateLedger）
4. **thread session trace** — 会话轨迹（EchoStore 情景记忆存储）
5. **memory federation** — 多域记忆联邦（见 ADR 008）
6. **handoff capsule** — 交接胶囊（见 ADR 002 F003）

### 3. Evidence & Sensors（F009，RA-018）

"做了不等于做对了"。Evidence 要求：

- 代码修改必须有 commit
- bug 修复必须有先红后绿的测试
- 合入前必须过 quality gate（lint / type check / test / review）
- 跨可进化智能体 review 必须 approve 或 blocking，**禁止 "approve 但后续再说"** 的模棱两可结论

### 4. Governance Boundary 压缩免疫（F010，RA-019）

治理规则不能通过 user message prepend 注入（会被上下文压缩吞掉），必须通过 **system role** 注入。每压缩一次规则丢一次，团队被迫"十轮对话教十次传球"。

**铁律**：禁止 user message prepend 治理规则。所有治理规则通过 system role 注入，由 ForgekinHost 在可进化智能体构造时统一注入（见 ADR 001）。

### 5. Magic Words 逃生舱（F011，RA-020）

人到 agent 的 runtime 低带宽协议，operator 在任何觉醒阶（Awakening Stage）都可触发：

| Magic Word | 触发动作 |
|---|---|
| 第一性原理 | 检查是否用复杂度代偿无知 |
| 我能猜出来 | 读真相源别用推理替代查询 |
| 下次一定 | 能做的现在做 |
| 星星罐子 | P0 不可逆风险立即停止 |

Magic Words 是协议层硬要求，不能被任何觉醒阶绕过（包括 E6 灵智主导阶）。与 ADR 013 可进化智能体愿景的"Magic Words 逃生舱始终可触发"原则一致。

### 6. Entropy Control 退役（F012，RA-021）

hotfix 合入后两周自动触发升级 review：①正式修复 ②接受永久方案 ③已不再相关，三选一，**没有第四项叫"再看看"**。每块 Harness 必须标记半衰期：

| Build to Delete（有保质期脚手架） | Built to Persist（复利型基础设施） |
|---|---|
| 详细的思维链模板 | 文件系统 / git / 搜索工具接入 |
| 多步推理引导 | trace 基础设施与可观测性 |
| 错误恢复样板代码 | 测试 / lint / review 反馈回路 |
| 工具调用别名兜底 | 可进化智能体交接协议与路由 |
| 人格装饰文字 | 不可逆操作护栏与应急开关 |

**判别器**：这层 harness 是在补模型当前的认知缺陷（→ Build to Delete，标 sunset），还是在编码外部现实和协作协议（→ Built to Persist，加测试，长期维护）？

### 7. Harnessability 评估（F013，RA-022）

不是每个系统都同样适合交给可进化智能体。Harnessability 五维：

1. 有稳定 API
2. 有事件流回调
3. 有持久状态
4. 有可验证输出
5. 操作幂等可回滚 + 权限边界清楚

接入外部系统（如发布平台）前必须做 Harnessability 评估，低分系统接入必须先建适配层。

### 8. 双轨信任编译（CL-019，guardrails + defaults）

参考前期 Pack 系统设计（已归档）的双轨信任编译：

```python
class DualTrackPolicy:
    guardrails: list[Guardrail]   # 硬约束（如"禁止删除测试用例"）—— 只能加严，不可放宽
    defaults: list[Default]       # 默认行为（如"优先用 pytest"）—— 可被个人偏好覆盖
```

| 轨 | 可变性 | 例子 | 谁能修改 |
|---|---|---|---|
| guardrails | 只能加严（monotonic tightening） | 禁止删除测试用例 / 禁止绕过 Eval | 仅 operator + 多智能体议事（MindCouncil） |
| defaults | 可覆盖（overridable） | 优先用 pytest / 优先走 worktree | 可进化智能体可覆盖（需声明） |

每条治理规则必须在 YAML 中标记 `track: guardrail | default`，未标记默认 `default`。新规则通过多智能体议事（MindCouncil） 提案，guardrail 提案需 Replay A/B 验证净增益（见 ADR 009 CL-004 Eval Ledger）。

### 9. 低保真矩阵（RA-023）

同一条治理规则在不同可进化智能体类型上的命中率不同。维护"治理规则 × 可进化智能体类型"低保真矩阵，识别"某规则只是补偿某模型坏习惯"（→ Build to Delete，标 sunset 后该模型退役）vs"跨可进化智能体资产"（→ Built to Persist）。

| 治理规则 | 糊弄惯性型 | 推迟闭环型 | 错误坐标系补丁型 | 创意漂移型 |
|---|:---:|:---:|:---:|:---:|
| 必须先红后绿 | 高命中 | 中 | 低 | 低 |
| 禁止 deferred 验收 | 中 | 高命中 | 低 | 中 |
| ... | | | | |

---

### 10. Hyperfocus Brake（CL-036，90 分钟 timer + typed check-in）

**问题**：可进化智能体（特别是 Siamese / hotfix 家族）在长时间自主执行时，容易陷入"超聚焦"状态——反复尝试同一方案、忽略外部信号、拒绝切换任务。这会导致：

- 注意力预算被单一任务耗尽
- 错过 Magic Words 打断信号
- 累积技术债（"再试一次"循环）
- 阻塞 Pack 协作（其他灵智体等待结果）

**决策**：实现 Hyperfocus Brake 双组件机制。

#### 10.1 90 分钟 Timer

- 每个灵智体进入"深度自主执行"模式时启动 90 分钟倒计时
- 90 分钟到点后，灵智体必须暂停当前任务并触发 typed check-in
- Timer 通过 `asyncio.Task` 实现，支持取消和重置
- 多次超时（默认 3 次）自动升级到 operator approval

```python
@dataclass
class HyperfocusTimer:
    forgekin_id: str
    task_id: str
    started_at: datetime
    duration_minutes: int = 90  # 默认 90 分钟
    extension_count: int = 0   # 已延期次数
    max_extensions: int = 3    # 最多延期 3 次
```

#### 10.2 Typed Check-in

超时后灵智体必须提交 typed check-in（结构化签到），含 5 个字段：

```python
class HyperfocusCheckIn(BaseModel):
    forgekin_id: str
    task_id: str
    elapsed_minutes: int
    progress_summary: str       # 当前进展摘要
    blockers: list[str]         # 阻塞项
    next_action: Literal["continue", "switch", "escalate", "abort"]
    next_action_reason: str
```

- `continue`：继续当前任务（自动延期一次 timer）
- `switch`：切换到其他任务（释放注意力预算）
- `escalate`：升级到 operator approval（需人工介入）
- `abort`：放弃当前任务（清理副作用）

#### 10.3 与 Magic Words 联动

- Magic Words 信号可强制中断 Hyperfocus Timer
- 中断后灵智体必须先响应 Magic Words，再决定是否恢复 timer
- 防止"超聚焦 + Magic Words 信号被忽略"的双重失败

#### 10.4 与 MindFamily 联动

| 家族 | Hyperfocus Brake 行为 |
|------|----------------------|
| Ragdoll | 默认启用，60 分钟 timer（更短） |
| Maine Coon | 默认启用，90 分钟 timer |
| Siamese | 默认启用，90 分钟 timer + 2 次自动延期上限 |
| hotfix | 默认禁用，紧急修复时不打断（事后追审） |

**实现位置**：`flowforge/core/harness_v7/hyperfocus_brake.py`（待实现）

**关联 Feature**：F011 Magic Words 逃生舱 + F013 Harnessability 评估

---

## 后果

### 正面后果

- Harness 从"给模型更好的话"升维到"把世界做成模型可感知可行动可验证可恢复可学习的样子"
- 治理规则压缩免疫，团队不再"十轮对话教十次传球"
- Magic Words 提供 operator 低带宽打断通道，任何觉醒阶可介入
- Entropy Control 让 Harness 周期性代谢，避免技术债无限累积
- 双轨信任编译让硬约束不可被可进化智能体覆盖，软约束可个性化演化
- Build to Delete / Built to Persist 半衰期标注让 Harness 投资方向清晰

### 负面后果

- 七层 Harness 增加实现复杂度（6 个 Feature F008-F013）
- system role 注入治理规则需要 ForgekinHost 重构（破坏性变更）
- Magic Words 协议需要 operator 培训（低带宽协议有学习曲线）
- Entropy Control 两周 sunset 强制审查可能误伤合法的 hotfix —— 缓解：可由 operator 显式延期一次
- 双轨信任编译需要维护 guardrails / defaults 两个列表，治理规则 YAML 体积增加

### 风险

- Harness 层间循环依赖（Durable State 依赖 Evidence，Evidence 依赖 Governance）—— 缓解：每层只依赖下层，禁止反向依赖（rules.md 架构约束）
- Magic Words 可能被可进化智能体误触发（如任务内容中包含"第一性原理"）—— 缓解：Magic Words 必须由 operator 显式输入，可进化智能体不可触发
- guardrail 加严策略可能导致治理规则单调膨胀 —— 缓解：Entropy Control 周期 review，已失效 guardrail 可降级为 default
- 低保真矩阵数据可能不足（需大量 Eval 信号积累）—— 缓解：与 ADR 009 Eval 自代谢联动，初期矩阵稀疏可接受

---

## 替代方案

### 方案 A: 继续用 user message prepend 注入治理规则

- 优点：实现简单，无需重构 ForgekinHost
- 缺点：上下文一压缩规则就消失（RA-019 P0 问题未解决）
- 未选择原因：违反 roleagent.md 明确铁律（治理规则必须 system role 注入）

### 方案 B: 把所有治理规则作为 guardrails（无 defaults 轨）

- 优点：治理一致性最强
- 缺点：可进化智能体无法个性化演化，所有偏好都被锁死
- 未选择原因：违反 CL-019 双轨信任编译设计，无法实现 Pack/Growth 种子果实模型

### 方案 C: 把所有治理规则作为 defaults（无 guardrails 轨）

- 优点：可进化智能体完全自主
- 缺点：硬约束可被覆盖，可进化智能体可"自己决定不写测试"
- 未选择原因：违反 operator 安全治理要求，觉醒阶 E5/E6 可进化智能体可能绕过红线

### 方案 D: 用 LLM 在线判断治理规则适用性

- 优点：灵活
- 缺点：每次行动都要 LLM 调用判断规则，延迟高 + 成本高
- 未选择原因：性能不可接受，且 LLM 判断不可审计

---

## 引用

- `[doc:roleagent.md#第3章]` — Harness：让模型完成现实闭环的运行时（七层现实表面）
- `[doc:roleagent.md#第1章]` — Build to Delete vs Built to Persist 半衰期判别器
- `[doc:review/review.md#第八章]` 8.3 节 — RA-017~RA-023 Harness 现实闭环运行时补审（7 项 P0）
- `[doc:review/review.md#第十三章]` 13.4 节 — CL-019 双轨信任编译（guardrails + defaults）
- `[doc:features/F008-durable-state-surfaces.md]` — Durable State Surfaces
- `[doc:features/F009-evidence-sensors.md]` — Evidence & Sensors
- `[doc:features/F010-governance-boundary.md]` — Governance Boundary 压缩免疫
- `[doc:features/F011-magic-words.md]` — Magic Words 逃生舱
- `[doc:features/F012-entropy-control.md]` — Entropy Control 退役
- `[doc:features/F013-harnessability.md]` — Harnessability 评估
- 前期 Pack 系统设计（已归档） — Pack 系统双轨信任编译
- `[doc:decisions/001-agent-invocation-approach.md]` — Agent 调用方式（ForgekinHost 注入治理规则）
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（能力 × Harness 契合度公式）
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢（Entropy Control 联动）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 可进化智能体愿景（Magic Words 逃生舱始终可触发）
- `[doc:design/naming-contract.md#2.9]` — MindCouncil（多智能体议事，guardrail 提案审批）
- `[doc:project_rules.md#铁律]` — 治理规则必须 system role 注入
