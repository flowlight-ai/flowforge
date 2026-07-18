# ADR 003: 项目线程架构

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师灵智体 + operator 审核
> **依赖**: `[doc:roleagent.md#第3章]` + `[doc:review/review.md#第八章]` RA-037~RA-042
> **依据**: roleagent.md §3 Harness 现实状态层 + 第八章分布式可靠性补审

---

## 上下文

FlowForge v7.0 任务执行的线程模型必须在四种选项中抉择：单线程、多线程（OS 线程）、协程（asyncio）、异步事件循环。这一决策直接影响：

- 多灵智体（Forgekin / Spirit Agent）能否真正并行（5 个 WebChat 评委并行评审）
- 跨灵智体共享状态如何隔离（一只灵智体的副作用不能污染另一只）
- LLM 调用、工具调用、I/O 操作的并发模型（`[doc:project_rules.md]` 要求"所有 I/O 操作使用 async/await"）
- 长任务的持久化与恢复（RA-037 单 agent 长任务持久性设计不足）
- 物理 AI 路径下传感器接入与执行器控制的可预测性

`[doc:roleagent.md#第3章]` 强调 Harness 工程操作的是**第三层现实状态**——代码仓 / git 历史 / 任务归属 / 记忆——这是唯一一层跨推理、跨灵智体、跨时间持续存在的状态。线程模型必须保证现实状态的隔离与共享语义清晰：跨灵智体共享通过 SharedStateLedger，单灵智体私有状态通过 worktree 隔离。

operator 指示（2026-07-17）：FlowForge 必须支持"自己开发自己"——这意味着线程模型必须能容纳长程任务（小时级）、检查点驱动恢复、半压缩优于半压缩（rules.md P35）。简单多线程无法满足这些要求，简单单线程无法满足 5 评委并行需求。

---

## 决策

### 1. 单一 asyncio 事件循环作为协作主线程

FlowForge 全部灵智体协作跑在单一 asyncio 事件循环中。所有 I/O 操作（LLM 调用、工具调用、Repository 读写、记忆检索）必须使用 async/await（铁律：禁止阻塞调用）。

```python
async def main():
    host = container.resolve("forgekin_host")
    async with TeamActSession(task_id=TASK_ID) as session:
        await session.run_teamact_loop()

if __name__ == "__main__":
    asyncio.run(main())
```

### 2. 灵智体 worktree 隔离

每只灵智体的代码副作用通过 git worktree 物理隔离。一只灵智体不能直接修改另一只灵智体的 worktree。这同时满足 RA-040 弱状态机 vs 强 workflow 边界：开放协作在 worktree 内（弱状态机），严肃副作用（merge / release / force-push）走强 workflow（见 ADR 010）。

```python
class ForgekinWorktree:
    forgekin_id: str
    worktree_path: Path  # 如 /tmp/flowforge/worktrees/{forgekin_id}/{task_id}
    base_branch: str     # 主干分支
    feature_branch: str  # 该灵智体本任务的工作分支
    isolation_level: IsolationLevel  # FULL / SHARED_READ / NONE
```

### 3. 跨灵智体共享状态通过 SharedStateLedger

跨灵智体协作**禁止通过进程内变量共享**，必须通过 `SharedStateLedger` 持久化共享。Ledger 是 TeamAct 六步循环的 State 步骤唯一读取源（见 ADR 002）：

```python
class SharedStateLedger:
    """跨灵智体共享状态——持久化是真相源，进程内 cache 仅是新鲜度信号。"""
    async def read_state(self, key: str) -> StateValue: ...
    async def write_state(self, key: str, value: StateValue, writer: str) -> None: ...
    async def acquire_lease(self, forgekin_id: str, reason: str, deadline: datetime) -> Lease: ...
```

Ledger 持久化到 SQLite（任务/审计）+ OpenSieve PostgreSQL（文档索引）。进程内 tracker 仅是控制面状态，不是真相源（RA-039 liveness 规范读模型）。

### 4. CPU 密集任务走线程池

asyncio 事件循环跑 LLM 调用 / 工具调用 / I/O，但 CPU 密集任务（如重计算、向量检索批处理）必须走 `asyncio.to_thread` 或独立进程，避免阻塞事件循环：

```python
result = await asyncio.to_thread(heavy_compute, input_data)
```

### 5. 多 provider 并行用 asyncio.gather

5 评委并行评审（DeepSeek / Qwen / GLM / Kimi / HunYuan）必须用 `asyncio.gather`，禁止串行调用。每个 reviewer 在独立 worktree 中运行，结果汇入 SharedStateLedger：

```python
async def parallel_review(task: Task, reviewers: list[str]) -> list[Verdict]:
    return await asyncio.gather(*[
        review_with(forgekin_id=r, task=task)
        for r in reviewers
    ])
```

### 6. 检查点驱动恢复（与 ADR 010 联动）

长任务必须按检查点持久化（rules.md P35），ThreadActor 退出会话后由检查点驱动恢复。检查点写入 SharedStateLedger + EchoStore 双副本：

```python
class Checkpoint:
    task_id: str
    step: int                # 当前 TeamAct 步骤
    owner: str               # 当前持球灵智体
    capsule: HandoffCapsule  # 交接胶囊
    side_effect_wal: list[SIDEffect]  # 副作用日志（见 ADR 010 F021）
```

### 7. 线程模型与 Tier 恢复分级对应

| Tier | 失败类型 | 线程模型影响 |
|------|---------|--------------|
| Tier 1 | 单次工具调用失败 | 自动重试，事件循环不退出 |
| Tier 2 | 单灵智体会话失败 | 接力新灵智体接手，worktree 保留 |
| Tier 3 | 多灵智体协作失败 | 回滚到检查点，重新编排 |
| Tier 4 | 系统级失败 | operator 介入，事件循环终止 |

### 8. 物理 AI 传感器接入走独立 IO 协程

万物灵智体（特别是 BioForgekin / ObjForgekin）的传感器接入走独立 IO 协程，事件循环订阅传感器事件流。传感器协程不阻塞协作主循环（见 ADR 013 万物灵智体愿景）。

---

## 后果

### 正面后果

- 单事件循环简化协作模型，避免多线程共享状态锁竞争
- async/await 满足 rules.md 铁律（所有 I/O 操作 async/await）
- worktree 隔离让灵智体副作用可审计、可回滚（每只灵智体独立分支）
- SharedStateLedger 作为真相源消除进程内 cache 漂移（RA-039）
- asyncio.gather 天然支持 5 评委并行评审
- 检查点驱动恢复让长任务可中断、可恢复

### 负面后果

- 单事件循环无法利用多核 CPU（CPU 密集任务必须走线程池）
- worktree 隔离增加磁盘开销（每只灵智体一份 worktree）
- SharedStateLedger 持久化增加每次状态写入延迟
- asyncio 学习曲线对开发者较高

### 风险

- 单事件循环阻塞风险 —— 缓解：lint 强制检测阻塞调用（如 time.sleep / requests.get）
- worktree 资源泄漏（任务完成后未清理）—— 缓解：Entropy Control 退役机制（见 ADR 007）+ lease 过期自动清理
- SharedStateLedger 单点故障 —— 缓解：与 ADR 010 分布式可靠性联动，Ledger 走 Tier 2 恢复
- 多 provider 并行可能触发限流 —— 缓解：跨 provider 宿主抽象（见 ADR 010 F025）+ 退避策略

---

## 替代方案

### 方案 A: 多线程（OS 线程）模型

- 优点：可利用多核 CPU，灵智体真并行
- 缺点：GIL 限制 Python 多线程；共享状态需锁；async/await 与线程混用复杂
- 未选择原因：rules.md 已规定 async/await，多线程与现有规范冲突

### 方案 B: 多进程模型（每只灵智体一个进程）

- 优点：进程隔离彻底，单只灵智体崩溃不影响其他
- 缺点：进程间通信开销大；SharedStateLedger 必须走 IPC；5 评委并行启动慢
- 未选择原因：进程隔离过重，与 worktree 隔离语义重叠

### 方案 C: 同步阻塞模型（单线程 + 同步调用）

- 优点：实现简单，调试容易
- 缺点：无法并行 LLM 调用，5 评委评审需 10 倍时间；I/O 阻塞浪费 CPU
- 未选择原因：违反 rules.md 铁律（所有 I/O 操作 async/await）

### 方案 D: LangGraph 内置线程模型

- 优点：复用 LangGraph 已有线程管理
- 缺点：LangGraph 的线程模型与 TeamAct 六步循环不完全对齐
- 未选择原因：LangGraph 是执行引擎，线程模型应在 FlowForge 层决策

---

## 引用

- `[doc:roleagent.md#第3章]` — Harness：让模型完成现实闭环的运行时（现实状态层）
- `[doc:roleagent.md#第1章]` — Agent 状态三层（权重 / 计算 / 现实）
- `[doc:review/review.md#第八章]` 8.6 节 — RA-037~RA-042 分布式可靠性补审
- `[doc:features/F021-side-effect-wal.md]` — 副作用日志 WAL
- `[doc:features/F023-liveness-canonical-read.md]` — liveness 规范读模型
- `[doc:features/F024-weak-state-vs-strong-workflow.md]` — 弱状态机 vs 强 workflow
- `[doc:features/F025-provider-host-abstraction.md]` — 跨 provider 宿主抽象
- `[doc:decisions/002-collaboration-protocol.md]` — TeamAct 协作协议（SharedStateLedger 持有者）
- `[doc:decisions/007-harness-engineering.md]` — Harness 工程路径（Durable State Surfaces）
- `[doc:decisions/010-distributed-reliability.md]` — 分布式可靠性（Tier 1-4 恢复分级）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物灵智体愿景（物理 AI 传感器接入）
- `[doc:design/naming-contract.md#2.2]` — 灵智体（Forgekin / Spirit Agent）
- `[doc:project_rules.md#铁律]` — 所有 I/O 操作使用 async/await
- `[doc:project_rules.md#P35]` — 长程任务执行规范（检查点驱动恢复）
