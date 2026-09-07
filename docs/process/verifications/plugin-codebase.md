# plugin-codebase 验证证据

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-codebase` |
| 工作流 | greenfield |
| 日期 | 2026-09-07 |

## 证据条目（Evidence Log）

### [2026-09-07 14:12] pnpm vitest run packages/plugins/codebase

- **命令**：`pnpm vitest run packages/plugins/codebase`
- **退出码**：0
- **输出摘要**：`Test Files  5 passed (5)` / `Tests  57 passed (57)`（graph-model 7 / query 9 / discover-indexer 11 / store 17 / cli 13）
- **耗时**：16.68s
- **结论**：契约测试全绿——真实临时目录 DB + fixture 微型仓库（T1-T9 零 Mock）

### [2026-09-07 14:13] ff_codebase index（真实仓库验收 1）

- **命令**：`node packages/plugins/codebase/bin/ff_codebase.mjs index --repo . --mode fast`
- **退出码**：0
- **输出摘要**：`filesIndexed: 8376`，nodeCount 10406 / edgeCount 10405，coverage.excluded 17 目录（node_modules/lib/dist/.flowforge 等），skipped 1（web/node_modules.bak 下 2MB+ 超限文件，诚实上报）
- **耗时**：55.5s
- **结论**：真实仓库（8376 文件级）结构层索引闭环

### [2026-09-07 14:14] ff_codebase status / query / schema（真实仓库验收 2/3/5）

- **命令**：`node packages/plugins/codebase/bin/ff_codebase.mjs status` ＋ `... query --label File --limit 3` ＋ `... schema`
- **退出码**：0（三个命令均）
- **输出摘要**：status 上报 lastMode=fast / filesIndexed=8376 / nodeCount / edgeCount；query 返回 File 节点（language/lines/sizeBytes 属性齐备）+ 分页契约 `total: 8376, hasMore: true`；schema 输出标签计数（File 8376 / Folder 2029 / Project 1）与边类型计数（CONTAINS_FILE 8376 / CONTAINS_FOLDER 2029）
- **结论**：index → query → schema 闭环验收通过

### [2026-09-07 14:14] ff_codebase search（真实仓库验收 4）

- **命令**：`node packages/plugins/codebase/bin/ff_codebase.mjs search --query "plugin dev codebase" --limit 5`
- **退出码**：0
- **输出摘要**：`total: 0` + note（噪音标签过滤契约）
- **结论**：**C 语义正确行为**——EP-CB0 仅结构层节点（File/Folder/Project 均为 C 源项目 search_graph 噪音标签，mcp.c L3636 `n.label NOT IN ('File','Folder','Variable','Project')` 原文核验），符号级搜索随 EP-CB1 落地；BM25 camelCase 切分与排序断言由 store.spec 17 项单测覆盖（含 camelCase 切分/加权排序/分页稳定性）

### [2026-09-07 14:19] pnpm exec oxlint packages/plugins/codebase

- **命令**：`pnpm exec oxlint packages/plugins/codebase`
- **退出码**：0
- **输出摘要**：`Found 0 warnings and 0 errors`（17 文件）
- **耗时**：12.0s
- **结论**：静态检查干净

### [2026-09-07 14:20] tsc -b packages/plugins/codebase

- **命令**：`pnpm exec tsc -b packages/plugins/codebase`
- **退出码**：0
- **输出摘要**：构建成功，无类型错误
- **结论**：包级类型干净

### [2026-09-07 14:19] pnpm typecheck（host 聚合）

- **命令**：`pnpm typecheck`
- **退出码**：2
- **输出摘要**：3 个错误全部位于 `packages/chat/realtime/tests/socket-io-transport.spec.ts`（无关工作流的未跟踪本地文件，已排除出本 PR：TS2300 重复标识符 / TS2724 导出缺失 / TS2339 属性缺失）；**本包及其测试在本次聚合构建中零错误**
- **结论**：PR 范围内类型干净（CI 将在不含上述本地未跟踪文件的环境重跑聚合构建）

## 回归验证（红-绿循环，bug 修复必须）

- [x] EP-CB0 为新交付（greenfield），无存量行为回归面；TDD 红绿循环节奏见实施计划各任务（先写失败测试再实现）

## 需求核对（finish 前置）

- [x] 重读实施计划，逐项 checklist 核对（任务 1-5 全部 [x]，T1.1-T1.11 全部落地）
- [x] 每项验证输出含具体数字（57 passed / exit 0 / 8376 files），无"跑过了"式表述

## DCP-3 发布决策（greenfield 工作流）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| release_risk | 0.40 | 0.6 | 0.95 | 全新独立包，零运行时依赖，不触碰存量代码面（仅 tsconfig.host.json references 增一行 + .gitignore/AGENTS.md/13-dev-process.md 文档回填） |
| test_coverage | 0.35 | 0.80 | 0.85 | 57 项契约测试覆盖五层（模型/存储/索引/查询/CLI）；真实仓库冒烟验收 1-5 全部 exit 0 |
| security | 0.25 | 0.8 | 0.95 | 全参数化 SQL、无网络访问、文件读取上限、正则输入 try-catch 兜底 |

加权总分 0.91 / 阈值 0.75；**操作者签核**（verify→finish 硬门禁）：操作者 operator，日期 2026-09-07。
登记：`ff_dev gate plugin-codebase verify --score 0.91 --evidence docs/process/verifications/plugin-codebase.md`。
### [2026-09-07T06:21:49.271Z] pnpm vitest run packages/plugins/codebase
- **命令**：`pnpm vitest run packages/plugins/codebase`
- **退出码**：0
- **输出摘要**：Test Files 5 passed (5) / Tests 57 passed (57)
- **结论**：通过