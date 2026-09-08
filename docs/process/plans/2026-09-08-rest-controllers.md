# EP1-7 REST 控制器族移植计划（A1-A3）

- 依据：`docs/process/specs/2026-09-08-rest-controllers-design.md`
- 状态：按七阶段流程 design→plan→implement(TDD)→verify（review/验证证据归主会话统一提交）

## 步骤

### 1. 包骨架（S1）
- [ ] `packages/api/rest-controllers/package.json`（@flowforge/api-rest-controllers，ESM，仅 zod peer/dev）
- [ ] `tsconfig.json` / `tsconfig.host.json`（仿 context-assembly，extends 根 base）

### 2. contract 契型（S2）
- [ ] `contract/session.ts` `workspace.ts` `settings.ts` `messages.ts` `index.ts`
- [ ] 文案外部化到 `messages.ts`

### 3. ports + 内存实现（S3）
- [ ] `ports/http.ts`（HttpRequest/HttpResponse/RoutePattern/RouteRegistrar/RestControllerBase）
- [ ] `ports/request-context.ts`（RequestContextResolver seam）
- [ ] `ports/stores.ts`（SessionChain/Thread/Message/HandoffProposal/RuntimeSession/InvocationRecord/TurnExecution/DeliveryCursor/Settings + SessionSealer + 内存实现）
- [ ] `ports/workspace-fs.ts` `git.ts` `workspace-security.ts` `skill-receipt.ts` `audit.ts` `socket.ts`

### 4. pure 纯逻辑（S4）
- [ ] `pure/thread-access.ts` `edit-token.ts` `git-parsers.ts` `transcript-format.ts` `session-strategy.ts` `workspace-tree.ts`

### 5. controllers（S5）
- [ ] `controllers/session-chain.ts` `session-transcript.ts` `session-strategy-config.ts` `session-hooks.ts` `session-handoff.ts` `session-runtime.ts`
- [ ] `controllers/workspace.ts` `workspace-edit.ts` `workspace-git.ts` `workspace-navigate.ts` `settings.ts`
- [ ] `src/index.ts` 统一导出

### 6. 契约测试（TDD，S6）
- [ ] `tests/session-chain.spec.ts` `session-transcript.spec.ts` `session-handoff.spec.ts` `session-strategy-config.spec.ts` `session-runtime.spec.ts`
- [ ] `tests/workspace.spec.ts` `workspace-edit.spec.ts` `workspace-git.spec.ts` `settings.spec.ts` `git-parsers.spec.ts`

### 7. 验证（S7）
- [ ] `npx vitest run packages/api/rest-controllers` 全绿
- [ ] `npx tsc -b packages/api/rest-controllers/tsconfig.host.json` exit 0
- [ ] `npx oxlint packages/api/rest-controllers` 0 告警

### 8. 根级注册 + 文档同步（S8）
- [ ] `tsconfig.base.json` paths 增补 @flowforge/api-rest-controllers
- [ ] `tsconfig.json` + `tsconfig.host.json` references 增补
- [ ] 文档同步：`task.md`（EP1 序 7 行标 🟩）、`10-stage-map.md`（D45 标 🟩）、`review_code.md` 对应 §13 条目标 🟩；保留 EP1-3/4/5/6 既有标记不动

### 9. 收尾
- [ ] 完成报告（文件清单/测试数/tsc/oxlint/边界/架构决策点），不做 git 提交

## 交付清单（DoD）
- 契约测试全绿 + 包级 tsc exit 0 + oxlint 0
- 运行时仅 zod，零 fastify/express/koa/@cat-cafe/clowder 依赖
- 文件 ≤1000 行；三个 refactor 文档对应行已标 🟩（EP1-7）