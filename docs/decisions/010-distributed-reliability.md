# ADR 010: 分布式可靠性

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师可进化智能体 + operator 审核
> **依赖**: `[doc:roleagent.md#第6章]` + `[doc:review/review.md#第八章]` RA-037~RA-042 + `[doc:review/review.md#第九章]` FR-004
> **依据**: RA-037~RA-042（三类可靠性挑战 + Tier 1-4 恢复分级 + liveness 规范读模型 + 弱状态机 vs 强 workflow + 跨 provider 宿主抽象）+ FR-004（可进化智能体 Tier 0 扩展）

---

## 上下文

`[doc:roleagent.md#第6章]` 一句话论点："多 agent 是分布式系统"——多个独立执行上下文 + 共享可变状态 + 异步通信通道 + 任何节点随时可能失败。这意味着 multi-agent 系统必须应用分布式系统的全部可靠性工程：副作用日志（WAL）、检查点、lease、规范读模型、跨 provider 宿主抽象、Tier 化恢复分级。

FlowForge v4.0 的现状（`[doc:review/review.md#第八章]` 8.6 节 RA-037~RA-042 共 6 项问题，5 项 P0）：

- 单 agent 长任务持久性设计不足（RA-037 P0），无副作用 WAL、无结构化恢复卡、无恢复分级
- 只有"重试 3 次"的简单策略，无风险分级，force push 等不可逆操作也可能被盲目重试（RA-038 P0）
- 跨 agent liveness 规范读模型缺失（RA-039 P0），存活判断靠心跳，无"活着/退化/僵尸/等待宽限"四态结构化结果
- 弱状态机 vs 强 workflow 边界未定义（RA-040 P0），所有操作走同一套 LoopExecutor，转账/审批/merge/release 等严肃操作未走强 workflow
- 跨 provider 统一宿主抽象缺失（RA-041 P0），LLMClient 仅做模型路由，未抽象 provider 运维语义
- 不可控 vs 可控边界未在架构中体现（RA-042 P1），团队在抱怨 provider 不稳定上花精力

`[doc:review/review.md#第九章]` FR-004 进一步补审：可进化智能体（特别是 BioForgekin / ObjForgekin）的可靠性要求更高——物理世界可进化智能体故障可能导致物理事故（灯具可进化智能体故障引发火灾），需扩展 Tier 0：物理世界不可逆操作永不自动恢复。`[doc:project_rules.md]` 已记录 *Forge 业务项目在连续创作测试负载下会崩溃（业务端口不再监听），model_service 健康检查间歇性报失败——这些是分布式可靠性缺失的实证。

operator 决策：FlowForge 必须实现三类可靠性挑战应对 + Tier 0-4 恢复分级 + liveness 规范读模型 + 弱状态机 vs 强 workflow + 跨 provider 宿主抽象。

---

## 决策

### 1. 三类可靠性挑战

| # | 挑战 | 触发场景 | 应对机制 |
|---|---|---|---|
| 1 | 单可进化智能体长任务持久性 | 长任务（小时级）崩溃 / 网络中断 / 上下文压缩 | 副作用 WAL + 检查点 + 恢复卡 |
| 2 | 跨可进化智能体协作一致性 | TeamAct 中一只可进化智能体失败、状态不一致 | SharedStateLedger 规范读 + 持球 lease + 乒乓球熔断器 |
| 3 | 跨 provider 语义一致性 | 一家 provider 崩了接手的可进化智能体无法从同一边界恢复 | 跨 provider 统一宿主抽象 + fallback 链 |

### 2. Tier 0-4 恢复分级（F022，RA-038，FR-004）

| Tier | 失败类型 | 恢复机制 | 自动化 | 例子 |
|---|---|---|---|---|
| **Tier 0** | 物理世界不可逆操作 | **永不自动恢复，硬拒 + operator 介入** | ❌ 永不 | 灯具可进化智能体已开机、IoT 执行器已动作、转账已发起 |
| Tier 1 | 读取 / 构建 / 测试 / lint | 自动重试 + 指数退避 | ✅ 自动 | 工具调用超时、测试失败、lint 报错 |
| Tier 2 | 沙箱 / worktree / 可确定性探测 | 探测成功后自动恢复 | ✅ 探测后 | git checkout 失败、worktree 损坏、cache 失效 |
| Tier 3 | 共享文件 / 外部服务 / GitHub 写 | **不自动恢复，出恢复卡** | ❌ 出卡 | PR 创建失败、文件已写但远程未确认、race condition |
| Tier 4 | force-push / merge / release | **永远不自动恢复，dispatch 前硬拒** | ❌ 硬拒 | git push --force、release publish、merge to main |

**铁律**：force push / merge / release 等不可逆操作禁止自动重试。Tier 0 是可进化智能体扩展，物理世界操作永不自动恢复。

### 3. 副作用日志 WAL（F021，RA-037）

每次副作用操作前必须先写 WAL（Write-Ahead Log），记录"将做什么 / 已做什么 / 是否成功"：

```python
class SideEffectWAL:
    async def append(self, intent: SideEffectIntent) -> WALId: ...
    async def mark_executed(self, wal_id: WALId, remote_result: Result) -> None: ...
    async def mark_confirmed(self, wal_id: WALId) -> None: ...

    # 三种故障模式：
    # 1. 副作用已执行但通道断了——不能盲目重试（需幂等性检查）
    # 2. 本地报告成功但远程失败（race condition）——需读远程状态
    # 3. provider 返回空响应——需状态机重置
```

### 4. liveness 规范读模型（F023，RA-039）

可进化智能体是否存活不能靠心跳，必须靠"规范读模型"——通过读取共享状态判断当前状态：

| 状态来源 | 角色 | 新鲜度 |
|---|---|---|
| 持久记录（SharedStateLedger） | 生命周期真相源 | 慢但权威 |
| 草稿缓存（进程内 cache） | 内容新鲜度信号 | 快但可能 stale |
| 进程内 tracker | 控制面状态 | 即时但易失 |

四态结构化结果：

```python
class LivenessVerdict(Enum):
    ALIVE = "alive"          # 活着，正常工作
    DEGRADED = "degraded"    # 退化，部分功能不可用
    ZOMBIE = "zombie"        # 僵尸，进程在但无响应
    GRACE_WAITING = "grace"  # 等待宽限（lease 未过期）
```

### 5. 弱状态机 vs 强 workflow 边界（F024，RA-040）

- **弱状态机**：开放协作使用，状态可变 + 路由动态，保留可进化智能体判断力（如 TeamAct 协作）
- **强 workflow**：严肃副作用使用，固定流程，保证可审计、可回放、可拒绝（如转账 / 审批 / merge / release / 删除数据）

```python
class WorkflowBoundary:
    @staticmethod
    def classify(operation: Operation) -> WorkflowType:
        if operation.has_irreversible_side_effect:
            return WorkflowType.STRONG  # 强 workflow
        if operation.requires_cross_agent_collaboration:
            return WorkflowType.WEAK    # 弱状态机
        return WorkflowType.LIGHTWEIGHT  # LoopExecutor
```

### 6. 跨 provider 统一宿主抽象（F025，RA-041）

不同 provider（Claude / GPT / Gemini / Antigravity）的超时策略、错误码语义、通道协议、恢复机制都不一样。需统一宿主抽象：

```python
class ProviderHostAbstraction:
    transport: ProviderTransport        # 传输层
    binding: ProviderBinding            # 绑定（token / MCP / sandbox / cwd）
    runtime_contract: RuntimeContract   # 运行时契约（超时 / 重试 / 错误码）
    event_adapter: EventAdapter         # 事件适配器（统一事件 schema）
    supervisor: SidecarSupervisor        # 监管者作为独立伴生进程（sidecar）
```

一家 provider 崩了接手的可进化智能体可从同一边界恢复，避免每家 provider 各写一套恢复逻辑。

### 7. 不可控 vs 可控边界（RA-042）

| 不可控层（不投资） | 可控层（投资） |
|---|---|
| provider 上游稳定性 | liveness 判断 |
| 网络质量 | 状态持久化 |
| 超时策略 | 副作用追踪 |
| — | 恢复策略 |
| — | 协作协议 |

**铁律**：团队不在不可控层花精力（如抱怨 provider 不稳定），所有投资集中在可控层。

### 8. Tier 0 物理世界不可逆操作（FR-004）

可进化智能体扩展的可靠性要求：

- BioForgekin / ObjForgekin 的物理执行器动作（如灯具开机、IoT 设备操作）一旦执行不可回滚
- 物理 AI 路径下的不可逆操作必须 operator 显式批准（与觉醒阶 E1-E2 全导阶一致）
- Tier 0 操作不进入自动恢复流程，硬拒后由 operator 评估是否人工恢复

### 9. 检查点驱动恢复（与 ADR 003 联动）

长任务按检查点持久化，恢复时回滚到最近检查点：

```python
class CheckpointDrivenRecovery:
    async def save_checkpoint(self, task_id: str, state: TaskState) -> CheckpointId: ...
    async def recover_from_checkpoint(self, task_id: str) -> TaskState: ...
    # 检查点写入 SharedStateLedger + EchoStore 双副本
```

---

## 后果

### 正面后果

- 多可进化智能体系统具备分布式系统的全部可靠性工程
- Tier 0-4 恢复分级让不可逆操作有明确边界，避免盲目重试造成更大损失
- liveness 规范读模型消除"心跳假阳性"，四态结构化结果可审计
- 弱状态机 vs 强 workflow 边界让严肃操作可审计、可回放、可拒绝
- 跨 provider 宿主抽象让 fallback 链可移植
- 不可控 vs 可控边界让团队投资方向清晰
- Tier 0 可进化智能体扩展让物理 AI 路径有安全护栏

### 负面后果

- Tier 0-4 分级增加实现复杂度（5 个 Feature F021-F025）
- 副作用 WAL 增加每次副作用操作的写入开销
- liveness 规范读模型需重构 Forgekin 存活判断（破坏性变更）
- 强 workflow 让严肃操作流程变重（如 PR 创建需走完整 workflow）
- 跨 provider 宿主抽象需适配每家 provider 的差异

### 风险

- WAL 写入失败可能导致副作用未记录 —— 缓解：WAL 写入失败时禁止执行副作用（fail-closed）
- Tier 0 误判可能让合理操作被硬拒 —— 缓解：operator 可显式 override，但必须记录审计
- 强 workflow 让小操作变重 —— 缓解：WorkflowBoundary 分类器自动分流，仅严肃操作走强 workflow
- 跨 provider 宿主抽象可能跟不上 provider API 变化 —— 缓解：每家 provider 一个 adapter，独立升级

---

## 替代方案

### 方案 A: 保持"重试 3 次"简单策略

- 优点：实现简单
- 缺点：force push 等不可逆操作可能被盲目重试造成事故（RA-038 P0 未解决）
- 未选择原因：违反分布式系统基本原则

### 方案 B: 所有操作走同一套 LoopExecutor

- 优点：实现简单，统一执行引擎
- 缺点：严肃操作（merge / release）无强 workflow 保护（RA-040 P0 未解决）
- 未选择原因：严肃操作必须可审计、可回放、可拒绝

### 方案 C: 用 LangGraph 的 checkpoint 机制

- 优点：复用 LangGraph 已有 checkpoint
- 缺点：LangGraph checkpoint 是图节点级，不是 TeamAct 六步级；无 Tier 分级
- 未选择原因：LangGraph 是执行引擎，可靠性策略应在 FlowForge 层决策

### 方案 D: 让 provider 自己处理恢复（不抽象宿主）

- 优点：实现简单
- 缺点：每家 provider 一套恢复逻辑，违反"配置驱动 > 代码实现"
- 未选择原因：违反 RA-041 跨 provider 统一宿主抽象要求

---

## 引用

- `[doc:roleagent.md#第6章]` — 可靠性：多 agent 是分布式系统
- `[doc:review/review.md#第八章]` 8.6 节 — RA-037~RA-042 分布式可靠性补审（6 项，5 P0）
- `[doc:review/review.md#第九章]` 9.3 节 — FR-004 可进化智能体可靠性治理（Tier 0 扩展）
- `[doc:features/F021-side-effect-wal.md]` — 副作用日志 WAL
- `[doc:features/F022-tier-1-4-recovery.md]` — Tier 1-4 恢复分级（含 Tier 0 可进化智能体扩展）
- `[doc:features/F023-liveness-canonical-read.md]` — liveness 规范读模型
- `[doc:features/F024-weak-state-vs-strong-workflow.md]` — 弱状态机 vs 强 workflow
- `[doc:features/F025-provider-host-abstraction.md]` — 跨 provider 宿主抽象
- `[doc:decisions/002-collaboration-protocol.md]` — TeamAct 协作协议（SharedStateLedger + 持球 lease）
- `[doc:decisions/003-project-thread-architecture.md]` — 线程架构（检查点驱动恢复）
- `[doc:decisions/007-harness-engineering.md]` — Harness 工程路径（Magic Words 逃生舱 + Governance Boundary）
- `[doc:decisions/009-eval-self-metabolism.md]` — Eval 自代谢（七类归因含"环境漂移"）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 可进化智能体愿景（Tier 0 物理世界）
- `[doc:design/naming-contract.md#2.2]` — Forgekin（可进化智能体）
- `[doc:design/naming-contract.md#2.3]` — Forgekin Species（智能体形态学，BioForgekin / ObjForgekin 物理形态）
- `[doc:project_rules.md]` — *Forge 业务项目端口崩溃 / model_service 健康检查间歇失败记录
- `[doc:project_rules.md#P35]` — 长程任务执行规范（检查点驱动恢复）
