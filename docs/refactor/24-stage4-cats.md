# 阶段 4：灵智体系统 cats（对齐 Clowder AI，改造为 Cordis 插件）

> 目标：移植 clowder-ai `domains/cats` 核心，实现灵智体（Forgekin）档案/注册表/调用队列/
> 编排/转录/蒸馏/存储层。品牌命名沿用 Forgekin，内部机制对齐 cats。
>
> **核心约束（R13 插件化）**：clowder-ai 用的是"手写组合根 + Fastify 插件 + 裸类 new"模式；
> flowforge 一切皆插件，cats 域全部改造为 **Cordis 插件**——每个服务变成 `Service` 子类挂载到
> `ctx`，依赖通过 `ctx.inject()` / `ctx.get()` 注入，生命周期由 Cordis fiber 管理。
> 持久化后端从 Redis 替换为 **sqlite**（对齐 dsh session-persistence-sqlite 模式）+ Memory。

## 架构改造映射

| clowder-ai 模式 | flowforge 改造 |
|---|---|
| `catRegistry` 模块级单例 | `CatRegistry extends Service` → `ctx.cats`（dsh 风格 `export default class`） |
| `new InvocationQueue()` 手写组合根 | `@flowforge/cats-invocation` 插件，`ctx.catsInvocation` |
| `createXxxStore(redis?)` 工厂 | `@flowforge/cats-stores` 插件，`ctx.catStores` |
| Fastify `app.register(route, {deps})` | typert RPC 域（阶段5 chat 域处理 HTTP/WS） |
| Redis Lua CAS 脚本 | sqlite 事务 CAS（`better-sqlite3`） |
| `process.once('SIGTERM', shutdown)` | Cordis fiber dispose 自动清理 |
| `@cat-cafe/shared` workspace 包 | `@flowforge/cats-shared` workspace 包 |
| 测试 `node:assert` + `.test.js` + 模块单例 | `vitest` `expect` + `.spec.ts` + `new Context()` + `await ctx.plugin()` |

## 插件化审查（2026-08-17）

对照 dsh 范式审查批次1+2 实际产出，确认：

✓ **代码层面已完全对齐"一切皆插件"**：
- `CatRegistry` `extends Service` → `ctx.cats`，`ctx.effect()` 管理 register 生命周期，`export default CatRegistry`（dsh 风格，无函数包裹）
- `CatStores` `extends Service` → `ctx.catStores`，访问器返回 port 接口而非具体类
- `MemoryStoresBackend` `extends Service`，`static inject = ['catStores']`，`ctx.effect()` 管理注册/清理
- 无 clowder-ai / @cat-cafe / deepseek 命名空间残留
- 默认 Plugin 同时挂载 CatStores + MemoryStoresBackend（聚合服务 + 默认后端的合理复合插件模式）

✓ **本次修复（同 PR）**：
- 删除破损测试 `normalize-cat-id.test.js`（导入已删除的 `catRegistry` 单例）
- 新建 `normalize-cat-id.spec.ts`：Cordis 模式（`await ctx.plugin(CatRegistry)` + `ctx.cats` + vitest expect）
- 简化 `cats-shared/src/index.ts` 默认导出 → `export default CatRegistry`（对齐 dsh `export default class`）
- 清理 `cats/shared/package.json` 不存在的子路径导出（`./types` 指向不存在的 `src/types.ts`）
- 清理陈旧 lib 构建产物（含残留 `new CatRegistry()` 单例代码）
- 修正 `stub-ports.ts` 注释 off-by-one（实际 29 个 port：5 核心 + 24 stub）
- 13 个 `.test.js` 风格陈旧（仍用 `node:assert` + `.js` 路径）但功能可用，后续批次统一改为 `.spec.ts`

⚠ **待补差距**（不阻塞本批次）：
- clowder-ai `TaskManagedWorkRegistrationStore` port 未在 flowforge 声明（批次3 cats-invocation 引入时补）
- 24 个 stub port 的实际方法签名待批次3-5 随依赖服务落地补全
- Memory 后端缺 `static Config` Schemastery schema（Sqlite 后端必须补，本批次 Memory 后端无配置项）

## 批次与任务清单

### 批次 1：`@flowforge/cats-shared`（类型/schema/纯函数 + CatRegistry Service）✅

- [x] T4.1.1 移植 types/（CatId/CatConfig/Profile/Message/Thread/Task 等全部类型定义）— 完成
- [x] T4.1.2 移植 schemas/（zod schema：cat-id/message/command/signals/world/pack）— 完成
- [x] T4.1.3 移植 utils/（text-utils/command-parser/eval-metric-ref 等纯函数，**排除 redis.ts**）— 完成
- [x] T4.1.4 移植 registry/（CatRegistry → 改造为 `CatRegistry extends Service`，`ctx.cats`）— 完成
- [x] T4.1.5 移植 dossier/（dossier profile 解析/加载纯函数）— 完成
- [x] T4.1.6 移植 concierge/（pet-skin-projection 纯函数）— 完成
- [x] T4.1.7 移植 profile-frontmatter-parser / profile-contract / scanner-discovery-pure — 完成
- [x] T4.1.8 移植 approval-producer-catalog / capability-tips / cli-effort / core-commands 等顶层纯函数 — 完成
- [x] T4.1.9 测试：normalize-cat-id / frontmatter 解析 / command-parser / dossier profile — Cordis 模式重写完成

### 批次 2：`@flowforge/cats-stores`（存储 ports + Memory 后端 Cordis 插件）✅

- [x] T4.2.1 创建 `@flowforge/cats-stores` 包骨架（package.json/tsconfig.json/tsdown.config.ts/invariant.ts）— 完成
- [x] T4.2.2 移植 ports/（IMessageStore/IThreadStore/ITaskStore/IBacklogStore/IMemoryStore
      /ISessionChainStore/IDraftStore/ISummaryStore/ITurnExecutionStore/IInvocationRecordStore
      /IReadStateStore/ILabelStore/IPendingRequestStore/IProposalStore/IPushSubscriptionStore
      /IAuthorizationAuditStore/IAuthorizationRuleStore/ICommunityIssueStore/ICommunityIssueDraftStore
      /ICommunityPrStore/IFrustrationIssueStore/IDossierDistillationProposalStore/IDossierObservationStore
      /IDeliveryCursorStore/IGameStore/IMemoryGovernanceStore/IProfileUpdateProposalStore
      /ISessionHandoffProposalStore/IWorkflowSopStore 等 29 个接口）— 完成（5 核心 + 24 stub）
- [x] T4.2.3 创建 `CatStores extends Service` → `ctx.catStores`，含 `registerBackend(name, backend)`
      /`messages()`/`threads()`/`tasks()`/`backlogs()`/`memory()` 等访问器；并发后端用 `static inject = ['catStores']` — 完成
- [x] T4.2.4 实现 Memory 后端插件 `MemoryStoresBackend extends Service`：
      `MemoryMessageStore`/`MemoryThreadStore`/`MemoryTaskStore`/`MemoryBacklogStore`/`MemoryMemoryStore`
      全部移植到 `memory/`，构造时由 `ctx.plugin(MemoryStoresBackend)` 挂载到 `ctx.catStoresMemory`（含
      `declare module '@flowforge/cordis'` Context augmentation）— 完成
- [x] T4.2.5 测试：port 契约单测（memory 后端：append/getById/getByThreadAfter/softDelete 等）— 完成（73 测试通过）
- [ ] T4.2.6 Sqlite 后端单独成包 `@flowforge/cats-stores-sqlite`（CAS 用事务替代 Redis Lua）
      — **拆分到独立批次**，本批次仅交付 Memory + 接口契约

### 批次 3：`@flowforge/cats-invocation`（调用队列/调度/tracker 插件）

> 设计：参考 dsh `@flowforge/jobs` 范式（`JobRegistry extends Service` + 子插件 backend），
> 将 InvocationQueue/Tracker/Processor 改造为 Cordis Service，全部挂载到 `ctx.catsInvocation`。
> 补全 clowder-ai `TaskManagedWorkRegistrationStore` port。
>
> **批次3 子任务分解**（实施进度：）：
> - 批次3.1 ✅ cats-shared 补全 invocation/queue-entry/session-mutex/zombie 类型 + invocation-state-machine 纯函数
> - 批次3.2 ✅ cats-stores 补全 IInvocationRecordStore/ITaskManagedWorkRegistrationStore/ITaskProgressStore ports + Memory 实现
> - 批次3.3 ✅ 创建 @flowforge/cats-invocation 包骨架 (package.json/tsconfig/invariant.ts)
> - 批次3.4 ✅ 实现 InvocationQueueService/InvocationTrackerService/SessionMutexService/TaskProgressService (Cordis Service 抽象+Memory实现)
> - 批次3.5 ⏳ 实现最小骨架 QueueProcessorService + reconcileZombies/StartupReconciler 纯函数
> - 批次3.6 ⏳ 编写 .spec.ts 测试 + 类型检查 + mgr sync PR

#### 批次3.1：cats-shared 类型 + 状态机纯函数 ✅

- [x] T4.3.0.1 移植 `types/invocation.ts`（InvocationId/InvocationRecord/InvocationStatus/CreateInvocationInput/UpdateInvocationInput/CreateInvocationOutcome/UpdateInvocationOutcome + 品牌类型生成函数）
- [x] T4.3.0.2 移植 `types/queue-entry.ts`（QueueEntry/EnqueueResult/EnqueueOutcome/MAX_QUEUE_DEPTH + 生成函数）
- [x] T4.3.0.3 移植 `types/session-mutex.ts`（SessionLockOwner/SessionLockScope/ForceReleaseOptions/ForceReleaseResult）
- [x] T4.3.0.4 移植 `types/zombie.ts`（ZombieRecord/ZombieReason/InvocationRecoveryStatus/LiveInvocation/LivenessReason/ReconcileZombieResult）
- [x] T4.3.0.5 移植 `invocation-state-machine.ts`（isValidTransition/classifyInvocationRecoveryStatus 纯函数 + VALID_TRANSITIONS 表）
- [x] T4.3.0.6 在 `cats-shared/src/index.ts` 导出 `invocation-state-machine.ts`（修复 isValidTransition 未导出）

#### 批次3.2：cats-stores ports + Memory 后端 ✅

- [x] T4.3.2.1 创建 `ports/invocation-record-store.ts`（IInvocationRecordStore 严格契约，使用 InvocationId/ThreadId/UserId/InvocationRecord 品牌类型；StoreUpdateInvocationInput/StoreCreateInvocationOutcome/StoreUpdateInvocationOutcome 拆分 store 层类型）
- [x] T4.3.2.2 创建 `ports/task-progress-store.ts`（ITaskProgressStore 严格契约，使用 CatId/ThreadId/InvocationId 品牌类型；TaskProgressSnapshot/TaskProgressItem/SetSnapshotOptions）
- [x] T4.3.2.3 创建 `ports/task-managed-work-registration-store.ts`（ITaskManagedWorkRegistrationStore 严格契约，去耦 clowder-ai 原版的 TaskStore host 依赖；ManagedWorkBindingConflict/UpsertManagedWorkBindingOutcome）
- [x] T4.3.2.4 从 `ports/stub-ports.ts` 移除 IInvocationRecordStore stub；ports/index.ts 导出 3 个新 port（不重导出品牌类型，避免 barrel 冲突）
- [x] T4.3.2.5 创建 `memory/invocation-record-store.ts`（MemoryInvocationRecordStore：bounded Map(500) + 5min TTL 去重 + state-machine + CAS + executionStartedAt 守护）
- [x] T4.3.2.6 创建 `memory/task-progress-store.ts`（MemoryTaskProgressStore：Map<Thread, Map<Cat, Snapshot>>，原子 CAS deleteSnapshotIfOwner）
- [x] T4.3.2.7 创建 `memory/task-managed-work-registration-store.ts`（MemoryTaskManagedWorkRegistrationStore：taskId→binding 正向索引 + workId:attemptId→taskId 反向索引）
- [x] T4.3.2.8 扩展 `CatStores` 聚合服务（CatStoresBackend 新增 3 个 optional 字段 + 3 个访问器 invocationRecords()/taskProgress()/taskManagedWorkRegistrations()，未注册时抛错）
- [x] T4.3.2.9 更新 `MemoryStoresBackend`：实例化 3 个新 store + 注册到 backend + 暴露 3 个 getter（invocationRecords/taskProgress/taskManagedWorkRegistrations）
- [x] T4.3.2.10 创建 3 个 `.spec.ts` 测试（36 测试覆盖 create+dedupe+TTL / state machine+CAS / listRunningByThread / eviction / scanAll / setSnapshot+getSnapshot+deleteSnapshotIfOwner CAS / upsert+conflict+bind+reverse-lookup）
- [x] T4.3.2.11 修复 cats-shared 中 unused import（invocation.ts: generateId / zombie.ts: InvocationRecord）和 ports/index.ts 中 ICommunityPrStores→ICommunityPrStore 拼写
- [x] T4.3.2.12 类型检查 + 全部 109 测试通过（73 既有 + 36 新增）

#### 批次3.3-3.6：cats-invocation 包 + Cordis Service 层

> **批次3.3-3.6 子任务分解**（实施进度：）：
> - 批次3.3 ✅ 创建 @flowforge/cats-invocation 包骨架 (package.json/tsconfig/invariant.ts) + 抽象 CatsInvocation Service 契约
> - 批次3.4 ✅ 实现 InvocationQueueService/InvocationTrackerService/SessionMutexService/TaskProgressService (Cordis Service 抽象+Memory实现)
> - 批次3.5 ⏳ 实现最小骨架 QueueProcessorService + reconcileZombies/StartupReconciler 纯函数
> - 批次3.6 ⏳ 编写 .spec.ts 测试 + 类型检查 + mgr sync PR

- [x] T4.3.1 创建 `@flowforge/cats-invocation` 包骨架（package.json/tsconfig.json/tsconfig.host.json/invariant.ts）
      — 对齐 dsh `@flowforge/jobs` 范式：抽象 `CatsInvocation extends Service` 挂载到 `ctx.catsInvocation`，
      构造时 `new.target === CatsInvocation` 守护防止直接加载抽象 seam；re-export cats-shared/cats-stores
      invocation 相关类型 + 状态机纯函数 + store ports 供消费者一站式导入
- [x] T4.3.2 移植 InvocationQueue → `InvocationQueueService extends Service` → `ctx.catsInvocationQueue`
      （per-thread×per-user FIFO，幂等去重，容量控制；`MemoryInvocationQueueService` 基于 Map 实现）
- [x] T4.3.3 移植 InvocationTracker → `InvocationTrackerService extends Service` → `ctx.catsInvocationTracker`
      （per-slot 互斥锁 + AbortController；F108/F118 D3/F-parallel-cancel 全量语义；`MemoryInvocationTrackerService` 完整移植 start/tryStart/guardDelete/cancel/cancelAll/cancelInvocation/resolveFinalStatus/complete/completeByExecutionId/startAll/tryStartThreadAll/bindExecutionId/trackExternalSlot/getActiveSlots 等 25 个方法）
- [ ] T4.3.4 移植 QueueProcessor → `QueueProcessorService extends Service` → `ctx.catsInvocationProcessor`
      （调度器 + 终态机 + zombie 恢复）
- [x] T4.3.5 移植 TaskProgressService → `TaskProgressService extends Service` → `ctx.catsInvocationProgress`
      （基于 batch 3.2 的 ITaskProgressStore，提供 snapshot 增删+owner-guarded 清理的 Cordis 包装；`MemoryTaskProgressService` 委托 store 实现）
- [x] T4.3.6 移植 SessionMutex / AgentSessionMutex → `SessionMutexService extends Service` → `ctx.catsInvocationMutex`
      （per-session 串行化锁；`MemorySessionMutexService` 基于 Map+waiter 队列实现；修复 `ForceReleaseResult` 类型对齐 clowder-ai 契约）
- [ ] T4.3.7 移植 reconcileZombies / convergeZombieQueue / StartupReconciler
      （作为 `InvocationQueueService` 的 `[Service.init]()` 钩子实现）
- [ ] T4.3.9 测试：入队→出队→执行→完成全链路（mock provider，`vitest .spec.ts`）

#### 批次3.4 实施详情

已完成 4 个 Cordis Service 抽象 + Memory 实现：

1. **InvocationQueueService** (`src/queue.ts`)：抽象基类 + `MemoryInvocationQueueService`
   - 挂载到 `ctx.catsInvocationQueue`，通过 `CatsInvocation.queue` 访问器聚合
   - 方法：`enqueue/dequeue/peek/size/remove/markProcessing/markProcessed`
   - 幂等去重（idempotencyKey）+ 用户消息容量控制（MAX_QUEUE_DEPTH）

2. **InvocationTrackerService** (`src/tracker.ts`)：抽象基类 + `MemoryInvocationTrackerService`
   - 挂载到 `ctx.catsInvocationTracker`，通过 `CatsInvocation.tracker` 访问器聚合
   - 全量移植 clowder-ai `InvocationTracker` 的 25 个方法
   - 保留 F108（per-slot 并发模型）、F118 D3（TTL auto-cleanup）、F-parallel-cancel（独立 batch gate + tombstone 语义）
   - 使用品牌类型（ThreadId/CatId/UserId），`exactOptionalPropertyTypes` 兼容

3. **SessionMutexService** (`src/mutex.ts`)：抽象基类 + `MemorySessionMutexService`
   - 挂载到 `ctx.catsInvocationMutex`，通过 `CatsInvocation.mutex` 访问器聚合
   - 方法：`acquire/forceReleaseByScope/isHeld`
   - 修复 `ForceReleaseResult` 类型与 clowder-ai 契约对齐（releasedHolders/rejectedWaiters/catIds）
   - `exactOptionalPropertyTypes` 兼容（Waiter/HeldLock owner 可选属性）

4. **TaskProgressService** (`src/progress.ts`)：抽象基类 + `MemoryTaskProgressService`
   - 挂载到 `ctx.catsInvocationProgress`，通过 `CatsInvocation.progress` 访问器聚合
   - 委托 `ITaskProgressStore`（来自 cats-stores batch 3.2）实现所有方法
   - 方法：`getSnapshot/setSnapshot/deleteSnapshot/deleteSnapshotIfOwner/getThreadSnapshots/deleteThread`

5. **CatsInvocation 聚合服务** (`src/index.ts`)：
   - 更新 4 个访问器（queue/tracker/mutex/progress），通过 `ctx.get()` 查找子服务
   - 未注册时抛出明确的配置错误信息
   - processor 访问器留待批次3.5

6. **类型一致性修复**：
   - `cats-shared/types/session-mutex.ts`：`ForceReleaseResult` 从 `{released, canceledWaiters}` 改为 `{releasedHolders, rejectedWaiters, catIds?}` 对齐 clowder-ai
   - `package.json`：新增 `./queue`、`./tracker`、`./mutex`、`./progress` 子路径导出

### 批次 4：`@flowforge/cats-profile`（档案插件）

> 设计：参考 dsh `@flowforge/agent-default-model` 范式，将 ProfileRepository 改造为
> `ProfileRepositoryService extends Service` → `ctx.catsProfile`，审批流程用 Cordis effect 管理。

- [ ] T4.4.1 创建 `@flowforge/cats-profile` 包骨架
- [ ] T4.4.2 移植 ProfileRepository → `ProfileRepositoryService extends Service` → `ctx.catsProfile`
      （档案解析/写入/迁移/审批，全部通过 `ctx.catStores` 注入存储）
- [ ] T4.4.3 移植 approveProfileUpdate 流程 → `ProfileApprovalService extends Service`
      （通过 `ctx.effect` 管理审批提案生命周期）
- [ ] T4.4.4 测试：档案迁移/审批单测（`vitest .spec.ts`，Cordis Context setup）

### 批次 5：`@flowforge/cats-orchestration`（编排/审计/蒸馏插件）

> 设计：参考 dsh `@flowforge/compaction` 范式，将 EventAuditLog / AutoSummarizer /
> DossierDistillationPipeline 改造为 Cordis Service。

- [ ] T4.5.1 创建 `@flowforge/cats-orchestration` 包骨架
- [ ] T4.5.2 移植 EventAuditLog → `EventAuditLogService extends Service` → `ctx.catsAudit`
      （同时扩展 `Context` + `Events`，对齐 dsh llm/fs 范式）
- [ ] T4.5.3 移植 AutoSummarizer / TaskExtractor → `AutoSummarizerService extends Service` → `ctx.catsSummarizer`
- [ ] T4.5.4 移植 Dossier 蒸馏管线 → `DossierDistillationService extends Service` → `ctx.catsDistiller`
      （经验 → dossier 草案 → 应用为档案更新）
- [ ] T4.5.5 移植 freshness / duty-briefing / usage-aggregator
      → `FreshnessService` / `DutyBriefingService` / `UsageAggregatorService`
- [ ] T4.5.6 测试：蒸馏管线单测（`vitest .spec.ts`）

## 验收标准

1. 可通过 YAML 档案注册/更新/停用灵智体（Forgekin），迁移与审批流程可用。
2. 调用队列支持并发限制、超时、失败重试、进度事件。
3. 会话转录可持久化（sqlite）并可回放。
4. 蒸馏：任务成功经验 → Dossier → 可应用为档案更新。
5. **所有 cats 服务均为 Cordis 插件**，可通过 `ctx.cats` / `ctx.catStores` / `ctx.catsInvocation` / `ctx.catsProfile` / `ctx.catsAudit` / `ctx.catsDistiller` 访问。
6. 测试统一 `vitest .spec.ts` + `new Context()` + `await ctx.plugin()` 模式，无 `node:assert` / `.js` import 路径残留。
7. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(cats): 移植灵智体系统(档案/编排/调用队列/蒸馏) 改造为Cordis插件 [sherlock]
```
