# 实施计划：EP-CB0 代码智能插件骨架 @flowforge/plugin-codebase

**目标**：交付 packages/plugins/codebase 包：图谱域模型 + node:sqlite 存储（FTS5 BM25）+ 结构层索引（Project→Folder→File→Module）+ 结构化查询（分页契约）+ ff_codebase CLI 七子命令，对本仓库跑通 index→query→schema 闭环。

**架构**：三层（存储 store.ts / 域 graph-model+indexer+discover+coverage+query / 面 tools+CLI）+ RAM-first 批量事务落盘 + 索引监督进程隔离（CLI 独立进程跑索引，工具侧只读）。

**技术栈**：TypeScript ESM（tsx 直跑）、node:sqlite（Node ≥22.5 内置）、vitest；零运行时依赖。

**规格**：docs/process/specs/2026-09-07-plugin-codebase-design.md（本实例设计文档）；docs/refactor/34-stage-ep-cb-plugin-codebase.md（T1.1-T1.11）。

## 全局约束

- 提交一律走 ./mgr PR；单文件 ≤ 1000 行；退出码契约 0/1/2 对齐 ff_dev/ff_doctor。
- T1-T9：禁止 Mock 文件系统/sqlite——测试用真实临时目录 DB + tests/fixtures/ 微型仓库。
- 数据落点 .flowforge/（仓库本地，gitignore）。
- 覆盖率诚实契约：excluded（设计排除）与 skipped（失败跳过）分离；"缺席≠完整"。

### 任务 1：包骨架 + 图谱域模型（graph-model.ts）

- [x] 步骤 1：建包目录与 package.json（对齐 plugin-dev 模板：name=@flowforge/plugin-codebase、bin=ff_codebase、exports、files、vitest/tsx devDeps），写失败测试 tests/graph-model.spec.ts 断言标签/边/属性族枚举完整性。
- [x] 步骤 2：实现 src/graph-model.ts：NODE_LABELS（Function/Method/Class/Interface/Module/File/Folder/Route/Variable/Resource/Channel）+ EDGE_TYPES（CALLS/USAGE/CALL_REFERENCE/INHERITS/IMPLEMENTS/CONTAINS_FOLDER/CONTAINS_FILE/IMPORTS/CROSS_HTTP_CALLS/CROSS_ASYNC_CALLS/CROSS_CHANNEL）+ 复杂度属性族类型定义。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 2。

```ts
export const NODE_LABELS = ['Function', 'Method', 'Class', 'Interface', 'Module',
  'File', 'Folder', 'Route', 'Variable', 'Resource', 'Channel'] as const
export type NodeLabel = (typeof NODE_LABELS)[number]
export const EDGE_TYPES = ['CALLS', 'USAGE', 'CALL_REFERENCE', 'INHERITS',
  'IMPLEMENTS', 'CONTAINS_FOLDER', 'CONTAINS_FILE', 'IMPORTS',
  'CROSS_HTTP_CALLS', 'CROSS_ASYNC_CALLS', 'CROSS_CHANNEL'] as const
export type EdgeType = (typeof EDGE_TYPES)[number]
```

### 任务 2：存储引擎（store.ts，node:sqlite + FTS5）

- [x] 步骤 1：写失败测试 tests/store.spec.ts：真实临时目录开 DB → 建表 → 批量 upsert 节点/边 → BM25 搜索断言排序与 camelCase 切分 → 分页契约断言（total/has_more）。
- [x] 步骤 2：实现 src/store.ts：SchemaSync（projects/nodes/edges/node_props/fts 虚表）+ RAM-first 批量事务（open/dispose 生命周期）+ labelCounts + schema 概览（对齐 get_graph_schema 语义）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 3。

```ts
export interface StoreQueryResult { readonly rows: readonly GraphNode[]; readonly total: number; readonly hasMore: boolean }
export interface CodebaseStore { open(): void; dispose(): void; upsertNodes(nodes: readonly NodeRecord[]): void;
  insertEdges(edges: readonly EdgeRecord[]): void; search(opts: SearchOptions): StoreQueryResult; labelCounts(): LabelCount[] }
```

### 任务 3：文件发现 + 结构层索引器（discover.ts / indexer.ts / coverage.ts）

- [x] 步骤 1：写失败测试 tests/indexer.spec.ts：fixture 微型仓库（tests/fixtures/mini-repo：含 src/子目录、package.json、README.md、被排除目录 out/）断言 Project→Folder→File 树、Module 检测、excluded 上报、文件属性（language/lines/size）。
- [x] 步骤 2：实现 src/discover.ts（目录遍历 + 默认排除 node_modules/lib/dist/.git/.flowforge + 显式 exclude 参数）+ src/indexer.ts（索引模式 full/moderate/fast 文件过滤档位 + index_status 元数据）+ src/coverage.ts（三态上报）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 4。

```ts
export interface IndexResult { readonly project: string; readonly mode: IndexMode; readonly filesIndexed: number;
  readonly nodes: number; readonly edges: number; readonly coverage: CoverageReport; readonly durationMs: number }
export interface CoverageReport { readonly excluded: readonly string[]; readonly skipped: readonly string[]; readonly parsePartial: readonly string[] }
```

### 任务 4：查询域 + 项目注册表 + 工具面（query.ts / project.ts / tools.ts）

- [x] 步骤 1：写失败测试 tests/query.spec.ts 与 tests/project.spec.ts：label/name_pattern（regex）/file_pattern/min_degree 过滤、分页契约、项目名安全化（非 ASCII/不安全字符）、list/delete 项目。
- [x] 步骤 2：实现 src/query.ts（结构化过滤 + BM25 query 搜索：结构加权 Function/Method +10、Route +8、Class/Interface +5，噪音标签过滤）+ src/project.ts（多项目注册表）+ src/tools.ts（17 工具注册表，EP-CB0 实现 6 个：index_repository/list_projects/delete_project/index_status/get_graph_schema/search_graph 基础档）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 5。

```ts
export interface SearchOptions { readonly project: string; readonly query?: string; readonly label?: NodeLabel;
  readonly namePattern?: string; readonly filePattern?: string; readonly minDegree?: number;
  readonly maxDegree?: number; readonly limit?: number; readonly offset?: number }
```

### 任务 5：CLI + 端到端验证 + 文档收尾

- [x] 步骤 1：写失败测试 tests/cli.spec.ts：init/index/query/schema/status/projects/search/delete 子命令端到端冒烟（fixture 仓库 + 临时 DB）+ 退出码契约（0 成功/1 违规/2 用法错误）。
- [x] 步骤 2：实现 bin/ff_codebase.mjs + src/cli/main.ts（手写参数解析对齐 plugin-dev 模式）+ .flowforge/ gitignore 规则 + 包 README。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认全部测试通过，对真实仓库执行 node packages/plugins/codebase/bin/ff_codebase.mjs index --repo . 与 query/search/schema/status 冒烟（34-stage §5 验收 1-5），走 ./mgr sync 提交 PR。

```sh
node packages/plugins/codebase/bin/ff_codebase.mjs index --repo . --mode fast
node packages/plugins/codebase/bin/ff_codebase.mjs query --label File --limit 5
node packages/plugins/codebase/bin/ff_codebase.mjs search --query "plugin" --limit 5
```
