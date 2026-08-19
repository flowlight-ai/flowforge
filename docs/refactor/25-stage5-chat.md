# 阶段 5：群聊系统 chat（对齐 Clowder AI，改造为 Cordis 插件）

> 目标：移植 clowder-ai 群聊全链路：线程/消息/@mention 路由/会话链/交接/审批/实时投递。
>
> **核心约束（R13 插件化）**：clowder-ai 的群聊域是"Fastify 路由 + 裸 store 注入"模式；
> flowforge 一切皆插件——路由业务逻辑提取为**服务层 Cordis Service**（挂载 `ctx.chat*`），
> HTTP/WS 面由 typert RPC 域承载（对齐阶段 3 apiproxy 模式），存储复用 `ctx.catStores`
> 阶段 4 契约（threads/messages/tasks 等 port + Memory/Sqlite 后端）。

## 架构改造映射

| clowder-ai 模式 | flowforge 改造 |
|---|---|
| `app.register(threadRoutes, {threadStore, ...})` | `@flowforge/chat-threads` 插件，`ctx.chatThreads` |
| `messages.ts` Fastify 路由内联业务 | `@flowforge/chat-messages` 插件，`ctx.chatMessages` |
| `SocketManager` 模块单例 + socket.io | `@flowforge/chat-realtime` 插件，`ctx.chatRealtime` |
| `callback-multi-mention-routes.ts` 回调分发 | `@flowforge/chat-mention` 插件，`ctx.chatMention` |
| `proposal-routes/votes/approval-hub` 路由族 | `@flowforge/chat-approval` 插件，`ctx.chatApproval` |
| `session-chain/session-handoff` 路由族 | `@flowforge/chat-session-chain` 插件，`ctx.chatSessionChain` |
| `createXxxStore(redis?)` 工厂（chat 侧） | 复用 `@flowforge/cats-stores` port 体系（stub → 随批次提升） |
| socket.io 事件 `thread:message` 等 | `ChatRealtimeService` 事件词汇（对齐 clowder-ai 事件名） |

## 批次与任务清单

> 批次顺序按依赖拓扑：threads → messages → realtime → approval → mention →
> session-chain → misc。每批次 = 实现 + vitest + `./mgr` PR。

### 批次 1：`@flowforge/chat-threads`（线程域服务，T5.1+T5.5）

- [x] T5.1.1 包骨架（package.json/tsconfig/invariant.ts，对齐 cats-* 包范式）
- [x] T5.1.2 `IReadStateStore` stub → `IThreadReadStateStore` 完整 port（F069：
      ack 单调游标 Redis ACK_CAS_LUA 语义/getUnreadSummaries 提及检测/reconcileReadCursor
      v1→v2 CAS）+ Memory 实现（read-state-store.ts，lex 序 v2>raw-v1）
- [x] T5.1.3 `ThreadService extends Service` → `ctx.chatThreads`：create（F32-b preferredCats/
      F095 pinned+backlogItemId 关联校验）/get（系统线程共享）/list（sidebar 投影/q 搜索/
      回收站 deleted 视图）/patch（F187 labels 经 metadata）/softDelete（#35 活跃调用保护 +
      F192 系统线程保护 + I-2 审计回调）/restore/purge 硬删级联
- [x] T5.1.4 `ReadStateService` → `ctx.chatReadState`：ack（单调 CAS）/ackLatest/
      markAllRead/getUnreadSummaries（提及标记）/get
- [x] T5.1.5 `ThreadBranchService`（ADR-008 D4 编辑即分支：切点复制+editedContent 替换+
      "(分支)" 后缀+失败回滚）+ `ThreadExportService`（markdown 导出+逐消息 sender 投影）
- [x] T5.1.6 测试 5 spec 54 用例（thread/read-state/branch/export/projection）+ typecheck
      退出码 0 + mgr PR

### 批次 2：`@flowforge/chat-messages`（消息域服务，T5.2）

- [ ] T5.2.1 `MessageService extends Service` → `ctx.chatMessages`：publish（幂等
      idempotencyKey/deliveryStatus）/edit/softDelete/history（cursor after）/getByThread
- [ ] T5.2.2 `MessageActionService`（message-actions 语义：message_id 行动受理）
- [ ] T5.2.3 消息 disposition 准入（message-disposition-admission/config 纯函数）
- [ ] T5.2.4 测试 + typecheck + mgr PR

### 批次 3：`@flowforge/chat-realtime`（实时事件面，T5.11）

- [ ] T5.11.1 `ChatRealtimeService extends Service` → `ctx.chatRealtime`：SocketManager
      全量语义（room join/leave、broadcast、cancel messages）改造 Cordis
- [ ] T5.11.2 `ThreadSequencer`（thread 序号分配）+ `BroadcastRateMonitor`（广播限速）
- [ ] T5.11.3 事件词汇：thread:message / invocation:progress / signal:new / approval:update
- [ ] T5.11.4 测试（双客户端收发 mock io）+ mgr PR

### 批次 4：`@flowforge/chat-approval`（审批/提案/投票，T5.6）

- [ ] T5.6.1 `IProposalStore` stub → 完整 port + Memory（proposal 状态机）
- [ ] T5.6.2 `ProposalService` → `ctx.chatApproval`：create/list/vote/decide/close/stale-recovery
- [ ] T5.6.3 votes（投票统计）+ approval-hub（聚合卡片）+ proposal-card/enrich-header 纯函数
- [ ] T5.6.4 测试 + mgr PR

### 批次 5：`@flowforge/chat-mention`（@mention 路由，T5.3）

- [ ] T5.3.1 `MentionParser` 纯函数（user-mention/catId 提取）
- [ ] T5.3.2 `MultiMentionOrchestratorService` → `ctx.chatMention`：多 @ 并发编排
      （callback-multi-mention 语义，对接 catsInvocationQueue）
- [ ] T5.3.3 callback-auth 签名校验纯函数（prehandler/system-message）
- [ ] T5.3.4 测试 + mgr PR

### 批次 6：`@flowforge/chat-session-chain`（会话链/交接，T5.4）

- [ ] T5.4.1 `SessionChainService`（session-chain 路由语义，复用 cats-session Sealer）
- [ ] T5.4.2 `SessionHandoffService`：handoff 提案/审批/执行（依赖批次4 approval +
      ISessionHandoffProposalStore 提升）
- [ ] T5.4.3 session-hooks / session-strategy-config
- [ ] T5.4.4 测试 + mgr PR

### 批次 7：`@flowforge/chat-misc`（信号/记忆/任务/市场桥接，T5.7+T5.8）

- [ ] T5.7.1 `TaskService`（tasks 路由语义，桥接 catStores.tasks()）+ backlog
- [ ] T5.7.2 `MemoryPublishService`（memory-publish/memory 路由，桥接 catStores.memory()）
- [ ] T5.7.3 `SignalService`（signals/signal-study/signal-collection 查询服务）
- [ ] T5.8.1 `MarketplaceService`（marketplace 搜索/安装计划，2KB 小路由）
- [ ] T5.7.4 测试 + mgr PR

### 批次 8：阶段 5 收尾（T5.9/T5.10 stretch 界定 + e2e + 文档）

- [ ] T5.9/T5.10 stretch ports 界定（world/IM 仅留接口 + mock）
- [ ] T5.12 e2e：双客户端实时收发；@ 多灵智体并发响应线程隔离；交接链上下文连续；
      审批流状态机
- [ ] stage-map 矩阵同步 + 25 文档收尾 + mgr PR

## 任务清单（原始索引→批次映射）

- [x] T5.1 `packages/chat/threads`：线程 CRUD/详情/标题/删除/成员 + 线程读取状态 → 批次1
- [ ] T5.2 `packages/chat/messages`：消息发布/编辑/删除/行动（message-action）+ 媒体附件 → 批次2
- [ ] T5.3 `packages/chat/mention`：@mention 路由 + 多 @ 并发编排 → 批次5
- [ ] T5.4 `packages/chat/session-chain`：会话链管理 + 交接 handoff → 批次6
- [x] T5.5 `packages/chat/thread-branch`：线程分支 → 批次1（并入 `@flowforge/chat-threads`
      ThreadBranchService）
- [ ] T5.6 `packages/chat/approval`：审批 Hub / 提案 / 投票 / 治理 → 批次4
- [ ] T5.7 `packages/chat/signals|memory|tasks` → 批次7
- [ ] T5.8 `packages/chat/marketplace` → 批次7
- [ ] T5.9 ~~world/community/story/排行榜~~ → **stretch**（`10-stage-map.md` §3.4 S3，仅留 ports）
- [ ] T5.10 ~~IM 通道适配~~ → **stretch**（§3.4 S1：WebChat 内置可选，飞书/Telegram/钉钉/企微按凭据启用；
      仅留 ports 接口 + mock）
- [ ] T5.11 socket.io 事件面 → 批次3
- [ ] T5.12 测试：双客户端实时收发；@ 多个灵智体并发响应且线程隔离；交接链正确；
      审批流状态机单测 → 批次8

## 验收标准

1. 线程内多人（含多个灵智体）消息实时收发，@mention 精确路由。
2. 会话交接后上下文连续（新线程可引用旧线程摘要）。
3. 审批/提案/投票状态机正确流转。
4. 路由统一挂 `/api/v2/*`（R18），与 Python 旧版 `/api/v1/*` 物理隔离。
5. **所有 chat 服务均为 Cordis 插件**（`ctx.chatThreads`/`ctx.chatMessages`/`ctx.chatRealtime`/
   `ctx.chatApproval`/`ctx.chatMention`/`ctx.chatSessionChain`）。
6. Python 旧版 `pytest` 回归全绿。

## 提交信息模板

```
feat(chat): 群聊系统(线程/@mention/会话链/实时投递) 改造为Cordis插件 [sherlock]
```
