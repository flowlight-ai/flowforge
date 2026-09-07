# @flowforge/plugin-codebase EP-CB4 设计：语义层 + LSP 融合 + 跨仓库智能

- 批次：EP-CB4（`34-stage-ep-cb-plugin-codebase.md` §3 T5.1–T5.5）
- 裁决依据：review_code.md §15 Q14/Q15/Q16/Q17/Q18/Q19（全部已裁决）
- 优先级：降序承接 EP-CB3，不触碰既有 EP-CB0–CB3 契约

## 1. 目标

在 EP-CB3（Cypher 子集 + 增量索引 + 轨迹 + 工件）之上补齐语义智能面：

| ID | 能力 | C 源项目语义 | 落点 |
|---|---|---|---|
| T5.1 | SIMILAR 边 + simhash 相似度去重 | 函数/方法重复检测，长文件为 canonical，其余 SIMILAR 边 | `semantic.ts` |
| T5.2 | semantic_query 向量检索 | 数组关键词 per-keyword min-cosine 契约 | `semantic.ts` + `query.ts` |
| T5.3 | LSP 融合 | ctx.lsp 作为语义增强源，Hybrid LSP（不替代 tree-sitter 主链路） | `lsp-seam.ts` |
| T5.4 | cross-repo-intelligence | CROSS_HTTP_CALLS / CROSS_ASYNC_CALLS / CROSS_CHANNEL 跨项目边 | `cross-repo.ts` |
| T5.5 | transitive_loop_depth 传播 | 沿 CALLS 边传播最坏嵌套环深（环内取保守值） | `loop-depth.ts` |

## 2. 图模型变更

`graph-model.ts`：

- `EDGE_TYPES` 追加 `'SIMILAR'`（语义相似去重边，T5.1）。
- 既有 `CROSS_HTTP_CALLS` / `CROSS_ASYNC_CALLS` / `CROSS_CHANNEL` / `CALLS` / `USAGE` 沿用，进入 T5.4 写入面与 T5.5 遍历面。
- `ComplexityProps.loopDepth` 为传播源，`transitiveLoopDepth` 为传播目标（C 语义：最坏嵌套环深沿 CALLS 边传播，环内取被调者已算入的最大值，不无限递归）。

## 3. T5.1 simhash 相似度边

`simhash(text): bigint`（64 位）：

1. 文本按 `[\s_.:/\\-]+` 切词，小写化；对每个 token 计算 32 位 FNV-1a 哈希（无符号）。
2. 逐位投票：哈希位为 1 则该位 +1，为 0 则 -1；整段累加后，符号为正的位记为 1，否则 0，拼成 64 位大整数。

`hammingDistance(a, b): number`：`(a ^ b).toString(2).replace(/0/g, '').length` 的等价位与运算实现 `popcount(a ^ b)`。

`semanticSimilarityEdges(store, project, options)`：遍历 Function/Method 符号节点：

- 归簇：以归一化名（`props.shortName` 或 `name` 末段）为桶，同簇两两计算 `hammingDistance`；
- `options.threshold`（默认 3）：距离 ≤ 阈值则写入 `SIMILAR` 边（去重边），并以 `props.similarTo` 回填 canonical id；
- 契约：不产生自环；同源相同文本必须产生 SIMILAR 边（幂等，PK 去重）。

## 4. T5.2 semantic_query 向量检索

契约（C 源 `search_graph` 语义）：输入 `keywords: string[]`，每个节点构造特征向量，逐关键词计算 cosine，**每节点得分 = 各关键词 cosine 的最小值**（min-cosine，AND 语义），降序返回。

- 特征表示：`tokens/node` — 以符号名切词 + `props.docstring`/`props.signature` 切词得到的词频（TF）向量；
- `cosine(a, b)`：点积 / (|a|·|b|)，零向量与零向量记 0；
- `semanticQuery(store, project, options)`：跳过 BM25 噪声标签（File/Folder/Variable/Project），仅对符号节点检索；返回 `{ rows, total, hasMore }` 分页契约，与 `query.ts` 其他查询同构。

## 5. T5.3 LSP 融合接缝

`LspSeam` 为**可选增强源**（Q15：ctx.lsp 不替代 tree-sitter 主链路）：

```ts
export interface LspEnhanceRequest {
  readonly project: string
  readonly filePath?: string
  readonly language?: string
  readonly nodeId: string
  readonly nodeName: string
}
export interface LspSeam {
  /** 返回增量边（type 限 CALLS / USAGE / IMPLEMENTS）；不实现则走纯 tree-sitter。 */
  readonly enhance?: (request: LspEnhanceRequest) => readonly EdgeMaterial[]
}
export function augmentWithLsp(store, project, seam, options): EdgeMaterial[]
```

- 遍历 Function/Method 节点，命中 `seam.enhance` 的调用并入 `edges.ts` 提取结果，`insertEdges` 幂等去重；
- 默认 seam 为 `undefined` 即退化为现状（无增强），保证未接入 ctx.lsp 的宿主行为不变。

## 6. T5.4 cross-repo-intelligence

跨仓库目录（Q16 集中注册表形态开放接口，不绑定文件路径）：

```ts
export interface SiblingProject { readonly name: string; readonly dbPath: string }
export interface CrossRepoResult {
  readonly project: string
  readonly coherent: number            // 本仓已解析（默认全解析）
  readonly contributions: readonly EdgeRecord[]   // 跨库 CROSS_* 边
}
export function detectCrossProjectEdges(store, siblings, options): readonly EdgeRecord[]
```

- 各符号节点可携带 `props.crossHttpTargets`（`sibling::qn` 逗号分隔，或单值）；遍历本地节点，对每个目标：
  - 命中 `siblings` 中同名仓库则打开其 `dbPath` 上的只读 `CodebaseStore`，`findNodeByQn` 解析目标；
  - 成功则产边 `source=本地节点id, target=<siblingName>::<qn>, type=CROSS_HTTP_CALLS`（另两种由 `crossAsyncTargets` / `crossChannelTargets` 驱动，映射 CROSS_ASYNC_CALLS / CROSS_CHANNEL）；
- 边落**本仓** edge 表（target 用命名空间 id，跨仓只读打开不写入对方）。

## 7. T5.5 transitive_loop_depth 传播

沿 CALLS 边传播 `loopDepth`：

1. 建 CALLS 邻接（`store.edgesByType(project, ['CALLS'])`）；
2. DFS 后序 / 带环剪枝：`transitiveLoopDepth(node) = max(loopDepth(node), max over callees(transitiveLoopDepth(callee)))`；
3. 环内节点用「可达被调者已算最大值」而非无限递归（C 保守语义）；
4. 产出 `Map<string, number>`（nodeId → transitive），返回同时回填 `props.transitiveLoopDepth` 的 `NodeRecord[]`（`upsertNodes` 幂等）。

## 8. 面接线

- `index.ts`：导出 `semantic.ts` / `lsp-seam.ts` / `cross-repo.ts` / `loop-depth.ts` 的全部函数与类型。
- `tools.ts`：新增只读工具 `semantic_query`（T5.2）；实施工具清单 `implementedTools` 标记 T5.1–T5.5（SIMILAR 构建/增强/跨仓/传播为 CLI 侧批处理）。
- `cli/main.ts`：新增子命令 `similar`（T5.1）/ `semantic-query`（T5.2）/ `lsp`（T5.3）/ `crossrepo`（T5.4）/ `loop-depth`（T5.5）。

## 9. 验收（继承 EP-CB0 §5 + EP-CB3）

1. `ff_codebase similar --repo .` 对微仓库产出 SIMILAR 边且幂等；
2. `ff_codebase semantic-query --keywords fn.a --keywords fn.b` 返回 min-cosine 排序分页契约；
3. LSP 接缝在提供 seam 时增强 CALLS/USAGE，缺省行为不变；
4. `ff_codebase crossrepo --siblings …` 对双子仓库 DB 产 CROSS_HTTP_CALLS 边；
5. `loop-depth` 对 a→b→c（c.loopDepth=3）产出 a.transitive=3；
6. vitest 新增 ≥7 契约测试全绿；包级 tsc exit 0；oxlint 0 告警；
7. 走 plugin-dev 七阶段（实例 + 四产物 + mgr PR）。

## 10. 冲突裁决

- T1（禁止 Mock LLM/文件系统/sqlite）优先：存储与邻接一律真实 `node:sqlite` + 临时目录 fixture；`LspSeam`/`siblings` 用真实普通对象注入（属于增强源，非存储 Mock）。
- 我方文档分层（11/12）优先：本设计已合入 `docs/process/specs/`，不遗留至正式 spec.md。