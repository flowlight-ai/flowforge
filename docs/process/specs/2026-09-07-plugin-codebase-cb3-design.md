# EP-CB3 Cypher 子集 + 增量索引 + 轨迹摄取设计（@flowforge/plugin-codebase）

## 1. 目标

在 EP-CB0 结构层 + EP-CB1 符号层 + EP-CB2 全工具面的基础上，交付：
1. **Cypher 查询引擎子集**（`cypher.ts` + `cypher-lexer.ts` + `cypher-parser.ts` + `cypher-executor.ts`）——MATCH/WHERE/RETURN/ORDER BY/LIMIT + 100k 行上限契约（对齐 C 源项目 `src/cypher/` 语义，Q19 已裁决）；
2. **missed graph**（`missed.ts`）——未完全索引文件的文件结构图 + `graph="missed"` 查询；
3. **watcher 增量索引**（`watcher.ts`）——mtime 感知的增量重索引，复用 EP-CB2 的 detect_changes；
4. **ingest_traces 轨迹摄取**（`traces.ts`）——外部轨迹数据落库对齐 C `traces/` 模块；
5. **持久化工件**（`artifact.ts`）——压缩 artifact 团队共享（对齐 C 的 graph.db.zst 模型）。

**决策依据**：review_code.md §13.0 EP-CB3 待推进；Q19 已裁决（结构化查询先行，Cypher 子集随 EP-CB3）；
本批后 EP-CB（结构/符号/查询/工具/增量）全链路可用，EP-CB4 仅剩语义层+LSP+跨仓库。

## 2. 范围

### In scope（EP-CB3）
- Cypher lexer（`TOK_*` 子集：MATCH/WHERE/RETURN/ORDER BY/LIMIT/AND/OR/AS/COUNT/NEQ/contains 等 40 关键 token）
- Cypher parser（AST：node pattern `(n:Label {prop:"val"})`、rel pattern `-[:TYPE*1..3]->`、WHERE 表达式树、RETURN items）
- Cypher executor（MATCH 绑定 + WHERE 求值 + RETURN 映射/聚合 + ORDER BY + LIMIT + 100k 行上限 + 执行预算）
- missed graph（`missed.ts`：对照 discoverFiles 与 store 已有 File 节点，产出未索引文件的目录骨架）
- watcher 增量索引（`watcher.ts`：mtime 基线 + 增量节点/边集更新）
- ingest_traces（`traces.ts`：轨迹记录集合落库 + 查询）
- artifact 持久化（`artifact.ts`：project 全量 dump 为 JSON 压缩快照 + restore）
- CLI：`cypher`/`missed`/`watch`/`ingest`/`artifact` 子命令
- 工具注册表补齐：`query_cypher`/`ingest_traces`（+ 既有 18 工具）

### Out of scope（EP-CB4）
- semantic edges + simhash 相似度去重边
- 向量检索（semantic_query）
- LSP 融合（Hybrid LSP）
- CROSS_* 跨仓库边（cross-repo-intelligence）
- transitive_loop_depth 过程间传播

## 3. 架构：Cypher 四段管线 + 三个独立模块

```
src/
├── cypher-lexer.ts     # T4.1a tokenize：Cypher 子集 token（40 关键 + 符号 + 字面量 + EOF）
├── cypher-parser.ts    # T4.1b parse：AST（pattern/where/return/order/limit）
├── cypher-executor.ts  # T4.1c execute：MATCH 绑定 + WHERE + RETURN + 排序/分页 + 上限
├── cypher.ts           # T4.1d 入口：queryCypher(store, query, project) 统一出口 + 错误分类
├── missed.ts           # T4.2   图索引缺口：未索引文件目录骨架
├── watcher.ts          # T4.3   增量索引：mtime 基线 + 增量 upsert
├── traces.ts           # T4.4   轨迹摄取：轨迹记录落库 + 查询
├── artifact.ts         # T4.5   持久化：全量 dump/restore（zstd JSON）
├── store.ts            # 扩展：节点 props 索引建表、轨迹表、增量差异接口
├── tools.ts            # 扩展：+query_cypher/+ingest_traces
└── cli/main.ts         # 扩展：+cypher/+missed/+watch/+ingest/+artifact
```

**设计要点**：
- Cypher 引擎为**纯只读**查询面：每次执行显式传入 project，MATCH 从 store 读节点/边快照，不写库。
- lexer/parser/executor 三态分离，便于单测各层；错误分类对齐 C：`UsageError`（2）/未知 project（1）。
- watcher 复用 EP-CB2 `detectChanges`（mtime 对比）+ indexer 的节点/边生成，产出 `{ added, modified, removed }` 增量。
- traces 表独立建表（project+轨迹 ID+时间戳），对外仅落库与查询，不进 BM25。

## 4. 核心语义（C 源对照）

### 4.1 Cypher lexer（cypher.h TOK_* 章节子集）

支持 token：
- 关键字：MATCH/WHERE/RETURN/ORDER/BY/LIMIT/AND/OR/NOT/AS/ASC/DESC/COUNT/DISTINCT/CONTAINS/STARTS/ENDS/WITH/XOR/IN/IS/NULL/SKIP/UNION/UNWIND 等（解析到带上限的 `CypherTokenType`）
- 符号：`(` `)` `[` `]` `-` `>` `<` `:` `.` `{` `}` `*` `,` `=` `=~` `>=` `<=` `<` `>` `|` `..`
- 字面量：IDENT（标识符）、STRING（单双引号）、NUMBER
- EOF

不支持的写/管理关键字（CREATE/DELETE/SET/MERGE 等）在 lexer 阶段识别并**拒绝**（`UsageError`，"Cypher WRITE 子句不受支持"）。

### 4.2 Cypher parser

AST（对齐 cbm_query_t 子集）：
- `pattern[]`：交替 node/rel。node = `{ variable?, label?, props[]{key,valueLiteral} }`；rel = `{ variable?, types[], direction: outbound|inbound|any, minHops, maxHops }`（`*1..3` 解析 min/max，省略=1；`*`=unbounded 上限 64）。
- `where`：表达式树（AND/OR/NOT + 叶子 condition）。condition op：`=` `<>` `=~` `>` `<` `>=` `<=` `CONTAINS` `STARTS WITH` `ENDS WITH` `IN` `IS NULL` `IS NOT NULL`。
- `return`：items（`variable.property` + 可选 alias + 可选 func: COUNT/SUM/AVG/MIN/MAX/COLLECT + distinct）、`orderBy[]`（key + asc/desc）、`skip`、`limit`。
- 上限：ORDER BY keys ≤ 8（对齐 C `CBM_CYPHER_ORDER_KEYS_MAX`，超限报错而非静默丢弃）；RETURN 结果行 ≤ 100k（对齐 C 虚拟上限）。

### 4.3 Cypher executor

匹配语义（对本仓库 graph 的实际执行）：
- 单 node pattern：label 过滤 + inline props 过滤。
- 双 node pattern（node0 -rel- node1）：从 node0 定位起点（label+props），沿 reverseIndex（source→[{target,type}] 与 target→[{source,type}]）BFS 展开 rel，type 过滤 + 方向过滤 + min/max hops。
- 3+ node pattern：级联 join（前一 pattern 的锚点绑定后继续）。
- WHERE 表达式树对候选绑定求值。
- RETURN：按 items 生成列；COUNT/SUM/AVG/MIN/MAX/COLLECT 聚合（显式 `RETURN COUNT(n)` 或 `RETURN n.name, COUNT(m)` 分组）；ORDER BY（多 key + 方向）；SKIP/LIMIT。
- 执行预算：总遍历节点次设上限（默认 1e6，超时返回 `warning` + 已得前缀，不抛错——对齐 C wall-clock budget 的"诚实部分结果"精神）。
- 结果列给字符串化值（null → 空串）。
- 上限：行数 > 100k → `error`（"结果集超 100k 行上限，请加 LIMIT"）。

### 4.4 missed graph（C discover/coverage 延续）

- 输入：project + repoPath。
- 逻辑：`discoverFiles(repoPath)` 求得磁盘文件全集；`store.listFileNodes` 求得已索引 File 节点；差集为未索引文件。
- 输出：未索引文件的**目录骨架**（只含未索引文件路径，按目录聚合），+ `totalMissed`。与 EP-CB2 `checkIndexCoverage` 区别：missed 输出目录树结构（可导航），coverage 只出扁平清单。

### 4.5 watcher 增量索引（C watcher 模块）

- 输入：project + repoPath + lastIndexedAt（无则全量）。
- 逻辑：对比磁盘文件 mtime 与 projects.last_indexed_at，得到 `{ added[], modified[], removed[] }`；对 added/modified 调用 indexer 增量生成节点/边并 upsert；removed 从 store 删除（File 节点 + 其符号节点 + 关联边 + FTS）。
- 输出：`{ added: n, modified: n, removed: n, durationMs }`。
- 说明：本批为**命令式一次性增量**（`ff_codebase watch --repo ...`），不做常驻 fs.watch 守护（守护 daemon 形态 EP-CB4/后续按需）。

### 4.6 ingest_traces（C traces 模块）

- 入参：project + traces[]（每条 `{ trace_id, name, agent?, timestamp?, metadata{} }`）或 JSON 文件路径。
- 存储：`traces` 表（project/trace_id/name/agent/timestamp/metadata_json）。
- 查询：`ingest_traces` 落库后，`query_traces(project, limit)` 返回最近 N 条；复用工具注册表 + CLI。

### 4.7 artifact 持久化（C graph.db.zst 模型）

- `dump_artifact(project, outPath)`：将项目全部节点/边/props/轨迹序列化为 NDJSON + zstd 压缩写入 outPath（Node zlib 仅 deflate；zstd 用 `zstd` CLI 探测，缺失时退化为 gzip——诚实上报压缩格式字段）。
- `restore_artifact(project, inPath)`：解压 → 逐条 upsert 到目标 store（覆盖同 id）。

## 5. 工具/CLI 面

- 工具注册表新增：`query_cypher`（描述：Cypher 子集查询，对齐 C query_graph 的 cypher 分支）、`ingest_traces`。
- CLI 新增子命令：`cypher --repo <path> --query "<MATCH...>" [--project <n>]`、`missed --repo <path> [--project <n>]`、`watch --repo <path> [--project <n>]`、`ingest --repo <path> --traces <json|path> [--project <n>]`、`artifact --action dump|restore [--repo <path>] [--project <n>] [--out <path>]`。

## 6. 测试策略（T1-T9 铁律）

- 全部真实临时目录 DB + 真实 fixture 微型仓库；禁止 Mock fs/sqlite。
- lexer：15+ token 边界（关键字/字符串转义/数字/未知写关键字拒绝）。
- parser：AST 结构断言（pattern 展开、rel hops、WHERE 表达式树、ORDER/LIMIT）。
- executor：单/双/三 node pattern 匹配、WHERE 各类 op、聚合、排序、LIMIT、100k 上限、执行预算 warning。
- missed：真实 fixture 删除一个文件后 missed 谷出现该文件。
- watcher：mtime 注入增量（增/改/删三态）+ 全量回退。
- traces：落库+查询。
- artifact：dump→restore 幂等。

## 7. 验收

1. `ff_codebase cypher --query 'MATCH (n:Function) RETURN n.name LIMIT 5'` 对本仓库返回符号列表；
2. 双 node 查询 `MATCH (a:Function)-[:CALLS]->(b:Function) RETURN a.name,b.name LIMIT 3` 返回真实调用链；
3. WHERE/ORDER BY/LIMIT 组合查询语义正确；
4. `ff_codebase missed/net check` 对删除文件的项目返回差异；
5. `ff_codebase watch` 增量三态正确；
6. `ff_codebase artifact dump/restore` 幂等；
7. vitest 全绿（既有 148 零回归 + 新增 ≥50）、包级 tsc exit 0、oxlint 0；
8. 走完 plugin-dev 七阶段流程（实例 + 四产物 + mgr PR）。

## 8. 边界与异常

- Cypher WRITE 子句（CREATE/MERGE/SET/DELETE）→ `UsageError`（2）。
- ORDER BY > 8 key → `UsageError`（对齐 C `#1334`：unmodeled key 必须响亮报错）。
- 结果 > 100k 行 → error（提示加 LIMIT）。
- 执行预算超限 → 返回前缀 + warning（诚实部分结果，不抛错）。
- 未知 project → `ProjectNotFoundError`（1）。
- watcher/ingest 对未 index 的 repo → 先全量或报错提示（1）。

## 9. 依赖与风险

- zstd：Node 原生无内置 zstd——采用 `zstd` CLI 探测 + gzip 退化，诚实上报 format 字段（零外部依赖，契合禁依赖红线）。
- Cypher 引擎规模：C 源 14.4 万行中 cypher 为最大块——本批按"子集"边界裁剪（写子句拒绝 + 单条链查询为主），后续按需扩展，避免一次全量移植失控。
- watcher 一次性 vs 常驻：本批一次性；常驻 fs.watch 守护与 daemon 形态归 EP-CB4 决策。