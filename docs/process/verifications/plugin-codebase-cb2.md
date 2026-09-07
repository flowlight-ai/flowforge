# plugin-codebase EP-CB2 验证证据（工具面补全 + 文档生成器 + MCP）

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-codebase-cb2` |
| 工作流 | feature |
| 日期 | 2026-09-07 |
| 关联设计/计划 | `docs/process/specs/2026-09-07-plugin-codebase-cb2-design.md`、`docs/process/plans/2026-09-07-plugin-codebase-cb2.md` |

## 证据条目（Evidence Log）

### [2026-09-07 19:15] pnpm vitest run packages/plugins/codebase（全量回归）

- **命令**：`pnpm vitest run packages/plugins/codebase`
- **退出码**：0
- **输出摘要**：`Test Files  18 passed (18)` / `Tests  148 passed (148)`——EP-CB0/1 既有 108 用例零回归 + EP-CB2 新增 40 用例（trace 7 / search 5 / architecture 4 / changes 5 / compare 3 / adr 5 / docgen 4 / mcp 3 / cli 冒烟 +4）
- **结论**：契约测试全绿（真实临时目录 DB + fixture 微型仓库，T1-T9 零 Mock）

### [2026-09-07 19:17] 包级类型检查 tsc --noEmit

- **命令**：`npx tsc -p packages/plugins/codebase/tsconfig.json --noEmit`
- **退出码**：0
- **结论**：`exactOptionalPropertyTypes`/`strict` 全开下零类型错误（修复 7 处 strict 违规）

### [2026-09-07 19:17] oxlint（包级）

- **命令**：`npx oxlint src tests bin`
- **退出码**：0
- **输出摘要**：`Found 0 warnings and 0 errors`（45 files）
- **结论**：无 lint 告警

### [2026-09-07 19:10] ff_codebase trace 冒烟（CLI）

- **命令**：`ff_codebase trace --repo <mini-repo> --qn mini-repo.src.utils.helper.updateCloudClient --direction callers`
- **退出码**：0
- **输出摘要**：`path` 含 `{ qn: mini-repo.symbols.demo.render, depth: 1, via: CALLS }`——验证 id→QN 邻接、render 调用 updateCloudClient
- **结论**：trace_path 真实数据闭环（原缺陷修复后回归）

### [2026-09-07 19:10] ff_codebase grep / arch / coverage 冒烟（CLI）

- **命令**：`ff_codebase grep --pattern updateCloudClient`、`ff_codebase arch --depth 1`、`ff_codebase coverage`
- **退出码**：0（三命令均）
- **输出摘要**：grep 返回 `src/utils/helper.ts` 行级命中（column 同报）；arch depth=1 模块 `src`/`symbols` + 跨模块依赖 `symbols→src`（CALLS/USAGE）；coverage 上报 symbolCount=14 等
- **结论**：EP-CB2 工具面 CLI 冒烟全过

## 结论

EP-CB2「工具面补全 + 文档生成器 + MCP」验收通过，无未决项；遗留 EP-CB3（Cypher+增量索引）、EP-CB4（语义层+LSP+跨仓库，评决策点 Q15/Q19）按 §13.0 任务表续排。