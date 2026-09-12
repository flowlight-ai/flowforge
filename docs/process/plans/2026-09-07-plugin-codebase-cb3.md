# 实施计划：EP-CB3 Cypher 子集 + 增量索引 + 轨迹摄取 @flowforge/plugin-codebase

**目标**：交付 Cypher 查询引擎子集（lexer/parser/executor）+ missed graph + watcher 增量索引 + ingest_traces + artifact 持久化；CLI 增 5 子命令；既有 148 用例零回归 + 新增 ≥50 用例全绿。

**架构**：四模块 Cypher 管线（cypher-lexer/parser/executor/cypher）+ missed/watcher/traces/artifact 四独立模块 + store 扩展 + tools/cli 接线。

**技术栈**：纯 node:sqlite 查询 + fs 只读 + vitest（T1-T9 零 Mock）；zstd 探测 + gzip 退化（零外部依赖）。

**规格**：docs/process/specs/2026-09-07-plugin-codebase-cb3-design.md；docs/refactor/34-stage-ep-cb-plugin-codebase.md（T4.1-T4.5）。

## 全局约束

- 提交一律走 ./mgr PR；单文件 ≤ 1000 行；退出码契约 0/1/2 对齐 ff_codebase。
- T1-T9：禁止 Mock fs/sqlite——测试用真实临时目录 DB + 真实 fixture 语料。
- EP-CB0/1/2 既有 148 用例零回归；语义以 C 源项目 cypher.h/cypher.c 为对照。
- 不引入任何外部运行时依赖（zstd 探测+gzip 退化）。

### 任务 1：store 扩展（轨迹表 + 增量差异接口）

```ts
store: +traces 表(upsertTraces/queryTraces) +edgesByType(project,type[]) +subtractNodesForFiles(project,filePaths[]) +edgesByProject
```

- [x] 步骤 1：写失败测试 tests/store.spec.ts 增 5 用例——traces 建表/upsert/list、nodeById 扩展、byType edges 过滤、deleteProject 级联删轨迹、mtime 增量基线。
- [x] 步骤 2：实现 store.ts：+traces 表、+upsertTraces/queryTraces、+edgesByType(project,type[])（供 executor/watcher 复用）、+subtractNodesForFiles(project,filePaths[])（watcher 删除用）、+edgesByProject。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认新旧测试通过后进入任务 2。

### 任务 2：Cypher lexer（T4.1a）

```ts
tokenize(query): CypherToken[]   // 40 关键字 + 符号 + 字面量 + EOF；CREATE/MERGE/SET/DELETE → WRITE 标记供 parser 拒绝
```

- [x] 步骤 1：写失败测试 tests/cypher-lexer.spec.ts 15 用例——关键字识别、IDENT/STRING(单双引号+转义)/NUMBER、符号(token)、`=~`/`>=` 复合、`*1..3` hop、写关键字(CREATE/MERGE/SET/DELETE)拒绝 UsageError、未知字符、EOF。
- [x] 步骤 2：实现 src/cypher-lexer.ts：tokenize(query)→tokens[]，Keyword 表 + 符号单字符/双字符分支，写关键字标记 WRITE 供 parser 拒绝。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认通过后进入任务 3。

### 任务 3：Cypher parser（T4.1b）

```ts
parse(tokens): CypherQuery    // 递归下降：MATCH→WHERE→RETURN→ORDER BY(≤8)→LIMIT；优先级 NOT>AND>OR；ORDER>8→UsageError
```

- [x] 步骤 1：写失败测试 tests/cypher-parser.spec.ts 12 用例——单 node pattern(含 props/匿名)、rel pattern 方向/多 type/`*1..3`/unbounded、双 node、三 node、WHERE 表达式树(AND/OR/NOT + 12 op)、RETURN items(alias/func/distinct)、ORDER BY ≤8、LIMIT/SKIP、ORDER>8 拒绝、写子句拒绝、语法错误。
- [x] 步骤 2：实现 src/cypher-parser.ts：parse(tokens)→CypherQuery AST（递归下降：MATCH→[OPTIONAL]→WHERE→RETURN→[ORDER BY]→[LIMIT]；表达式优先级 NOT>AND>OR）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认通过后进入任务 4。

### 任务 4：Cypher executor（T4.1c）+ 入口（T4.1d）

```ts
queryCypher(store, query, project): { columns; rows; warning? }   // MATCH 绑定/级联 join/WHERE/RETURN 聚合/排序/分页；>100k→error；预算>1e6→warning
```

- [x] 步骤 1：写失败测试 tests/cypher.spec.ts 18 用例——单 node label 匹配、inline props、双 node rel 展开(方向/type/hops)、caller 反向、三 node 级联、WHERE 各 op(= /<>/ =~/ 比较/contains/starts/ends/in/is null)、AND/OR/NOT、RETURN 映射列、COUNT/SUM/AVG/聚合、distinct、ORDER BY(多 key/desc)、LIMIT/SKIP、100k 上限 error、执行预算 warning、未知 project→1、写子句→UsageError。
- [x] 步骤 2：实现 src/cypher-executor.ts（MATCH 绑定/级联 join/WHERE 求值/RETURN 映射聚合/排序/分页/上限/预算）+ src/cypher.ts（queryCypher 统一出口 + 错误分类）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认通过后进入任务 5。

### 任务 5：missed graph（T4.2）

```ts
buildMissedGraph(store, repoPath, project): { tree: MissedNode; totalMissed: number }   // discover 全集 − 已索引 → 目录骨架
```

- [x] 步骤 1：写失败测试 tests/missed.spec.ts 5 用例——删除文件后 missed 目录骨架含该文件、totalMissed 计数、已索引文件不出现、无 missed 空集、路径规范化。
- [x] 步骤 2：实现 src/missed.ts：目录骨架(discover 全集 − store 已索引 → 分组)。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认通过后进入任务 6。

### 任务 6：watcher 增量（T4.3）+ traces（T4.4）+ artifact（T4.5）

```ts
watchIncremental(store, repoPath, project): { added; modified; removed; durationMs }   // mtime 增量 upsert/删除
upsertTraces + queryTraces / dumpArtifact(project,out) + restoreArtifact(project,in)  // zstd CLI 探测+gzip 退化
```

- [x] 步骤 1：写失败测试 tests/watcher.spec.ts 6——added/modified/removed 三态(mtime 注入)、edge 增量 upsert、文件删除清符号+边+FTS、全量表回退、时长字段、未索引 repo。
- [x] 步骤 2：写失败测试 tests/traces.spec.ts 4——落库、查询最近、重复 trace_id 覆盖、metadata_json 存取。
- [x] 步骤 3：写失败测试 tests/artifact.spec.ts 3——dump→restore 幂等、压缩格式字段、异常文件。
- [x] 步骤 4：实现 src/watcher.ts、src/traces.ts、src/artifact.ts。
- [x] 步骤 5：跑 pnpm vitest run packages/plugins/codebase 确认通过后进入任务 7。

### 任务 7：CLI + 工具接线 + 全量收口

```ts
tools: +query_cypher/+ingest_traces 注册 + execute 分支; cli: +cypher/+missed/+watch/+ingest/+artifact 子命令
```

- [x] 步骤 1：tools.ts 增 query_cypher/ingest_traces 注册 + execute 分支；cli/main.ts 增 cypher/missed/watch/ingest/artifact 子命令。
- [x] 步骤 2：cli.spec.ts 增 8 冒烟用例（cypher 查询/写子句拒绝/missed/watch/ingest/artifact dump-restore/退出码）。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认全量收口（≥198 用例全绿、连续两次一致）+ 包级 tsc + oxlint。

### 任务 8：真实仓库验证 + 文档收口

```sh
ff_codebase cypher --repo . --query "MATCH (n:Function) RETURN n.name LIMIT 5"
ff_codebase missed/watch/artifact --repo .
```

- [x] 步骤 1：ff_codebase cypher 对本仓库真实查询冒烟（单/双 node + WHERE/ORDER/LIMIT）；测试源见 tests/{cypher,cypher-lexer,cypher-parser}.spec.ts。
- [x] 步骤 2：ff_codebase missed/watch/artifact 实跑冒烟；测试源见 tests/{missed,watcher,traces,artifact}.spec.ts。
- [x] 步骤 3：写 verification 文档（docs/process/verifications/plugin-codebase-cb3.md）+ review 记录。
- [x] 步骤 4：review_code.md §13.0 登记 EP-CB3 完成 + 34-stage T4.x 勾选；mgr sync PR。