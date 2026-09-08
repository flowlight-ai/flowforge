# EP1-7 REST 控制器族移植设计（A1-A3）

- 来源：clowder-ai `packages/api/src/routes/`（session/settings/workspace 控制器族）+ 相关 domains 支撑逻辑（workspace-security / workspace-edit / workspace-file-read / thread-access-policy / runtime-session 等）、dsh `api/*-controller`（A1-A3，settings 无 clowder 实现，做自建 CRUD 契型）
- 落点：`packages/api/rest-controllers`（新包 `@flowforge/api-rest-controllers`）
- 依据：`docs/refactor/review_code.md` §13（EP1-7 任务登记：`api/session-controller` + `settings-controller` + `workspace-controller`）、§16 融合决策、`docs/refactor/10-stage-map.md` D45 矩阵行
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9
- 编译：包级 `tsc -b tsconfig.host.json` exit 0 + `oxlint` 0 告警；ESM；文件 ≤1000 行
- 边界：本批次仅留盘，由主会话统一提交（不做 git add/commit/push/mgr）
- 运行时依赖：仅 `zod`（peer/devDependency，workspace ^4.4.3）
- 承诺：**零引用 `fastify`/`express`/`koa`、`@cat-cafe/*`、`@deepseek-ai/*`、clowder 内部路径**；HTTP 框架 / 鉴权 / 存储宿主 / 文件系统 / git 全部以包内注入式端口呈现，本包只做纯逻辑、参数校验与命令构造

## 1. 范围界定

本批次移植 clowder api 的 **REST 控制器族**（阶段 8 web 服务端 API 面前置），四个子族：

1. **session 控制器族**：`session-chain.ts`（列表/单条/手动封存/解封恢复/手动 bind）、`session-transcript.ts`（分页读事件/摘要/invocations/search + 类型封套）、`session-strategy-config.ts`（F33 会话策略配置 CRUD/override 解析）、`session-hooks.ts`（CLI 钩子 seal/latest-digest/sop-bookmark + compaction surface）、`session-handoff-approve-routes.ts` + `session-handoff-reject-response.ts` + `callback-propose-session-handoff-routes.ts`（F225 交接审批流）、`callback-runtime-session-routes.ts` + `external-runtime-sessions.ts` + `native-session-control-routes.ts` + `native-session-target.ts`（运行时 excuse / native 目标解析）。
2. **settings 控制器族**：clowder api 无独立 settings 控制器，本包按会话/工作区 REST API 的 settings 语义自建**只读/写入/校验** CRUD 契型（`SettingsStore` 注入口 + `SettingsController`），宿主 EP2 接线真实设置/凭据模型。
3. **workspace 控制器族**：`workspace.ts`（树/文件/raw/search/diff/linked-roots/reveal/reveal-project/navigate/resolve-document-link）、`workspace-edit.ts`（edit-session 令牌 + file/create/dir/create/file/delete/rename/upload）、`workspace-git.ts`（git-log/status/show/health + 解析器）、`workspace-navigate-handler.ts`、`workspace-diff.ts`、`project-workspace-recommendation.ts`。
4. **支撑纯逻辑**：`thread-access-policy`（线程/会话资源授权）、`edit-token`（HMAC 编辑会话令牌）、`workspace-security`（路径解析/denylist/traversal/symlink 守卫、worktree/linked-roots 登记）、git 输出解析器、compaction surface。

**本批次不交付（EP2/EP4 下游承接）**：
- 真实 HTTP 框架装配（fastify/socket.io 绑定、multipart 流、静态/原始字节流）— 以 `HttpHandlerPort` + 路由表呈现，EP2 绑定；
- 真实鉴权/中间件（session cookie、callback auth、agent-key auth）— 只留 `RequestContextResolver` seam（消费 userId/principal）；
- store 宿主接线（cats-stores SQLite/Redis、runtime-session store、handoff proposal store）— 用内存端口实现满足契约测试；
- 真实文件系统 / git CLI / 系统文件管理器调用 — 用注入式 `WorkspaceFsSeam` / `GitSeam` / `ShellSeam`（内存实现）满足契约测试；
- multipart/上传流式解析、`resolvePrincipalThread`、`SkillConsumptionReceiptService` 真实实现 — seam 化。

## 2. 依赖映射（消除 fastify / @cat-cafe/* / clowder 内部路径）

| 源位置（clowder） | 本包呈现 | 说明 |
|---|---|---|
| `fastify`（FastifyInstance/Reply/Request） | `ports/http.ts` 抽象 `HttpRequest`/`HttpResponse`/`RouteHandler`/`RoutePattern` + `Router`（纯路由表匹配，无框架） | HTTP 处理器接缝 |
| `@cat-cafe/shared`（CatId/SessionRecord/SessionStrategyConfig/SessionHandoffProposal/ApprovalEnvelope/CallbackPrincipal） | `contract/session.ts` 契型 + zod schema，自建 | 契型文件（参考 signal-intake 契约拆分） |
| `utils/request-identity.ts`（resolveUserId/resolveStrictUserId/resolveSessionUserId/resolveDirectLocalAuthorizationUserId） | `ports/request-context.ts` `RequestContextResolver` seam（`resolveUserId`/`resolvePrincipal`/`resolveInteractiveUserId`）+ `Identity` 纯函数 | auth/用户上下文 seam |
| `domains/cats/services/stores/ports/*`（SessionChainStore/ThreadStore/MessageStore/SessionHandoffProposalStore/RuntimeSessionStore/InvocationRecordStore/TurnExecutionStore/DeliveryCursorStore） | `ports/stores.ts` 各接口 + `MemorySessionChainStore`/`MemoryThreadStore`/`MemoryMessageStore`/`MemoryHandoffProposalStore`/`MemoryRuntimeSessionStore`/`MemorySettingsStore` 等 | session/settings store 端口 + 内存实现 |
| `domains/cats/services/session/thread-access-policy.ts` + `domains/guides/guide-state-access.ts` | `pure/thread-access.ts` 谓词（resolveThreadAccess/canReadThreadRecord/filterThreadRecords/canAccessThread/isSharedDefaultThread） | 纯逻辑，无引宿主 store |
| `domains/cats/services/session/SessionSealer` | `ports/stores.ts` `SessionSealer` 端口（requestSeal/finalize） | store 端口 |
| `domains/workspace/workspace-security.ts` | `ports/workspace-security.ts` `WorkspaceSecurityGuard`（路径解析/denylist/traversal/symlink 守卫）+ `WorktreeRegistry`/`LinkedRootsStore` 注入口 | workspace/git/文件操作端口 |
| `domains/workspace/workspace-edit.ts` | `pure/edit-token.ts`（signVerifyEditToken/writeWorkspaceFile，HMAC + 时间 + fs 注入） | 纯逻辑 |
| `node:fs`/`node:child_process.execFile`/`find` | `ports/workspace-fs.ts` `WorkspaceFsSeam`（listTree/readFile/stat/writeFile/mkdir/rm/rename/sha256）+ `MemoryWorkspaceFs` | 文件系统 seam（参考 ep1-5 fs 类端口思路） |
| git 命令 | `ports/git.ts` `GitSeam`（log/status/show/health/drift）+ `MemoryGitSeam` + `pure/git-parsers.ts` | git seam + 命令构造/守卫 |
| `EventAuditLog` | `ports/audit.ts` `AuditLogSeam`（append，best-effort） | 审计 seam |
| `SocketManager` | `ports/socket.ts` `SocketManagerSeam`（broadcastToRoom） | socket seam |
| 系统文件管理器 `open/explorer/xdg-open` | `ports/workspace-fs.ts` `RevealSeam`（revealFile/revealDir，注入平台映射） | 平台命令 seam |
| `SkillConsumptionReceiptService` | `ports/skill-receipt.ts` seam | 技能消费凭据 seam |
| clowder 无 settings 控制器 | `controllers/settings.ts` + `SettingsStore` | 自建 CRUD 契型 |

**文案/提示字符串外部化**：所有 UI 文案/错误消息集中到 `contract/messages.ts`（如 seal/restore/access-denied/strategy 提示、workspace 各校验错误消息），控制器只引用常量。

## 3. 对接缝设计（先例：EP1-2 connectors 剔除 fastify）

### 3.1 HTTP 处理器接缝（`ports/http.ts`）

```ts
export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse { status: number; headers?: Record<string, string>; body: unknown }

export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

export interface Method { get/post/put/patch/delete(pattern: RoutePattern, handler: RouteHandler): void }

export class RestControllerBase {
  protected readonly router = new RouteRegistrar();
  get/post/put/patch/delete(pattern, handler);
  routes(): RouteEntry[];                     // 供 EP2 宿主绑定到真实框架
  handle(req: HttpRequest): Promise<HttpResponse>;  // 供契约测试直接调用
}
```

策略：**每个控制器类暴露 `routes()`（方法×路径×handler 的表）+ `handle(req)`**。契约测试直接构造 `HttpRequest` 调用 `handle()`，断言 `HttpResponse` 的 status/headers/body；EP2 宿主遍历 `routes()` 绑定到 fastify/socket 等真实框架（把 `HttpResponse` 映射为 reply.status/header/send）。多字节流/原始字节走 `headers` 标注 + `body` 作为流描述，EP2 装配真实流。

### 3.2 store/存储端口（`ports/stores.ts`）

参考 EP1-6 ports 的写法：接口 + 内存实现（真实内存 store，非 mock），满足契约测试：
- `ISessionChainStore`：`get`/`getActive`/`getChain`/`getChainByThread`/`bindCliSessionId`/`getByCliSessionId`/`getOrCreateActive`/`restoreActiveSession`/`update`；
- `IThreadStore`：`get`/`list`/`create`/`updateProjectPath`；
- `IMessageStore`：`getById`/`append`；
- `ISessionHandoffProposalStore`：propose/approve/reject 状态迁移；
- `IRuntimeSessionStore`：`getBySessionId`/`listExternal`/`getCursor`；
- `IInvocationRecordStore`/`ITurnExecutionStore`、`IDeliveryCursorStore`；
- `ISettingsStore`：`read`/`write`/`validate`（自建）；
- `SessionSealer`：`requestSeal`/`finalize`。

### 3.3 auth/用户上下文（`ports/request-context.ts`）

```ts
export interface RequestContextResolver {
  resolveUserId(req: HttpRequest, opts: { defaultUserId?: string }): string | null;
  resolveStrictUserId(req: HttpRequest): string;
  resolvePrincipal(req: HttpRequest): CallbackPrincipal | { kind: 'interactive'; userId: string } | null;
  resolveInteractiveUserId(req: HttpRequest): string | null;
}
```

本包只消费 userId/actor，不做真实鉴权。

### 3.4 workspace/git/文件操作端口（`ports/workspace-fs.ts` / `ports/git.ts` / `ports/workspace-security.ts`）

参照 ep1-5 的 file-system 类端口思路，全部抽象为注入式 seam，带内存实现：
- `WorkspaceFsSeam`：目录树枚举（含 `find` 排除规则）/文本读预览/stat/写/增删改/重命名/上传→内存文件树实现；
- `GitSeam`：`exec(args, cwd)` 抽象 → `MemoryGitSeam`（按工作树目录返回预设 stdout）；
- `WorkspaceSecurityGuard` + `WorktreeRegistry`/`LinkedRootsStore`（内存实现，ConfigStore seam 化）；
- `RevealSeam`：`revealFile`/`revealDir`（注入平台命令，测试断言构造的命令）。

本包内做纯逻辑（路径解析、denylist、traversal/symlink 守卫、令牌、命令构造、diff/日志/状态解析）与参数校验。

## 4. 包结构与文件清单

```
packages/api/rest-controllers/
  package.json  tsconfig.json  tsconfig.host.json
  src/
    index.ts
    contract/
      index.ts  session.ts  workspace.ts  settings.ts  messages.ts
    ports/
      index.ts
      http.ts  request-context.ts  stores.ts  audit.ts  socket.ts
      workspace-fs.ts  git.ts  workspace-security.ts  skill-receipt.ts
    pure/
      thread-access.ts  edit-token.ts  git-parsers.ts  transcript-format.ts
      session-strategy.ts  workspace-tree.ts
    controllers/
      session-chain.ts  session-transcript.ts  session-strategy-config.ts
      session-hooks.ts  session-handoff.ts  session-runtime.ts
      workspace.ts  workspace-edit.ts  workspace-git.ts  workspace-navigate.ts
      settings.ts
  tests/
    session-chain.spec.ts  session-transcript.spec.ts  session-handoff.spec.ts
    session-strategy-config.spec.ts  session-runtime.spec.ts
    workspace.spec.ts  workspace-edit.spec.ts  workspace-git.spec.ts
    settings.spec.ts  git-parsers.spec.ts
```

单文件 ≤1000 行；`workspace.ts`/`session-chain.ts` 已拆分子控制器文件；每族文件均在行数内。

## 5. 契型/契约（参考 `plugin-contract` 与 `signal-intake/src/contract` 拆分）

- `contract/session.ts`：`SessionRecord`/`CatId`/`SessionStrategyConfig`/`SessionHandoffProposal`/`ApprovalEnvelope`/`CallbackPrincipal`/`RuntimeSessionMetadata` 契型 + zod schema（`bindSessionSchema`/`restoreSessionSchema`/`sealSchema`/`sopBookmarkSchema`/`proposeHandoffSchema` 逐字语义移植）；
- `contract/workspace.ts`：`WorkspaceSearchResult`/`TreeNode`/`WorkspaceChangedFile`/`GitCommit`/`GitStatusResult`/`StaleBranch`/`WorktreeHealthEntry`/`RuntimeDrift`/`WorktreeEntry`/`EditToken`/`BindBody` 契型；
- `contract/settings.ts`：`SettingsRecord`/`SettingsSchema`/读写契型；
- `contract/messages.ts`：全部 UI 文案/错误消息外部化常量。

## 6. 测试策略（vitest 契约测试，注入式内存端口，不用 mock 覆盖关键分支）

| 测试文件 | 覆盖分支 |
|---|---|
| `session-chain.spec.ts` | 列表（catId 过滤/跨 cat 拒绝/403）、单条、手动封存（404/403/409 非 active/liveness/active-invocation/seal race/finalize partial）、unseal 恢复（confirmation 必需/active_changed/busy/restored/already_active/目标非 sealed）、bind（非法 cat/body/线程不存在/已占用/创建路径/historyImport） |
| `session-transcript.spec.ts` | 分页（游标/limit/end 收敛）、view 封套（raw/chat/handoff 校验）、strictParseTranscriptInteger、search schema 校验、类型封套 body 结构 |
| `session-handoff.spec.ts` | propose（五件套校验/pending 创建/幂等 clientRequestId）、approve（claim→commit-point 状态迁移/才 stale 恢复/idempotent）、reject（legacy/conflict/not_available 语义） |
| `session-strategy-config.spec.ts` | 解析（variant 合并/override 写入删除/回退 lower source）、execution-status 计算 |
| `session-runtime.spec.ts` | native compaction target 解析（候选过滤/单目标歧义/找不到）、external runtime 注册/列表 target 解析 |
| `workspace.spec.ts` | 增删改查（tree/file/raw/search/diff/linked-roots/reveal/reveal-project）+ 编辑/检测 + navigate 守卫 |
| `workspace-edit.spec.ts` | edit-session 令牌（签发/过期/不匹配）、file write（sha256 冲突 409/安全写）、create/dir/delete/rename/upload 校验 |
| `workspace-git.spec.ts` | 命令构造（log/status/show/health 参数）与守卫（worktreeId 必需/hash 校验）+ 解析器 |
| `settings.spec.ts` | 读写校验（非法值拒绝/默认合并/范围守卫） |
| `git-parsers.spec.ts` | git log/status/show/stale/worktree-health/drift/changed-files 解析 |

## 7. 质量门槛

- `npx vitest run packages/api/rest-controllers` 全绿；
- 包级 `npx tsc -b packages/api/rest-controllers/tsconfig.host.json` exit 0；
- `npx oxlint packages/api/rest-controllers` 0 warnings/errors；
- 根级注册 `tsconfig.host.json`（references）、`tsconfig.base.json`（paths）、`tsconfig.json`（references）。

## 8. 边界与后续（EP2/EP4）

- 真实 HTTP 框架绑定、鉴权/中间件、store 宿主接线、真实文件系统/git/文件管理器、multipart 流、socket 真实广播 → **归 EP2**；
- 真实 `SkillConsumptionReceiptService`、`resolvePrincipalThread`、`resolveDocumentHref` 宿主实现 → EP2/EP4；
- 本批次仅留盘，主会话统一提交。