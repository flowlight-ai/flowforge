# plugin-codebase — EP-CB5 符号级搜索闭口（方案设计）

- 日期：2026-09-28
- 决策点：Q21（`docs/refactor/review_code.md` §15）
- 总计划：`docs/process/plans/2026-09-28-plugin-codebase-cb5.md`
- 代码落点：`packages/plugins/codebase`

---

## 1. 问题陈述

EP-CB1 的 tree-sitter 管线已将 **Variable** 铸成符号标签并写入 node 表 + FTS5 索引（[symbols.ts](file:///d:/software/fl/flowlight/flowforge/packages/plugins/codebase/src/symbols.ts) `extractJsVars`/`extractEnumMembers`/`extractDestructuredVars` 产出的 Variable 节点均带 `shortName`/`startLine`/`endLine` props）。

但检索侧仍把 Variable 当**结构噪声**排除，形成「抽取了却搜不到」的不一致：

| 检索面 | 位置 | 现状 | 后果 |
|---|---|---|---|
| BM25 / 结构化 search | `graph-model.ts BM25_NOISE_LABELS` | 含 `Variable` | `search_graph` / `ff_codebase search` / `ff_codebase query` 命中不了 Variable |
| 语义检索 | `semantic.ts semanticQuery` L199 | 硬编码 `!== 'Variable'` | `semantic_query` 命中不了 Variable |

对照：Function/Method/Class/Interface/Enum/Type 全部可检索，唯独 Variable 例外。同时 `semanticQuery` 用硬编码字符串而非单一排除集来源，存在随 `BM25_NOISE_LABELS` 漂移的风险。

## 2. 目标（非目标）

### 目标
1. 全部符号标签（Function/Method/Class/Interface/Enum/Type/Variable）均可被符号级检索。
2. 检索结果携带定义锚点（`shortName` / `startLine` / `endLine`），支持「搜到 → 定位到定义」。
3. File/Folder/Project 仍为结构噪声排除；Module 维持 prose 保留（C #518/#519）。
4. 单一排除集来源：`semanticQuery` 改从 `BM25_NOISE_LABELS` 派生，杜绝硬编码漂移。

### 非目标
- 不新增符号抽取标签（Field/Route 等）。
- 不改 schema DDL（FTS 已含 Variable name，无需迁移）。
- 不改 Cypher/watcher/artifact 等其它域。
- 不引入新依赖。

## 3. 方案

### 3.1 graph-model.ts —— 排除集收敛
`BM25_NOISE_LABELS` 从 `['File', 'Folder', 'Variable', 'Project']` 改为 `['File', 'Folder', 'Project']`。

保持注释说明：Variable 已由 EP-CB1 提升为符号标签，不再视为噪声；File/Folder/Project 仍是结构框（不可用简短名/签名/docstring 语义检索，排除合理）。Module 保留（承载 prose）。

### 3.2 semantic.ts —— 单一排除集来源
`semanticQuery` 的节点过滤条件由硬编码条件改为基于 `BM25_NOISE_LABELS`（导入自 graph-model）判定：

```ts
// 现在
node.label !== 'File' && node.label !== 'Folder' && node.label !== 'Variable' && node.label !== 'Project'
// 改为
!(BM25_NOISE_LABELS as readonly string[]).includes(node.label)
```

语义不变（NodeLabel 全为字符串），消除双源漂移。同步更新 docstring 注释。

### 3.3 store.ts —— 无需改动（锚点已透出）
`store.search` 返回的 `GraphNode.props` 已含 `shortName`/`startLine`/`endLine`（symbols.ts `mintSymbol` 写入）。`semanticQuery` 返回相同 `GraphNode`。CLI `search`/`semantic-query` 直接 emit 完整节点，锚点天然可达，无需补列。

> 结论：**锚点能力已就位，EP-CB5 不为此新增字段或展示改动**，仅以契约测试固化「检索结果带定义锚点」这一行为。

### 3.4 契约测试
- **`query.spec.ts` / `search.spec.ts`**：BM25 `query` 命中 Variable（枚举成员名、模块 `const` 变量名）；`label: 'Variable'` 结构化过滤可命中；File/Folder/Project 仍不可从 BM25/logic 检索命中。
- **`semantic.spec.ts`**：新增 `semantic_query` 命中 Variable docstring/signature 用例。
- **CLI 冒烟**（verification）：`ff_codebase search` 对真实或 fixture 仓库命中 Variable，且结果 props 含 startLine。

## 4. 兼容性与回归风险
- **低**。改动为两处排除集收敛 + 单源化。
- 若既有测试断言「Variable 不可命中」，先审计：这是 EP-CB5 要推翻的旧契约，应改为正向断言（命中），并在本设计/评审中明示。

## 5. 验收清单
- [ ] `BM25_NOISE_LABELS` = `['File', 'Folder', 'Project']`；`semanticQuery` 用该集派生排除。
- [ ] BM25 search 与 `semantic_query` 均可命中 Variable。
- [ ] 检索结果 props 含 `shortName`/`startLine`/`endLine`（锚点，测试断言）。
- [ ] File/Folder/Project 仍不可命中；Module 仍可命中。
- [ ] 全量 vitest（239+新增）通过、包级 tsc exit 0、oxlint 0、`ff_doctor` 通过。
- [ ] `docs/process/verifications/plugin-codebase-cb5.md` 写入新鲜验证证据。
- [ ] mgr 提交 PR（commit 格式合规）。