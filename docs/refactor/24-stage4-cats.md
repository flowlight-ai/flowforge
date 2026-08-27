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
- [x] T4.2.6 Sqlite 后端单独成包 `@flowforge/cats-stores-sqlite`（CAS 用事务替代 Redis Lua）
      — 批次6.5 已交付首版（node:sqlite 9 表 + 核心 5 store + 4 CAS store；其余 optional
      store 的 sqlite 实现随后续批次依赖落地补全）

### 批次 3：`@flowforge/cats-invocation`（调用队列/调度/tracker 插件）✅

> 设计：参考 dsh `@flowforge/jobs` 范式（`JobRegistry extends Service` + 子插件 backend），
> 将 InvocationQueue/Tracker/Processor 改造为 Cordis Service，全部挂载到 `ctx.catsInvocation`。
> 补全 clowder-ai `TaskManagedWorkRegistrationStore` port。
>
> **批次3 子任务分解**（实施进度：）：
> - 批次3.1 ✅ cats-shared 补全 invocation/queue-entry/session-mutex/zombie 类型 + invocation-state-machine 纯函数
> - 批次3.2 ✅ cats-stores 补全 IInvocationRecordStore/ITaskManagedWorkRegistrationStore/ITaskProgressStore ports + Memory 实现
> - 批次3.3 ✅ 创建 @flowforge/cats-invocation 包骨架 (package.json/tsconfig/invariant.ts)
> - 批次3.4 ✅ 实现 InvocationQueueService/InvocationTrackerService/SessionMutexService/TaskProgressService (Cordis Service 抽象+Memory实现)
> - 批次3.5 ✅ 实现最小骨架 QueueProcessorService + reconcileZombies/StartupReconciler 纯函数
> - 批次3.6 ✅ 编写 .spec.ts 测试 + 类型检查 + mgr sync PR（53 测试通过，PR #90 已合入）

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
> - 批次3.5 ✅ 实现最小骨架 QueueProcessorService + reconcileZombies/StartupReconciler 纯函数
> - 批次3.6 ✅ 编写 .spec.ts 测试 + 类型检查 + mgr sync PR（53 测试通过，PR #90 已合入）

- [x] T4.3.1 创建 `@flowforge/cats-invocation` 包骨架（package.json/tsconfig.json/tsconfig.host.json/invariant.ts）
      — 对齐 dsh `@flowforge/jobs` 范式：抽象 `CatsInvocation extends Service` 挂载到 `ctx.catsInvocation`，
      构造时 `new.target === CatsInvocation` 守护防止直接加载抽象 seam；re-export cats-shared/cats-stores
      invocation 相关类型 + 状态机纯函数 + store ports 供消费者一站式导入
- [x] T4.3.2 移植 InvocationQueue → `InvocationQueueService extends Service` → `ctx.catsInvocationQueue`
      （per-thread×per-user FIFO，幂等去重，容量控制；`MemoryInvocationQueueService` 基于 Map 实现）
- [x] T4.3.3 移植 InvocationTracker → `InvocationTrackerService extends Service` → `ctx.catsInvocationTracker`
      （per-slot 互斥锁 + AbortController；F108/F118 D3/F-parallel-cancel 全量语义；`MemoryInvocationTrackerService` 完整移植 start/tryStart/guardDelete/cancel/cancelAll/cancelInvocation/resolveFinalStatus/complete/completeByExecutionId/startAll/tryStartThreadAll/bindExecutionId/trackExternalSlot/getActiveSlots 等 25 个方法）
- [x] T4.3.4 移植 QueueProcessor → `QueueProcessorService extends Service` → `ctx.catsInvocationProcessor`
      （调度器 + 终态机 + zombie 恢复；最小骨架完成，processor.ts）
- [x] T4.3.5 移植 TaskProgressService → `TaskProgressService extends Service` → `ctx.catsInvocationProgress`
      （基于 batch 3.2 的 ITaskProgressStore，提供 snapshot 增删+owner-guarded 清理的 Cordis 包装；`MemoryTaskProgressService` 委托 store 实现）
- [x] T4.3.6 移植 SessionMutex / AgentSessionMutex → `SessionMutexService extends Service` → `ctx.catsInvocationMutex`
      （per-session 串行化锁；`MemorySessionMutexService` 基于 Map+waiter 队列实现；修复 `ForceReleaseResult` 类型对齐 clowder-ai 契约）
- [x] T4.3.7 移植 reconcileZombies / convergeZombieQueue / StartupReconciler
      （reconcile.ts + startup-reconciler.ts，依赖注入纯函数改造）
- [x] T4.3.9 测试：入队→出队→执行→完成全链路（mock provider，`vitest .spec.ts`）
      （invocation.spec.ts 覆盖 queue/tracker/mutex/progress/zombie reconcile/startup sweep，53 测试通过）

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

### 批次 4：`@flowforge/cats-profile`（档案插件）✅

> 设计：参考 dsh `@flowforge/agent-default-model` 范式，将 ProfileRepository 改造为
> `ProfileRepositoryService extends Service` → `ctx.catsProfile`，审批流程用 Cordis effect 管理。
>
> **批次4 子任务分解**（实施进度：）：
> - 批次4.1 ✅ 调研 clowder-ai ProfileRepository/approveProfileUpdate/writeProfilePrimer 源码 + dsh 参考范式
> - 批次4.2 ✅ cats-stores：IProfileUpdateProposalStore stub 提升为完整 port + Memory 实现；创建 cats-profile 包骨架
> - 批次4.3 ✅ 移植 ProfileRepository → ProfileRepositoryService (ctx.catsProfile) + P1-1/P1-2 纯写入函数
> - 批次4.4 ✅ 移植 approveProfileUpdate → ProfileApprovalService (ctx.catsProfileApproval，ctx.effect 管理审批生命周期)
> - 批次4.5 ✅ 档案/审批单测（Cordis Context 模式，16 测试）
> - 批次4.6 ✅ typecheck + cats 域 365 测试全绿 + mgr sync PR + 文档更新

- [x] T4.4.1 创建 `@flowforge/cats-profile` 包骨架（package.json/tsconfig.json/tsconfig.host.json/invariant.ts；
      子路径导出 `./write` `./repository` `./approval`；peerDeps：cats-shared/cats-stores/cordis）
- [x] T4.4.2 cats-stores：`IProfileUpdateProposalStore` 从 stub 提升为完整 port
      （创建/读取/listPending/claimForApproval CAS/recordCheckpoint/finalizeApproval/rollbackClaim/
      markRejected/客户端幂等去重 reserveDedup-releaseDedup/发布信封 setCardMessageId-commitEnvelope-abortStaged）；
      `MemoryProfileUpdateProposalStore` 实现 + `CatStores.profileUpdateProposals()` 聚合访问器 + Memory 后端注册
- [x] T4.4.3 移植 ProfileRepository → `ProfileRepositoryService extends Service` → `ctx.catsProfile`
      （scope 解析：relationshipKey 默认经 `ctx.cats` 注册表解析（可注入 resolver 覆盖），未配置时拒绝构建
      scope（杜绝 catId 回退）；profileDir/primerPath/readPrimer；scopeForPinnedPrimerTarget 阻断旧版
      catId 键控 target 在人格迁移后被审批）
- [x] T4.4.4 移植 writeProfilePrimer/writeProfileProvenance 纯函数（P1-1 崩溃恢复检查点语义 +
      P1-2 乐观锁 baseContentHash 比对 + 原子写 .tmp→rename；InvalidPrimerPathError/StaleProfileUpdateError）
- [x] T4.4.5 移植 approveProfileUpdate → `ProfileApprovalService extends Service` → `ctx.catsProfileApproval`
      （per-target 锁（绝对 primer 路径为 key）串行化 + pending→approving→approved CAS 状态机 +
      崩溃恢复（writtenPath/provenancePath 检查点幂等续作，approving 态重入即恢复）+ 拒绝单次性 +
      `ctx.effect` 管理锁表生命周期（fiber dispose 时拒绝排队 waiters）；primer 写失败回滚 pending，
      provenance 写失败保持 approving 等待恢复；writer 经构造参数注入，测试可替换）
- [x] T4.4.6 测试：profile.spec.ts 16 测试（纯写入函数 happy/stale/already-applied、repository
      scope/迁移守护/ctx.cats 注册表集成、审批 happy/幂等/stale 回滚/拒绝单次性/崩溃恢复/not_found/
      write_failed 回滚/并发 per-target 锁串行化）

#### 批次4 实施详情

1. **存储契约**（cats-stores `ports/profile-update-proposal-store.ts`）：审批单状态机
   （pending → approving → approved/rejected）的 store 层契约；claimForApproval/finalizeApproval 均为
   CAS 语义（并发审批竞态时输者拿到 null）；`CreateProfileUpdateProposalInput.baseContentHash` 在创建时
   锁定基准，审批写入前由 writeProfilePrimer 复核（P1-2）。
2. **纯写入函数**（cats-profile `src/write-profile-update.ts`）：`writeProfilePrimer` 复核当前文件 hash
   与提案基准一致后原子写入 afterContent；`allowAlreadyApplied` 分支支持崩溃后幂等重放；
   `writeProfileProvenance` 写确定性 before/after 记录（signal 来源/rationale 全量落盘）。
3. **审批管线锁语义**：锁 key 为解析后的绝对 primer 路径（与 session mutex 命名空间隔离）；锁内重读
   提案防止等锁期间状态漂移；全程 `finally` 释放（INV-9）。
4. **测试基建修复**：清理 `cats/shared/src` + `cats/stores/src` 内 592 个陈旧 tsc 构建镜像
   （.js/.d.ts/.js.map/.d.ts.map，均为 gitignore 未跟踪产物）——Vite 别名目录解析时 `.js` 优先于
   `.ts`，包名导入命中 8/18 陈旧构建导致新方法在运行时"消失"；清理后包名导入与相对导入类身份一致，
   cats 域 26 文件 365 测试全绿。
### 批次 5：`@flowforge/cats-orchestration`（编排/审计/蒸馏插件）✅

> 设计：参考 dsh `@flowforge/compaction` 范式，将 EventAuditLog / AutoSummarizer /
> DossierDistillationPipeline / Freshness / DutyBriefing / UsageAggregator 改造为 Cordis Service。
>
> **批次5 子任务分解**（实施进度：）：
> - 批次5.1 ✅ 调研 clowder-ai 六服务源码（EventAuditLog/AutoSummarizer+TaskExtractor/
>   DossierDistillation/Freshness/DutyBriefing/ToolUsage）+ port 契约 + flowforge 类型基础
> - 批次5.2 ✅ cats-shared 类型补齐（audit/tool-usage/freshness/dossier-distillation）+
>   4 个 stub port 提升为完整契约（ISummaryStore/IDossierDistillationProposalStore/
>   IDossierObservationStore/IDeliveryCursorStore）+ Memory 实现 + CatStores 聚合访问器
> - 批次5.3 ✅ 创建 @flowforge/cats-orchestration 包骨架 + index.ts 插件入口
> - 批次5.4 ✅ EventAuditLog/AutoSummarizer+TaskExtractor/Freshness/UsageAggregator → Cordis Service
> - 批次5.5 ✅ Dossier 蒸馏管线（含 dossier-applier 纯函数）+ DutyBriefing → Cordis Service
> - 批次5.6 ✅ 六域单测（Cordis Context 模式，33 测试全绿）
> - 批次5.7 ✅ typecheck + 全量测试 + mgr sync PR + 文档更新

- [x] T4.5.1 创建 `@flowforge/cats-orchestration` 包骨架（package.json/tsconfig.json/
      tsconfig.host.json/invariant.ts；子路径导出 `./audit` `./summarizer` `./task-extractor`
      `./freshness` `./tool-usage` `./distiller` `./dossier-applier` `./duty-briefing`；
      peerDeps：cats-shared/cats-stores/cordis）
- [x] T4.5.2 移植 EventAuditLog → `EventAuditLogService extends Service` → `ctx.catsAudit`
      （NDJSON 按日分片 append-only 事件日志：append/readByDate/readByTypeAndThread/
      listShards；randomUUID 主键 + 时间戳；auditDir 可配置，默认 data/audit）
- [x] T4.5.3 移植 AutoSummarizer / TaskExtractor → `AutoSummarizerService extends Service` → `ctx.catsSummarizer`
      （消息阈值 + 冷却期双闸门；inFlight 去重防并发重入；模式法摘要兜底；
      TaskExtractor：LLM JSON 提取 + 模式匹配降级（markdown checkbox/TODO 标签）、
      ownerCatId 注册表校验、signal 中断协作）
- [x] T4.5.4 移植 Dossier 蒸馏管线 → `DossierDistillationService extends Service` → `ctx.catsDistiller`
      （经验 → dossier 草案 → 应用为档案更新；addObservation/propose/applyProposal 三段式；
      dossier-applier 纯函数：prepareDraft 实现 KD-17 stale-write 锁（baseHash 复核）+
      分节锚定（cat:section 边界替换）+ NOT_APPROVED 状态守护 + evidenceRefs 非空 fail-closed）
- [x] T4.5.5 移植 freshness / duty-briefing / usage-aggregator
      → `FreshnessService` / `DutyBriefingService` / `UsageAggregatorService`
      （Freshness：未见消息门控 AC-A3/A4/A5（cursor 缺失 fail-open / 预览截断 / acknowledgeHeld 直通）；
      DutyBriefing：INV-5 每日一次投递（cursor 去重）+ 纯聚合器/渲染器（blocked 任务按 1d~7d/>7d
      分流 needsUser/staleBlocked，僵尸→deadBalls，≤15 行折叠卡片）+ degraded 绑定回退；
      UsageAggregator：classifyTool 三分类（native/mcp/skill，MCP server 归一化）+
      (date,catId,category,toolName) 计数聚合 + 有界 ToolEvent 环形序列）
- [x] T4.5.6 测试：orchestration.spec.ts 33 测试（audit 3/summarizer 2/task-extractor 5/
      freshness 6/tool-usage 3/distiller 7/duty-briefing 7），Cordis Context 模式全绿

#### 批次5 实施详情

1. **类型与契约先行**（批次5.2）：cats-shared 新增 `types/audit.ts`（AuditEvent/AuditEventInput/
   AUDIT_EVENT_TYPES）、`types/tool-usage.ts`（ToolEvent 判别联合 + SkillLoadedEvent +
   ToolUsageEntry/Report 聚合）、`types/freshness.ts`（FreshnessDecision/FreshnessCheckInput，
   held 预览截断常量）、`types/dossier-distillation.ts` 扩展（观察/提案/应用三态 + KD-17 错误码）。
2. **4 个 stub port 提升为完整契约**：ISummaryStore（线程摘要 create/listByThread）、
   IDossierObservationStore（add/listByCat newest-first）、IDossierDistillationProposalStore
   （create/get/approve/reject/markApplied CAS 状态机）、IDeliveryCursorStore（seen/held cursor
   get/set，duty-briefing INV-5 每日去重依赖）；stub-ports.ts 同步移除，Memory 后端全部实现
   并注册到 MemoryStoresBackend + CatStores 聚合访问器（summaries()/dossierObservations()/
   dossierDistillationProposals()/deliveryCursors()）。
3. **六服务全部 Cordis 化**：均 `extends Service` + `static inject`（audit/tool-usage 零依赖可
   独立挂载；summarizer/freshness/distiller/duty-briefing 注入 catStores），默认 Plugin 聚合挂载
   六服务；Context augmentation 声明 ctx.catsAudit/catsSummarizer/catsFreshness/catsToolUsage/
   catsDistiller/catsDutyBriefing。
4. **降级语义保留**：TaskExtractor 无 LLM invoker 或 JSON 解析失败时模式匹配降级并标记
   degraded+reason；Freshness cursor 缺失 fail-open（forward）；DutyBriefing 未绑定目标线程时
   unbound 静默、degraded 无回退时报 error 不静默（INV-2）。
5. **测试基建**：tsconfig.host.json / vitest.config.ts 加入 cats-orchestration 引用与别名。

### 批次 6：阶段4 收尾（C5 会话转录 + Sqlite 后端 + 测试统一）✅

> 目标：补齐阶段4 验收标准的剩余项——C5 TranscriptWriter/SessionSealer（会话转录落盘+回放）、
> T4.2.6 `@flowforge/cats-stores-sqlite`（持久化后端）、13 个陈旧 `.test.js` 统一迁移 `.spec.ts`。
>
> **批次6 子任务分解**（实施进度：）：
> - 批次6.1 ✅ 13 个 `.test.js` → `.spec.ts` 统一迁移（node:assert/.js 路径 → vitest expect/.ts；
>   迁移后修复 51 处类型错误：字面量联合/品牌类型/exactOptionalPropertyTypes）
> - 批次6.2 ✅ C5 调研：clowder-ai `cats/services/session/`（TranscriptWriter 684L/TranscriptReader 406L/
>   SessionSealer 506L + buildThreadMemory/extractDecisionSignals/TranscriptFormatter/
>   HandoffDigestGenerator/CollaborationContinuityCapsule/stripLeakedToolCallPayload 依赖链）
> - 批次6.2a ✅ ISessionChainStore stub → 完整 port + MemorySessionChainStore（F198 chainKey 写容忍/
>   F118 listSealingSessions/MAX_RECORDS 三级驱逐）+ CatStores.sessionChains() 访问器 + 16 测试
> - 批次6.3 ✅ 新建 @flowforge/cats-session 包：TranscriptWriterService（ctx.catsTranscriptWriter，
>       events.live.jsonl 崩溃恢复增量写+flush 落盘 events.jsonl/index.json/digest.extractive.json）
>       + TranscriptReaderService（ctx.catsTranscriptReader，分页/检索/调用级读取）+ capsule/sanitize
>       纯函数，26 测试
> - 批次6.4 ✅ SessionSealerService（ctx.catsSessionSealer，static inject catStores+catsAudit，
>       getEventAuditLog 单例→ctx.catsAudit）+ thread-memory/decision-signals/formatter/handoff/
>       artifact 纯函数群，56 测试
> - 批次6.5 ✅ T4.2.6 `@flowforge/cats-stores-sqlite`：node:sqlite DatabaseSync（对齐 dsh
>       session-persistence-sqlite 模式，非 better-sqlite3——零原生编译依赖），9 表 STRICT DDL+WAL，
>       核心 5 store + invocation/sessionChain/deliveryCursor/summary 的 SQL 实现，CAS 用
>       BEGIN IMMEDIATE 事务替代 Redis Lua，40 测试
> - 批次6.6 ✅ 测试 + typecheck + mgr sync PR + 文档更新

- [x] T4.6.1 13 个 `.test.js` → `.spec.ts`（meeting/meeting-context-block/frustration-issue/
      extract-feature-ids/event-memory-types/derive-triage-confidence/connector-definitions/
      config-field-codec/community-issue-draft/collection-signal-whitelist/client-routing/
      pet-skin-projection/concierge-config）— 完成（175 测试全绿 + 51 类型错误修复）
- [x] T4.6.2 C5 TranscriptWriter/SessionSealer/TranscriptReader 移植为 Cordis 插件（会话转录
      持久化+回放，目录结构 threads/<threadId>/<catId>/sessions/<sessionId>/）— 完成
      （@flowforge/cats-session 包，82 测试：writer 26 + sealer 56）
- [ ] T4.6.3 T4.2.6 Sqlite 后端（CAS 用事务替代 Redis Lua；`static Config` Schemastery schema）
      — 批次6.5 已交付首版（核心 5 store + 4 CAS store；其余 optional store 的 sqlite 实现
      随后续批次依赖落地补全）

#### 批次6 实施详情

1. **测试统一**（6.1）：13 个 `.test.js` 机械迁移 + 51 处类型错误修复（字面量联合 `as const`、
   品牌类型转换函数、exactOptionalPropertyTypes 条件展开），cats-shared 14 文件 175 测试全绿。
2. **会话链契约**（6.2a）：ISessionChainStore 从 stub 提升为完整 port，MemorySessionChainStore
   全量移植（三索引/cliSessionId 冲突语义/F198 chainKey 写容忍/F118 sealing 扫描/容量三级驱逐
   +真 active 拒绝驱逐回滚抛错）。
3. **会话转录包**（6.3+6.4）：@flowforge/cats-session 三服务——Writer（增量崩溃恢复写 +
   flush 合并去重重编号 + 稀疏索引 + 抽取式摘要含噪声分组/续接胶囊）、Reader（cursor 分页/
   双域检索/调用级读取/handoff frontmatter 解析）、Sealer（CAS 封存 + 30s 超时守护 + 终态兜底
   + F118 双回收器 + F231 post-seal hooks）；clowder-ai 的 getEventAuditLog() 模块单例改造为
   ctx.catsAudit Cordis 注入。7 个纯函数依赖模块全量移植。
4. **Sqlite 后端**（6.5）：node:sqlite DatabaseSync（Node 24 内建，对齐 dsh
   session-persistence-sqlite 范式）；9 表 STRICT + WAL + user_version 守护；CAS 经
   BEGIN IMMEDIATE 事务；与 Memory 版语义差异（无容量上限/UNIQUE 冲突显式化）已在文件头注明。

### 批次 7：C25 concierge + guides 全插件化（2026-08-26）✅

> 目标：全量移植 clowder-ai `domains/concierge`（F229）与 `domains/guides`（F155）到
> `@flowforge/cats-guides`（`ctx.catsGuides`），参考 dhs 既有模块全部改造为 Cordis 插件。
>
> **插件化改造决策**（对照 clowder 强依赖）：
> - RedisClient → `ConciergeKeyValueStore` 注入接口（get/set/setNx/deleteIf/addToSet/setMembers，
>   缺省 Memory 实现；Lua CAS → 注入端保证原子性 + Memory 同步 CAS）
> - catRegistry 单例 → `RosterResolver` 注入（缺省空 roster）
> - socket.emitToUser → `GuideEmitFn` 回调；guideTransitions.add → `TelemetryFn` 回调
> - 模块级 logger → `ConciergeWorkerLog` 可选注入（缺省 console 前缀）
> - 模块级 registry 全局单例 → `GuideRegistryLoader` 注入（缺省 name 回退 guideId）
> - IThreadStore 裁剪为最小接口（get/create/updatePreferredCats/updateThreadKind/softDelete/\
>   getParticipants），缺省 `InMemoryGuideThreadStore`
>
> **批次7 子任务分解**：
> - 批次7.1 ✅ concierge 服务群：ConciergeKeys + kv-store（CAS 语义）+ config-store（FIX-3 stale
>   校验）+ thread-service + relay-store（INV R1-R4）+ confirmation-store（INV C1-C4）+
>   triage-plan-store（INV T1-T3 + claimTransition CAS）+ investigation-job-store（INV I1-I3 +
>   claimDoneWithReport 原子 done+report）+ search-context（KD-23 per-invocation handle 表）+
>   reply-validator（BUG-UX-9/12 + integrity unit fail-closed）+ target-cats-resolver +
>   verified-tool-target + investigation-worker（deadline 双检查）+ prompt-section + routing-interceptor
> - 批次7.2 ✅ guides 插件入口：`index.ts` GuidesService（config/registry/sessionStore/dismissTracker/
>   threadStore/kv 全可选注入）+ routing-interceptor（prepare/guideContextForCat/ack 三阶段 +
>   bootcamp→guide bridge F171）+ prompt-section + thread-store + lifecycle-service/action-service
>   （emit/telemetry/dismissTracker 回调注入）
> - 批次7.3 ✅ 测试 + typecheck：5 个 `.spec.ts` 85 测试（state-machine 14 + concierge-stores 22 +
>   reply-validator 21 + search-context 12 + routing-interceptor 16）+ `tsc -b tsconfig.host.json`
>   全量通过（补 tsconfig.host.json 注册）
>
> 验收：85/85 测试全绿；全量 typecheck 零错误；`ctx.catsGuides` 挂载点就绪；docs 三件套更新。

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

