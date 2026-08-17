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
| `catRegistry` 模块级单例 | `CatRegistry extends Service` → `ctx.cats` |
| `new InvocationQueue()` 手写组合根 | `@flowforge/cats-invocation` 插件，`ctx.catsInvocation` |
| `createXxxStore(redis?)` 工厂 | `@flowforge/cats-stores` 插件，`ctx.catStores` |
| Fastify `app.register(route, {deps})` | typert RPC 域（阶段5 chat 域处理 HTTP/WS） |
| Redis Lua CAS 脚本 | sqlite 事务 CAS（`better-sqlite3`） |
| `process.once('SIGTERM', shutdown)` | Cordis fiber dispose 自动清理 |
| `@cat-cafe/shared` workspace 包 | `@flowforge/cats-shared` workspace 包 |

## 批次与任务清单

### 批次 1：`@flowforge/cats-shared`（类型/schema/纯函数 + CatRegistry Service）

- [ ] T4.1.1 移植 types/（CatId/CatConfig/Profile/Message/Thread/Task 等全部类型定义）
- [ ] T4.1.2 移植 schemas/（zod schema：cat-id/message/command/signals/world/pack）
- [ ] T4.1.3 移植 utils/（text-utils/command-parser/eval-metric-ref 等纯函数，**排除 redis.ts**）
- [ ] T4.1.4 移植 registry/（CatRegistry → 改造为 `CatRegistry extends Service`，`ctx.cats`）
- [ ] T4.1.5 移植 dossier/（dossier profile 解析/加载纯函数）
- [ ] T4.1.6 移植 concierge/（pet-skin-projection 纯函数）
- [ ] T4.1.7 移植 profile-frontmatter-parser / profile-contract / scanner-discovery-pure
- [ ] T4.1.8 移植 approval-producer-catalog / capability-tips / cli-effort / core-commands 等顶层纯函数
- [ ] T4.1.9 测试：catId 规范化 / frontmatter 解析 / command-parser / dossier profile

### 批次 2：`@flowforge/cats-stores`（存储 ports + Memory/Sqlite 双后端插件）

- [ ] T4.2.1 移植 ports/（IThreadStore/IMessageStore/ITaskStore/IBacklogStore/IMemoryStore/
      ISessionChainStore/IDraftStore/ISummaryStore/ITurnExecutionStore/IInvocationRecordStore 等 28 个接口）
- [ ] T4.2.2 移植 ports/ 内嵌的 in-memory 参考实现（LRU + 容量上限）
- [ ] T4.2.3 创建 `CatStores extends Service` → `ctx.catStores`，聚合所有 store 实例
- [ ] T4.2.4 sqlite 后端实现（better-sqlite3，CAS 用事务，替代 Redis Lua）
- [ ] T4.2.5 测试：port 契约单测（memory 后端）+ sqlite 后端集成测试

### 批次 3：`@flowforge/cats-invocation`（调用队列/调度/tracker 插件）

- [ ] T4.3.1 移植 InvocationQueue（per-thread×per-user FIFO，`ctx.catsInvocation.queue`）
- [ ] T4.3.2 移植 InvocationTracker（per-slot 互斥锁 + AbortController，`ctx.catsInvocation.tracker`）
- [ ] T4.3.3 移植 QueueProcessor（调度器 + 终态机 + zombie 恢复）
- [ ] T4.3.4 移植 TaskProgressStore（IAuthInvocationBackend 端口 + Memory 实现）
- [ ] T4.3.5 移植 SessionMutex / AgentSessionMutex（per-session 串行化锁）
- [ ] T4.3.6 移植 reconcileZombies / convergeZombieQueue / StartupReconciler
- [ ] T4.3.7 测试：入队→出队→执行→完成全链路（mock provider）

### 批次 4：`@flowforge/cats-profile`（档案插件）

- [ ] T4.4.1 移植 ProfileRepository（档案解析/写入/迁移/审批）
- [ ] T4.4.2 移植 approveProfileUpdate 流程
- [ ] T4.4.3 测试：档案迁移/审批单测

### 批次 5：`@flowforge/cats-orchestration`（编排/审计/蒸馏插件）

- [ ] T4.5.1 移植 EventAuditLog / AutoSummarizer / TaskExtractor
- [ ] T4.5.2 移植 Dossier 蒸馏管线（经验→dossier 草案应用）
- [ ] T4.5.3 移植 freshness / duty-briefing / usage-aggregator
- [ ] T4.5.4 测试：蒸馏管线单测

## 验收标准

1. 可通过 YAML 档案注册/更新/停用灵智体（Forgekin），迁移与审批流程可用。
2. 调用队列支持并发限制、超时、失败重试、进度事件。
3. 会话转录可持久化（sqlite）并可回放。
4. 蒸馏：任务成功经验 → Dossier → 可应用为档案更新。
5. **所有 cats 服务均为 Cordis 插件**，可通过 `ctx.cats` / `ctx.catStores` / `ctx.catsInvocation` 访问。
6. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(cats): 移植灵智体系统(档案/编排/调用队列/蒸馏) 改造为Cordis插件 [sherlock]
```
