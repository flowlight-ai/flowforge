# review: EP-CB4 语义层 + LSP 融合 + 跨仓库智能 @flowforge/plugin-codebase

> 实例：`plugin-codebase-cb4`（feature）｜ 规格：`docs/process/specs/2026-09-07-plugin-codebase-cb4-design.md` ｜ 计划：`docs/process/plans/2026-09-07-plugin-codebase-cb4.md`

## 审查范围

SIMILAR 相似度边 + simhash 去重（T5.1）、semantic_query min-cosine 向量检索（T5.2）、LspSeam 增强接缝（T5.3）、cross-repo 跨项目边（T5.4）、transitive_loop_depth 传播（T5.5）；CLI 增 5 子命令（similar/semantic-query/lsp/crossrepo/loop-depth）。

## 规格合规（spec 核对）

- **T5.1 SIMILAR 边**：simhash 64 位（`[\s_.:/\\-]+` 切词 + 小写 + 32 位 FNV-1a 逐位投票）、hammingDistance popcount、按归一化名归簇 + threshold 默认 3 写 SIMILAR + similarTo 回填；PK 幂等无自环 ✅
- **T5.2 semantic_query**：跳过 File/Folder/Variable/Project 噪声，仅符号节点；每节点得分 = 各关键词 cosine 最小值（min-cosine AND 语义）降序；`{rows,total,hasMore}` 与 query.ts 同构分页 ✅
- **T5.3 LSP 接缝**：`LspSeam.enhance` 为可选增强源；命中并入 edges 结果 insertEdges 幂等；缺省 seam 退化纯 tree-sitter 不变（Q15 Hybrid）✅
- **T5.4 cross-repo**：SiblingProject 集中注册表形态；跨仓只读打开 findNodeByQn；产 `CROSS_HTTP_CALLS`/`CROSS_ASYNC_CALLS`/`CROSS_CHANNEL`（本地 id→`<sibling>::<qn>`），未命中/畸形目标诚实跳过 ✅
- **T5.5 transitive_loop_depth**：沿 CALLS 边 DFS 后序 `transitive=max(loopDepth, max callees)`；环内保守取最大不无限递归；upsertNodes 幂等回填 ✅
- **契约**：纯只读查询面（semantic/lsp/crossrepo/loop-depth 仅写新增边/回填 필드，不破坏既有 EP-CB0-3 存储）；退出码 0/1/2；零外部运行时依赖（simhash/cosine 纯原生 bitset 与数组）✅

## 代码质量（契约测试审查）

- CB4 模块单测全绿：semantic 6 / lsp-seam 3 / loop-depth 4 / cross-repo 3 / graph-model 追加，真实临时目录 DB + 真实 fixture 零 Mock ✅
- { 全量回归 239 用例（29 文件，含 EP-CB0-3 既有用例零回归）+ 包级 `tsc --noEmit` exit 0 + `oxlint` 0 warnings/0 errors } ✅

## 本仓库验收（实测）

- **similar**：本仓真实数据遍历 Function/Method 产 SIMILAR 边（`LocalJobRegistry.start→StubJobRegistry.start` 等），exit 0
- **semantic-query**：`--keywords store,index` 返回 `rows=5/total=13/hasMore=true`，min-cosine 排序分页契约正确，exit 0
- **lsp**：seam 注入命中 `CodebaseStore.open` 并入 CALLS 增强边；缺省无 seam 返回 `edges=[]` 退化，exit 0
- **crossrepo**：双仓 fixture 产 `CROSS_HTTP_CALLS`（`fn:gateway→siblingA::pkg.http.Client`），未命中 QN 诚实跳过，exit 0
- **loop-depth**：a→b→c（c.loopDepth=3）传播 `a/b/c.transitive=3`；本仓 loopDepth 全 0 诚实返回 `updated=0`，exit 0

## 关键处置（经验记录）

1. **plan 校验结构强化延续**：cb4 计划初版沿用 CB3 之前更简化的表格格式，触发 MISSING_HEADER/NO_TASKS/TASK_NO_TEST×多 违规；按 CB3 规范格式重写（目标/架构/技术栈/规格/全局约束 + `### 任务 N` + 每任务含 code 块 + 显式 `写失败测试` 步骤行）后 plan 门禁 8/8 通过——固定流程模式确立。
2. **crossrepo CLI 实测需显式 --db**：CLI 默认 DB 路径为 `<repo>/.flowforge/codebase.db`，fixture 用独立 `codebase.db`，实测时须传 `--db`；CLI 的 project 名 = `--project`（fixture 为 repoA/demo）。文档/命令须匹配真实 CLI 签名。
3. **lsp 增强边 type 由 seam 自治**：seam.enhance 返回的 EdgeMaterial 自含 type（CALLS/USAGE），CLI 原样并入 insertEdges 幂等去重；缺省 seam 返回空边集退化——无需改写主链路。
4. **loop-depth 诚实 updated=0**：本仓经 tree-sitter 抽取的符号 loopDepth 均为 0（无嵌套循环标注），CLI 诚实返回 `updated=0` 而非编造；非零传播语义由 spec(5 用例) 锁定的 a→b→c 模式 + fixture CLI 实测证明。

## 验收结论

全部通过。EP-CB4 语义层（SIMILAR/min-cosine 检索）+ LSP 接缝 + 跨仓库 + 环深传播可接受，EP-CB0/1/2/3 零回归；至此 EP-CB 全链路（结构/符号/查询/工具/增量/语义/LSP/跨仓）完整可用。