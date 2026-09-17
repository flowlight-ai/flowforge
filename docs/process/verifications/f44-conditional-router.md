# f44-conditional-router 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。
### [2026-09-17T11:13:45.552Z] npx vitest run packages/workflow/conditional-router
- **命令**：`npx vitest run packages/workflow/conditional-router`
- **退出码**：0
- **输出摘要**：契约测试 3 文件 54/54 全绿（py-semantics 11 / expression 24 / router 19）
- **结论**：通过### [2026-09-17T11:13:50.770Z] cd packages/workflow/conditional-router && npx tsc -p tsconfig.json --noEmit
- **命令**：`cd packages/workflow/conditional-router && npx tsc -p tsconfig.json --noEmit`
- **退出码**：0
- **输出摘要**：包级类型检查 exit 0
- **结论**：通过### [2026-09-17T11:13:51.082Z] npx oxlint packages/workflow/conditional-router
- **命令**：`npx oxlint packages/workflow/conditional-router`
- **退出码**：0
- **输出摘要**：oxlint 12 文件 0 error / 0 warning
- **结论**：通过### [2026-09-17T11:13:51.398Z] npx tsc -b tsconfig.host.json | grep -c workflow/conditional-router
- **命令**：`npx tsc -b tsconfig.host.json | grep -c workflow/conditional-router`
- **退出码**：0
- **输出摘要**：全仓类型检查归因：292 条既有债中属本包 0 条（本批零引入）
- **结论**：通过