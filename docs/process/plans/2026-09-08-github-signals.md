# EP1-5 实施计划：GitHub 等待生命周期域 github-signals 移植（B5 · C47，自包含批次）

- 依据：`docs/process/specs/2026-09-08-github-signals-design.md`
- 批次目标：落 `packages/infrastructure/github-signals`（@flowforge/infrastructure-github-signals），
  GitHubWaitLifecycleService/predicate catalog/baseline readers/state-machine/renderer +
  注入式端口（ITaskStore/ConnectorDelivery/IWaitLifecycleEventLog）+ 内存实现，
  vitest/tsc/oxlint 全绿。
- 遵循：测试铁律 T1–T9，禁 Mock，仅留盘（不 git add / commit / push，由主会话统一提交）。
- 边界：**不含** 真实 GitHub API 适配、TaskStore 宿主接线、真实连接器投递、eventLog 持久化（EP2/EP4
  承接，见设计 §9）。

## 步骤与门禁

| # | 步骤 | 产物 | 门禁 |
|---|---|---|---|
| 1 | 域契约（contract：github-wait / baseline / predicate / owner-fence） | `src/contract/*` | 包级 tsc |
| 2 | 注入式端口 + 内存实现（ITaskStore / ConnectorDelivery / IWaitLifecycleEventLog） | `src/ports/*` | vitest 绿 |
| 3 | wait 状态机纯函数（transitionWaitState/mark 两件套/WaitTransitionEvent） | `src/wait-state-machine.ts` | vitest 绿 |
| 4 | 谓词目录（zod 校验 + 去重 + matchGitHubWaitPredicates） | `src/GitHubWaitPredicateCatalog.ts` | vitest 绿 |
| 5 | baseline readers（PR 三态 + Issue 单态） | `GitHubWaitBaselineReader.ts` + `GitHubIssueWaitBaselineReader.ts` | vitest 绿 |
| 6 | 渲染器（review loop brake + renderGitHubWaitOutcome） | `src/github-wait-renderer.ts` | vitest 绿 |
| 7 | GitHubWaitLifecycleService（observe/cancel/ownerChanged/recoverOutcome） | `src/GitHubWaitLifecycleService.ts` | vitest 绿 |
| 8 | 包骨架（package.json 声明 zod workspace 依赖，exports/files 对齐）+ 聚合导出 + tests | `packages/infrastructure/github-signals/` | pnpm 解析 |
| 9 | 根级注册（tsconfig.host/base/json）+ 全量核验 + oxlint + 文档同步 | 全包 + 根 tsconfig | vitest/tsc/oxlint 全绿 |

## 文件清单

- 新增（src）：`index.ts` + `contract/{github-wait,baseline,predicate,owner-fence}.ts` +
  `ports/{ITaskStore,ConnectorDelivery,IWaitLifecycleEventLog}.ts` + `wait-state-machine.ts` +
  `GitHubWaitPredicateCatalog.ts` + `GitHubWaitBaselineReader.ts` +
  `GitHubIssueWaitBaselineReader.ts` + `GitHubWaitLifecycleService.ts` + `github-wait-renderer.ts`。
- 测试：`tests/*.spec.ts`（契约测试，禁 Mock）。
- 根级注册：`tsconfig.host.json`（references）、`tsconfig.base.json`（paths `@flowforge/infrastructure-github-signals`）、
  `tsconfig.json`（references）。
- 文档：spec（上方已建）、plan（本文件）、`task.md` 5、`review_code.md` 5、`10-stage-map.md` C47。

## 验收

- 契约测试全绿；
- 包级 `tsc -b packages/infrastructure/github-signals/tsconfig.host.json` exit 0；
- `oxlint packages/infrastructure/github-signals` 0 error / 0 warning；
- 消除 `@clowder-ai/*`、`@cat-cafe/*`、`@deepseek-ai/*` 引用（唯一运行时依赖 `zod`）；
- EP2/EP4 承接：真实 GitHub API 适配、TaskStore 宿主接线、真实连接器投递、eventLog 持久化。