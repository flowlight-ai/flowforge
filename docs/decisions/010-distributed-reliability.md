# ADR 010: 分布式可靠性（Distributed Reliability）

> **状态**: accepted
> **日期**: 2026-07-21
> **决策者**: operator + 架构师灵智体（Forgekin）
> **依赖**: `[doc:roleagent.md#第6章]` + `[doc:decisions/007-harness-engineering-path.md]`
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 6 章工程路径

---

## 1. 上下文

`[doc:roleagent.md#第6章]` 开篇指出："当三只不同厂商的 agent 同时在一个代码库里工作——一只做重构、一只跑测试、一只写文档——你已经在运行一个分布式系统，不管你是否意识到。"

FlowForge（flowlight-ai/flowforge 通用底座）的能力画像驱动团队比固定岗位流水线更依赖状态连续性：谁做过什么、谁正在接手、哪个判断已经被验证，都不能因为一个会话断开而丢失。然而当前系统面临三类真实的失败模式（按时间顺序撞上）：

- **第一类·单灵智体长任务持久性**：任务持续几分钟到几十分钟时，通信通道几乎必然中断。`[doc:roleagent.md#第6章]` 提到三种故障——副作用已执行但通道断了（不能盲目重试）、本地成功但远程失败（race condition）、provider 返回空响应（需要理解错误语义）。
- **第二类·跨灵智体协作一致性**：TeamAct 循环中 Route 阶段是最脆弱的窗口——前一只做完 Action 但没来得及更新 Evidence 就崩了，后一只接球看到半截状态。`[doc:roleagent.md#第6章]` 记录了真实的 liveness split-brain：两个后端读路径对同一 invocation 给出矛盾结果。
- **第三类·跨 provider 语义一致性**：Claude、GPT、Gemini、Antigravity 等 provider 的超时策略、错误码语义、通道协议、恢复机制各不相同。同一套可靠性规则不能绑死在某一家实现上。

行业大多数 multi-agent 讨论把可靠性压在 prompt 和 orchestration 层面处理，但分布式系统的核心教训是：**你不可能消除故障，你只能设计对故障的容忍**。本 ADR 记录 P1-6 阶段落地的 5 个可靠性原语（F021-F025）如何把分布式系统经典工具箱（Saga / WAL / Liveness Probe / Workflow Engine / Failover Pool）搬进 FlowForge。

---

## 2. 决策

### 2.1 Tier 1-4 恢复分级（Retry / Failover / Rollback / Escalate）

`[doc:roleagent.md#第6章]` 强调"不是所有操作都能安全重试"，并给出四级表格。我们将其落地为 `RecoveryTier` 枚举与 `TierRecoveryService`：

- `RecoveryTier.TIER_1_RETRY`：瞬态错误，自动重试同一目标（读取 / 构建 / 测试 / lint）
- `RecoveryTier.TIER_2_FAILOVER`：provider 故障，切换到 `failover_targets` 列表中的备份
- `RecoveryTier.TIER_3_ROLLBACK`：副作用已发生，通过 WAL 回滚（共享文件 / 外部服务 / GitHub 写操作）
- `RecoveryTier.TIER_4_ESCALATE`：force-push / merge / release / 不可逆操作——**永远不自动恢复，dispatch 前硬拒**

分级原则是 **fail-closed**：`TierRecoveryService.handle_failure` 对未注册 `error_type` 的故障默认归入 `TIER_4_ESCALATE`，而非最低级——这与 `[doc:roleagent.md#第6章]` "遇到未知操作类型默认归入最高限制，不是最低"完全一致。`RecoveryPolicy` 数据类持有 `tier / max_retries / retry_delay_seconds / failover_targets / rollback_strategy` 字段，由调用方按错误类型通过 `register_policy(error_type, policy)` 注册；重复注册会抛 `ReliabilityError`，防止策略漂移。

退化规则在 `handle_failure` 内部生效，保证任何路径都不会"无声失败"：

- TIER_1_RETRY：`target = error.source`，`notes` 提示最大重试次数与间隔
- TIER_2_FAILOVER：若 `failover_targets` 为空 → 降级为 ESCALATE（"nowhere to fail over"）；否则 `target = failover_targets[0]`，`notes` 列出剩余备选
- TIER_3_ROLLBACK：若 `error.wal_entries` 为空 → 降级为 ESCALATE（"nothing to roll back"）；否则 `notes` 报告待回滚条目数与 `rollback_strategy`
- TIER_4_ESCALATE：`notes = "unrecoverable; escalate to operator"`

### 2.2 Side-Effect WAL（预写日志）— 副作用可回滚

借鉴数据库 Write-Ahead Log（`[doc:roleagent.md#第6章]` 称其为"类似数据库预写日志的副作用记录"），`WriteAheadLog` 类在副作用执行**之前**追加一条 `WalEntry` 记录。`WalEntry` 持有 `entry_id / action / target / params / created_at / status` 五个字段，`params` 在 `append` 时 `copy.deepcopy` 防止调用方后续篡改审计轨迹；`get` 也返回深拷贝，确保审计轨迹不可变。

生命周期通过 `WalStatus` 三态枚举管理：`PENDING`（已追加未确认）→ `COMMITTED`（副作用确认落盘）或 `ROLLED_BACK`（已补偿）。从 PENDING 可迁出到 COMMITTED 或 ROLLED_BACK，但 COMMITTED 与 ROLLED_BACK 是终态——`mark_committed` / `mark_rolled_back` 检测到非 PENDING 状态时抛 `ReliabilityError`，防止状态机被错误回退。`list_uncommitted` 返回所有 PENDING 条目（按 `created_at` 升序）供恢复层 replay——幂等的重试执行，非幂等的走补偿。`append` 要求 `action` 与 `target` 非空，否则拒绝写入。存储当前为内存 dict，生产可换 SQLite/PostgreSQL 而不改变 surface API（对齐 DurableStateSurface 的存储策略）。

### 2.3 Liveness 探活（心跳 + 租约）

`LivenessProbe` 是路由前的**只读模型**——它永不改变状态，只报告。任何灵智体可声明 `LivenessSpec`（`name / description / sla_seconds / required_for`），并注册一个异步 check 函数。`run_all` 串行执行所有探针，每个 `ProbeResult` 携带 `name / healthy / latency_ms / last_checked / error`，探针间相互隔离——一个抛异常不影响其他。

`required_for` 列出依赖该探针的能力名，探针不健康时这些能力被标记为退化。恢复决策**不**由探针做出，而是由 `TierRecoveryService` 基于探针结果触发——这是 `[doc:roleagent.md#第6章]` "给数据不给结论"原则的体现。

### 2.4 Weak State vs Strong Workflow（弱状态与强工作流）

`[doc:roleagent.md#第6章]` 明确："不是'弱状态机 vs 强状态机'二选一。开放协作使用轻量状态机保留模型判断力；严肃副作用使用强 workflow 保证可审计、可回放、可拒绝。" 落地为 `StateWorkflowComparator.classify_workflow`：

- `WorkflowStrength.STRONG`：每步都 `has_compensation=True` 且 `idempotent=True` 且不 `requires_external_state` → 推荐 "use workflow engine"（可重放）
- `WorkflowStrength.WEAK`：无任何步骤可补偿 → 推荐 "use state machine"（仅 checkpoint 重启）
- `WorkflowStrength.HYBRID`：混合 → 推荐 "hybrid"（workflow engine + 非可补偿步骤走状态机检查点）

`WorkflowStep` 数据类的 `requires_external_state` 字段标记第三方 API 依赖——重放会与外部状态去同步，必须显式隔离。

### 2.5 Provider Host（提供者宿主）— 多提供者故障转移

`ProviderHost` 是 provider 无关的宿主抽象——模块**刻意不**import `flowforge.llm.provider`，"provider" 在这里指任何可寻址宿主（LLM 厂商 / 搜索后端 / 发布通道）。`ProviderInfo` 暴露 `name / priority / healthy / last_state_change`，`priority` 数字越小优先级越高（1 优于 2）。

`select_provider(exclude)` 在健康且不在 `exclude` 列表的候选中选优先级最高者，返回 `None` 表示全部不可用。`mark_unhealthy` / `mark_healthy` 翻转健康标志并记录 `last_state_change`，供 dashboard 与 SLA 监控消费。failover 时把失败 provider 加入 `exclude`，下一次 `select_provider` 自然跳过——这与 `TierRecoveryService` 的 TIER_2_FAILOVER 协同。

### 2.6 RecoveryPolicy 与 FailureContext

`FailureContext` 数据类把失败场景结构化：`error_type / error_message / source / wal_entries`。`wal_entries` 字段把 WAL 与 Tier 恢复连接起来——当 `error_type="side_effect_failed"` 触发 TIER_3_ROLLBACK 时，`TierRecoveryService.handle_failure` 检查 `error.wal_entries` 是否非空，空则降级为 ESCALATE（"nothing to roll back"）。`RecoveryAction` 输出 `tier / action / target / notes`，`notes` 携带可读决策理由供审计与 trace 追溯。所有路径经 `get_logger` 写入结构化日志，自动注入 `trace_id`。

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 五原语组合（WAL + Tier + Liveness + State-Workflow + ProviderHost）** | 与 `[doc:roleagent.md#第6章]` 三类失败模式一一对应；provider 无关；fail-closed 默认安全；每个原语可独立测试 | 五个独立模块协同复杂度高；当前内存存储需生产化迁移 |
| 方案 B: 单一 Orchestration Engine + Prompt 兜底 | 实现简单，单一抽象 | `[doc:roleagent.md#第6章]` 明确反对"用更好的提示词让 agent 不出错"——分布式故障不能靠 prompt 消除 |
| 方案 C: 强一致 Raft 共识 | 提供线性一致性 | LLM 参与者是不可控的，无法保证内部行为；Raft 物理延迟对 agent 协作过重；`[doc:roleagent.md#第6章]` 明确"不提供 Raft 级别强一致保证，但够用" |
| 方案 D: 全部交给 Provider SDK 自带重试 | 零自研成本 | 不同 provider 语义不一致（`[doc:roleagent.md#第6章]` 第三类挑战）；副作用已执行时盲目重试会双发；无法跨 provider failover |

---

## 4. 理由

- `[doc:roleagent.md#第6章]` 核心论断："架构是假设不可控的一定会出问题，然后设计可控层的容错能力"——五原语各自覆盖一类可控层。
- operator 7 条原则要求"可靠性治理的工程路径"，本 ADR 把 roleagent.md 第 6 章的工程账本（Saga 协调器 / WAL / 四级恢复 / 结构化恢复卡 / 统一宿主抽象）落到可调用 API。
- fail-closed 默认拒绝符合 `[doc:roleagent.md#第6章]` "Tier 4 操作即使任务完全正常也需要人类确认"——`TierRecoveryService.handle_failure` 对未知 error_type 与退化场景统一升级到 ESCALATE。
- `ProviderHost` 刻意不依赖 `flowforge.llm.provider`，与 project_rules 红线 10（禁止在 flowforge 写死业务领域代码）一致，可靠性层可被 *Forge 复用。
- `StateWorkflowComparator` 把"弱状态 vs 强工作流"二选一升级为三分法（STRONG / WEAK / HYBRID），匹配 roleagent.md "开放协作用弱状态机，严肃副作用用强 workflow" 的双轨主张。
- 五个原语通过 `FailureContext.wal_entries` 与 `ProviderHost.select_provider(exclude)` 形成闭环：探针发现不健康 → Tier 服务决定 FAILOVER → ProviderHost 跳过失败者 → 若副作用已落盘则走 WAL 回滚。

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| WAL 当前为内存存储，进程崩溃即丢失 | 接口设计已预留 SQLite/PostgreSQL 替换路径，P2 阶段补齐持久化后端 |
| Tier 恢复策略依赖人工注册 `register_policy`，未知错误默认 ESCALATE 可能告警风暴 | ESCALATE 由 operator 审计队列消费；P3 阶段引入策略模板自动注册 |
| Liveness 探针 `run_all` 串行执行，探针数量多时延迟累积 | 当前规模（<10 探针）下可接受；超规模时切并发执行（`asyncio.gather`） |
| `StateWorkflowComparator.classify_workflow` 仅做静态分析，运行时外部状态漂移不被感知 | 与 Liveness 探针联动——`requires_external_state=True` 的步骤同时注册探针，运行时退化时触发 ESCALATE |
| `ProviderHost.select_provider` 同优先级按注册顺序，可能造成热点 | P2 阶段在同优先级内引入加权随机或轮询 |
| 五原语间无统一可观测视图 | 已通过 `get_logger` 写入结构化日志与 trace_id；P5 阶段接入 Grafana 仪表盘 |

---

## 6. 否决理由

- **方案 B（单一 Orchestration + Prompt 兜底）**：`[doc:roleagent.md#第6章]` 明确"用更好的提示词让 agent 不出错"是分布式系统的反模式；prompt 不能消除网络故障与 provider 语义差异。
- **方案 C（Raft 共识）**：roleagent.md 第 6 章已否决——"参与者是不同厂商的 LLM，你控制不了它们的内部行为"。Raft 要求参与者可预测且低延迟，LLM 不满足。Cat Café 协作状态机"故意保留判断力"，强一致会扼杀开放任务的路径探索。
- **方案 D（依赖 Provider SDK 自带重试）**：roleagent.md 第 6 章第三类挑战专门讨论了 provider 语义不一致——同一套可靠性规则不能绑死某一家。SDK 重试无跨 provider failover，无副作用 WAL，无 Tier 分级，遇到副作用已执行的故障会双发。

---

## 7. 参与者

- operator（愿景锚点 + 最终决策 + 7 条不可妥协原则）
- 架构师灵智体（Forgekin，方案设计 + 术语对齐项目正式命名）
- 可靠性灵智体（实现 P1-6 五原语代码 + 真实 Antigravity alpha smoke 验证）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-21 | 初始版本，确立分布式可靠性五原语决策（WAL / Tier Recovery / Liveness / State-Workflow / Provider Host），术语对齐项目正式命名（灵智体 Forgekin / 灵忆 EchoStore） | operator + 架构师灵智体 |

---

## 引用

- `[doc:roleagent.md#第6章]` — 可靠性：多 agent 是分布式系统（三类可靠性挑战 + 不可控与可控 + 解锁任务深度）
- `[doc:roleagent.md#第1章]` — 核心公式：能力 × Harness 契合度
- `[doc:decisions/007-harness-engineering-path.md]` — Harness 工程路径（依赖）
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（前置决策）
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表）
- `[doc:project_rules.md#红线10]` — 禁止在 flowforge 中写死业务领域代码
- `flowforge/core/reliability/side_effect_wal.py` — F021 实现（`WalEntry` / `WriteAheadLog` / `WalStatus`）
- `flowforge/core/reliability/tier_recovery.py` — F022 实现（`RecoveryTier` / `TierRecoveryService` / `RecoveryPolicy` / `FailureContext`）
- `flowforge/core/reliability/liveness.py` — F023 实现（`LivenessSpec` / `LivenessProbe` / `ProbeResult`）
- `flowforge/core/reliability/state_workflow.py` — F024 实现（`WorkflowStrength` / `WorkflowStep` / `StateWorkflowComparator`）
- `flowforge/core/reliability/provider_host.py` — F025 实现（`ProviderInfo` / `ProviderHost`）
