# EP1-10 凭证授权 seam 移植计划（A8）

- 依据：`docs/process/specs/2026-09-08-credentials-authorization-design.md`
- 状态：按七阶段流程 design→plan→implement(TDD)→verify（review/验证证据归主会话统一提交）

## 步骤

### 1. 包骨架（S1）
- [x] `packages/credentials/authorization/package.json`（@flowforge/credentials-authorization，ESM，peer/dev 仅 @flowforge/llm）
- [x] `tsconfig.json` / `tsconfig.host.json`（仿 context-assembly，extends 根 base）
- [x] 根级注册：`tsconfig.base.json` paths 增补 @flowforge/credentials-authorization

### 2. wire-safe 类型面（S2）
- [x] `src/types.ts`：AuthorizationMethod/Notice/Prompt/Option/Status/Settlement/Outcome/Entry（零 cordis/service import）

### 3. 错误与端口（S3）
- [x] `src/error.ts`：AuthorizationError + AuthorizationDeclinedError（DECLINED）
- [x] `src/ports/credentials.ts`：AuthorizationCredentialsPort + MemoryCredentialsStore
- [x] `src/ports/host.ts`：AuthorizationHostPort + MemoryAuthorizationHost + InMemoryAuthorizationLogger

### 4. 服务（S4）
- [x] `src/service.ts`：AuthorizationService（registerFlow/describe/list/begin + attempt 生命周期 + 结算清理 + 事件广播）

### 5. invariant + 内存装配（S5）
- [x] `src/invariant.ts`：installAuthorizationInvariant / createAuthorizationInvariantTarget / apply
- [x] `src/memory.ts`：createAuthorizationRuntime / memoryAuthorizationRuntime
- [x] `src/index.ts` 统一导出

### 6. 契约测试（TDD，S6）
- [x] `tests/types.test.ts` `invariant.test.ts` `service.test.ts` `helpers.ts`

### 7. 验证（S7）
- [x] `pnpm vitest run packages/credentials/authorization` 50/50 全绿
- [x] `pnpm tsc -b packages/credentials/authorization/tsconfig.json` exit 0
- [x] `pnpm oxlint packages/credentials/authorization` 0 告警

### 8. 文档同步（S8）
- [x] `task.md`（EP1 序 10 行标 🟩）、`10-stage-map.md`（D46 标 🟩）、`review_code.md` §13 对应条目同步

## 交付清单（DoD）
- 契约测试全绿 + 包级 tsc exit 0 + oxlint 0
- 零 @deepseek/@cat-cafe/@clowder 引用
- 文件 ≤1000 行；三份 refactor 文档对应行已标 🟩