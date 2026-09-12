# 实施计划：EP-CB4 语义层 + LSP 融合 + 跨仓库智能 @flowforge/plugin-codebase

**目标**：在 EP-CB3（Cypher 子集 + 增量索引 + 轨迹 + 工件）之上补齐语义智能面：SIMILAR 相似度边 + simhash 去重（T5.1）、semantic_query min-cosine 向量检索（T5.2）、LspSeam 增强接缝（T5.3）、cross-repo 跨项目边（T5.4）、transitive_loop_depth 传播（T5.5）；CLI 增 5 子命令；既有 223 用例零回归 + 新增 ≥7 用例全绿。

**架构**：五个独立模块（semantic/lsp-seam/cross-repo/loop-depth）+ graph-model 边类型扩展 + query.ts 向量检索 + index/tools/cli 接线。

**技术栈**：纯 node:sqlite 查询 + fs 只读 + vitest（T1-T9 零 Mock）；simhash/Hamming/cosine 全部原生位运算与数组实现（零外部依赖）。

**规格**：docs/process/specs/2026-09-07-plugin-codebase-cb4-design.md；docs/refactor/34-stage-ep-cb-plugin-codebase.md（T5.1-T5.5）。

## 全局约束

- 提交一律走 ./mgr PR；单文件 ≤ 1000 行；退出码契约 0/1/2 对齐 ff_codebase。
- T1-T9：禁止 Mock fs/sqlite——测试用真实临时目录 DB + 真实 fixture 语料。
- EP-CB0/1/2/3 既有 223 用例零回归；语义以 C 源项目 search_graph/相关模块为对照。
- 不引入任何外部运行时依赖（simhash/cosine 纯原生 bitset 与数组）。

### 任务 1：图模型扩展（EDGE_TYPES 追加 SIMILAR）

```ts
EDGE_TYPES: readonly EdgeType[]   // +'SIMILAR'；ComplexityProps 增 transitiveLoopDepth
```

- [x] 步骤 1：写失败测试 tests/graph-model.spec.ts 增 2 用例——EDGE_TYPES 含 SIMILAR、transitiveLoopDepth 入 ComplexityProps。
- [x] 步骤 2：实现 src/graph-model.ts：EDGE_TYPES 追加 'SIMILAR'；ComplexityProps.transitiveLoopDepth 字段。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认新旧测试通过后进入任务 2。

### 任务 2：TDD 红——语义/接缝/跨仓/环深契约测试

```ts
tests/semantic.spec.ts + lsp-seam.spec.ts + cross-repo.spec.ts + loop-depth.spec.ts  // 先红后绿
```

- [x] 步骤 1：写失败测试 tests/semantic.spec.ts（simhash 确定性、Hamming 距离、cosine、min-cosine、SIMILAR 归簇幂等无自环、阈值边界）。
- [x] 步骤 2：写失败测试 tests/lsp-seam.spec.ts（seam.enhance 命中产生 CALLS/USAGE 增强边、缺省 seam 退化为纯 tree-sitter 不变）。
- [x] 步骤 3：写失败测试 tests/cross-repo.spec.ts（双仓 fixture DB 产 CROSS_HTTP_CALLS/CROSS_ASYNC_CALLS/CROSS_CHANNEL 边、目标未命中跳过）。
- [x] 步骤 4：写失败测试 tests/loop-depth.spec.ts（a→b→c c.loopDepth=3 ⇒ a.transitive=3、环内保守取最大不无限递归、无 CALLS 边为 0）。

### 任务 3：simhash/Hamming/cosine + SIMILAR 边 + semanticQuery（T5.1 + T5.2）

```ts
simhash(text): bigint                          // 64 位：切词→32 位 FNV-1a→逐位投票
hammingDistance(a, b): number                  // popcount(a ^ b)
cosine(a, b): number                           // 点积/模，零向量记 0
semanticSimilarityEdges(store, project, options)   // 归一化名归簇→阈值内写 SIMILAR + similarTo 回填
semanticQuery(store, project, options)         // min-cosine 每节点得分→降序→分页 {rows,total,hasMore}
```

- [x] 步骤 1：写失败测试 tests/semantic.spec.ts 增 6 用例——simhash 确定性、hammingDistance 边界、cosine 零向量、min-cosine AND 语义、SIMILAR 归簇幂等无自环、threshold 阈值边界。
- [x] 步骤 2：实现 src/semantic.ts：simhash（切词/小写/FNV-1a/逐位投票 64 位）、hammingDistance（popcount）、cosine（TF 向量）、semanticSimilarityEdges（按 shortName/末段归簇，threshold 默认 3，PK 幂等）、semanticQuery（跳过 File/Folder/Variable/Project 噪声标签）。
- [x] 步骤 3：接入 src/query.ts：semanticQuery 与既有查询同构分页契约。
- [x] 步骤 4：跑 pnpm vitest run packages/plugins/codebase 确认任务 2 红用例转绿后进入任务 4。

### 任务 4：LspSeam 增强接缝（T5.3）

```ts
export interface LspSeam { readonly enhance?: (r: LspEnhanceRequest) => readonly EdgeMaterial[] }
export function augmentWithLsp(store, project, seam, options): EdgeMaterial[]
```

- [x] 步骤 1：写失败测试 tests/lsp-seam.spec.ts 增 3 用例——seam.enhance 命中产 CALLS/USAGE 增强边、insertEdges 幂等去重、缺省 seam 退化为纯 tree-sitter 不变。
- [x] 步骤 2：实现 src/lsp-seam.ts：LspEnhanceRequest/LspSeam 接口；augmentWithLsp 遍历 Function/Method，命中 enhance 并入 edges 结果，insertEdges 幂等；默认 seam 缺省退化不变。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认 lsp-seam 用例全绿。

### 任务 5：cross-repo 跨项目边（T5.4）

```ts
export interface SiblingProject { readonly name: string; readonly dbPath: string }
export function detectCrossProjectEdges(store, siblings, options): readonly EdgeRecord[]
```

- [x] 步骤 1：写失败测试 tests/cross-repo.spec.ts 增 3 用例——双仓 fixture DB 产 CROSS_HTTP_CALLS/CROSS_ASYNC_CALLS/CROSS_CHANNEL、目标未命中跳过、跨仓只读不写对方 DB。
- [x] 步骤 2：实现 src/cross-repo.ts：解析 crossHttpTargets/crossAsyncTargets/crossChannelTargets；命中 sibling 打开只读 CodebaseStore findNodeByQn；产 CROSS_*(本地id→sibling::qn)；跨仓只读不写对方。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认 cross-repo 用例全绿。

### 任务 6：transitive_loop_depth 传播（T5.5）

```ts
export function propagateLoopDepth(store, project): readonly NodeRecord[]   // DFS 后序 + 带环剪枝→回填 props.transitiveLoopDepth
```

- [x] 步骤 1：写失败测试 tests/loop-depth.spec.ts 增 3 用例——a→b→c c.loopDepth=3 ⇒ a.transitive=3、环内保守取最大不无限递归、无 CALLS 边为 0。
- [x] 步骤 2：实现 src/loop-depth.ts：edgesByType(['CALLS']) 邻接；DFS 后序 transitive=max(loopDepth, max callees)；环内取已算最大不无限递归；upsertNodes 幂等回填。
- [x] 步骤 3：跑 pnpm vitest run packages/plugins/codebase 确认 loop-depth 用例全绿。

### 任务 7：面接线（index/tools/cli）

```ts
src/index.ts 导出 semantic/lsp-seam/cross-repo/loop-depth
src/tools.ts  +semantic_query（只读）+ implementedTools 标记 T5.1-T5.5
src/cli/main.ts  +similar/+semantic-query/+lsp/+crossrepo/+loop-depth 子命令
```

- [x] 步骤 1：index.ts 全量导出；tools.ts 增 semantic_query 只读工具。
- [x] 步骤 2：cli/main.ts 增 5 子命令；cli.spec.ts 冒烟追加。
- [x] 步骤 3：跑全量 vitest + tsc + oxlint 全绿。

### 任务 8：真实仓库验证 + 文档收口

```sh
ff_codebase similar --repo .
ff_codebase semantic-query --repo . --keywords fn.a --keywords fn.b
ff_codebase crossrepo --repo . --siblings <file>
ff_codebase loop-depth --repo .
```

- [x] 步骤 1：对本仓库真实数据实测 5 子命令冒烟；测试源见 tests/{semantic,lsp-seam,cross-repo,loop-depth,graph-model}.spec.ts。
- [x] 步骤 2：写 docs/process/verifications/plugin-codebase-cb4.md + docs/process/reviews/plugin-codebase-cb4.md；ff_dev evidence 注册；推进 finish。