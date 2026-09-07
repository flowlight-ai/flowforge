# 实施计划：EP-CB2 工具面补全 + 文档生成器 @flowforge/plugin-codebase

**目标**：补齐 codebase 插件 7 个 P0 工具（trace_path/search_code/get_architecture/check_index_coverage/detect_changes/compare_graphs/manage_adr）+ 文档生成器（dev 供料闭环）+ MCP 装配，CLI 增 6 子命令；既有 108 用例零回归 + 新增 ≥40 用例全绿。

**架构**：八个新模块（trace/search/architecture/compare/adr/docgen/mcp）+ coverage 查询面扩展 + store 微小扩展 + tools.ts/cli/main.ts 接线。

**技术栈**：纯 node:sqlite 查询 + fs 只读 + vitest（T1-T9 零 Mock）；MCP 装配对齐 tool-lsp 契约（不引入 cordis 依赖）。

**规格**：docs/process/specs/2026-09-07-plugin-codebase-cb2-design.md；docs/refactor/34-stage-ep-cb-plugin-codebase.md（T3.1-T3.5）。

## 全局约束

- 提交一律走 ./mgr PR；单文件 ≤ 1000 行；退出码契约 0/1/2 对齐 ff_codebase。
- T1-T9：禁止 Mock fs/sqlite——测试用真实临时目录 DB + 真实 fixture 语料 + 真实磁盘检索。
- EP-CB0/1 既有 108 用例零回归；语义以 C 源项目 mcp.c 为对照。
- MCP 装配不新增 cordis 依赖（对齐 EP-CB0 T1.8 独立性承诺）。

### 任务 1：store 基础设施扩展（供 7 工具复用）

- [ ] 步骤 1：写失败测试 tests/store.spec.ts 增 4 用例——findNodeByQn 复用断言、loadProjectFileNodes（label=File 快照）、edgesOf 尾随边完备性、mtimeChanged 判定（注入显式时间戳）。
- [ ] 步骤 2：实现 store.ts：+listFileNodes(project)（label=File + filePath + sizeBytes）、+nodeById(s)（BFS 起始定位）、+edgesOf 按 type 过滤（供 trace 载子集）、+lastIndexedAt(project)。
- [ ] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认新旧测试通过后进入任务 2。

### 任务 2：trace.ts 调用链追踪（T3.1a）

- [ ] 步骤 1：写失败测试 tests/trace.spec.ts 8 用例——callees 正向 BFS、callers 反向、max_depth 截断、visited 防环（自环/回归边）、CALLS+USAGE 载体边、未知 qn→SymbolNotFoundError、非符号/未索引→ProjectNotFoundError、深度升序+同深字典序确定性。
- [ ] 步骤 2：实现 src/trace.ts：neighbors(edges, qn, direction) + tracePath(store, opts) BFS（visited Set + depth 上限 + 结果排序稳定）。
- [ ] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 3。

### 任务 3：search.ts 原文检索 + architecture.ts（T3.1b/T3.1c）

- [ ] 步骤 1：写失败测试 tests/search.spec.ts 6 用例——字面量逐行匹配、正则匹配、file_pattern 过滤、超大文件 truncated 诚实标记、正则编译失败 UsageError、total/hasMore 契约。
- [ ] 步骤 2：写失败测试 tests/architecture.spec.ts 6 用例——模块边界（package.json 标记）、跨模块 CALLS 依赖聚合、IMPORTS 依赖、热点文件按 complexity 排序、无模块退化场景、exit0 输出形状。
- [ ] 步骤 3：实现 src/search.ts（listFileNodes + readFileSync 逐行匹配 + maxFiles 截断）+ src/architecture.ts（模块推导 + 依赖矩阵 + 热点排序）。
- [ ] 步骤 4：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 4。

### 任务 4：coverage 查询面 + changes.ts + compare.ts（T3.2a/T3.2b/T3.2c）

- [ ] 步骤 1：写失败测试 tests/coverage.spec.ts 4 用例——reuse indexStatus 计数、三态并列上报、file_pattern 缺席文件并列、退出码。
- [ ] 步骤 2：写失败测试 tests/changes.spec.ts 5 用例——mevtime 变更（注入 mtime）、新增文件、删除文件、无变更空集、lastIndexedAt 回退。
- [ ] 步骤 3：写失败测试 tests/compare.spec.ts 4 用例——added nodes、removed edges、空集、两项目名校验。
- [ ] 步骤 4：实现 src/coverage.ts 扩展（checkIndexCoverage）、src/changes.ts（fs.stat mtime 对比）、src/compare.ts（快照差集）。
- [ ] 步骤 5：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 5。

### 任务 5：adr.ts + docgen.ts（T3.3/T3.4）

- [ ] 步骤 1：写失败测试 tests/adr.spec.ts 5 用例——list、get、create（编号递增+模板）、无效目录、编号解析。
- [ ] 步骤 2：写失败测试 tests/docgen.spec.ts 5 用例——spec 骨架结构、plan 骨架结构、feature_name 注入、out_path 落地、No-Placeholder 纪律（校验无 "TODO"/"TBD"假文本）。
- [ ] 步骤 3：实现 src/adr.ts（docs/decisions/ 扫描 + 编号递增 + Markdown 模板）+ src/docgen.ts（查询面 → 骨架生成）。
- [ ] 步骤 4：跑 pnpm vitest run packages/plugins/codebase 确认测试通过后进入任务 6。

### 任务 6：mcp.ts 装配 + tools.ts/cli 接线（T3.5）

- [ ] 步骤 1：写失败测试 tests/mcp.spec.ts 4 用例——装配结果对齐 tool-lsp 形状（name/description/inputSchema/execute）、execute 分发到 trace、只读工具集合（不含 index_repository 写工具）、数量断言。
- [ ] 步骤 2：实现 src/mcp.ts（mountCodebaseTools：包装已实现工具）。
- [ ] 步骤 3：tools.ts 增 7 工具注册（trace_path/search_code/get_architecture/check_index_coverage/detect_changes/compare_graphs/manage_adr 已声明 → implementedIn 置 EP-CB2）+ execute 分支 + cli/main.ts 增 trace/arch/coverage/changes/compare/adr 子命令。
- [ ] 步骤 4：cli.spec.ts 增 6 冒烟用例；跑 pnpm vitest run packages/plugins/codebase 确认全量收口（≥148 用例全绿、连续两次一致）。

### 任务 7：真实仓库验证 + 文档收口

- [ ] 步骤 1：写验证（docs/process/verifications/plugin-codebase-cb2.md）：trace（真实 qn）、arch、coverage、changes、compare（对本仓库两条索引）、docgen（真实生成骨架）冒烟 exit 0。
- [ ] 步骤 2：跑 pnpm vitest run packages/plugins/codebase + tsc -b + oxlint，输出数字记入验证文档。
- [ ] 步骤 3：34-stage T3.1-T3.5 勾选 + README 批次表更新 + review_code.md §13.0 进度登记 + 流程实例 gate design/plan/verify + ./mgr sync 提交 PR。

```sh
node packages/plugins/codebase/bin/ff_codebase.mjs trace --repo . --qn flowforge.packages.plugins.codebase.src.symbols.computeQualifiedName
node packages/plugins/codebase/bin/ff_codebase.mjs arch --repo .
node packages/plugins/codebase/bin/ff_codebase.mjs coverage --repo .
node packages/plugins/codebase/bin/ff_codebase.mjs changes --repo .
node packages/plugins/codebase/bin/ff_codebase.mjs compare --project-a <a> --project-b <b>
node packages/plugins/codebase/bin/ff_codebase.mjs adr --repo . --action list
node packages/plugins/codebase/bin/ff_codebase.mjs docgen --repo . --template spec --feature-name foo
```