# plugin-codebase — EP-CB5 符号级搜索闭口（总体计划）

- 日期：2026-09-28
- 隶属：EP-CB 系列（@flowforge/plugin-codebase，高优先级，operator 2026-09-07 第二指令）
- 前置：EP-CB0/1/2/3/4 全部 ✅ 已交付（见 `docs/refactor/review_code.md` §13.0）
- 决策点：Q21（见 `docs/refactor/review_code.md` §15）
- 流程：docs-first（review_code.md → plan → design → 评审 → 实现 → 门禁 → mgr 提交）

---

## 1. 背景与问题

EP-CB1 已通过 tree-sitter 管线把 **Variable** 铸成合法符号标签（枚举成员、模块级 `const`/`let`/`var` 变量、解构绑定），并写入 node 表 + FTS5 索引。

但检索侧存在一致性缺口：**Variable 仍被当作结构噪声排除出检索结果**。

- `src/graph-model.ts` 的 `BM25_NOISE_LABELS = ['File', 'Folder', 'Variable', 'Project']` → `store.search` 的 BM25/结构化查询对 Variable 不可命中；
- `src/semantic.ts` 的 `semanticQuery` 也硬编码排除 `'Variable'` → 语义检索同不可命中。

后果：符号被「抽取了却搜不到」，与 memory 硬约束「@flowforge/plugin-codebase must exclude File/Folder/Variable/Project tags from search results（符号级搜索寄 EP-CB1）」中 EP-CB1 的符号级兑现矛盾。Function/Method/Class/Interface/Enum/Type 均可检索，唯独 Variable 例外，形成契约不一致。

## 2. 目标（EP-CB5）

将 **Variable** 纳入符号级检索，使**全部符号标签**（Function/Method/Class/Interface/Enum/Type/Variable）可被检索并定位到定义，达成真正闭环的符号级搜索。

### 2.1 验收可测结果
1. `ff_codebase search` / `search_graph`（BM25 + 结构化）可命中 Variable 节点（枚举成员、模块 const 等）。
2. `semantic_query` 可检索 Variable 节点（docstring/signature 语义命中）。
3. 符号搜索结果附带**定义锚点**（`shortName` / `startLine` / `endLine`，来自节点 props），形成「搜到 → 定位到定义」闭环。
4. File/Folder/Project 仍为结构噪声排除检索；Module 维持 prose 保留（C #518/#519）。
5. 契约测试锁定（原有 239 + EP-CB5 新增），vitest / tsc / oxlint / ff_doctor 全绿。

## 3. 交付物

| # | 产物 | 落点 | 状态 |
|---|---|---|---|
| 1 | review_code.md 登记（§13.0 / §15 Q21 / §16） | `docs/refactor/review_code.md` | ✅ 本次完成 |
| 2 | 总体计划 | `docs/process/plans/2026-09-28-plugin-codebase-cb5.md` | ✅ 本次完成 |
| 3 | 方案设计 | `docs/process/specs/2026-09-28-plugin-codebase-cb5-design.md` | ⏳ 下一步 |
| 4 | 评审记录 | `docs/process/reviews/2026-09-28-plugin-codebase-cb5.md` | 待评审 |
| 5 | 实现 + 契约测试 | `packages/plugins/codebase/src/{graph-model,store,semantic}.ts` + `tests/` | 评审后 |
| 6 | 验证证据 | `docs/process/verifications/plugin-codebase-cb5.md` | 实现后 |

## 4. 阶段划分（批次）

### 批次 T5.0 — 核心检索闭口（单批）
改动点最小且正交，一次完成：
1. **`graph-model.ts`**：`BM25_NOISE_LABELS` 移除 `Variable` → `['File', 'Folder', 'Project']`。
2. **`semantic.ts`**：`semanticQuery` 排除集移除 `'Variable'`，改用 `BM25_NOISE_LABELS` 单一来源（避免两处硬编码漂移）。
3. **定义锚点**：确认 `store.search` / `semanticQuery` 返回的 `GraphNode.props` 已含 `shortName/startLine/endLine`（symbols.ts mintSymbol 已写入）；CLI `search` 展示层补列 `shortName` + `startLine`（锚点可读）。
4. **契约测试**：
   - `search.spec.ts` / `query.spec.ts`：BM25 + label 过滤命中 Variable（枚举成员、模块 const），且 File/Folder/Project 仍不可命中；
   - `semantic.spec.ts`：`semantic_query` 命中 Variable；
   - CLI `search` 冒烟：符号结果含 shortName/startLine 锚点列。

### 批次 T5.1 — 门禁与提交
- 全量 vitest 239+、包级 tsc exit 0、oxlint 0、`ff_doctor` 通过。
- `docs/process/verifications/plugin-codebase-cb5.md` 记录新鲜验证证据。
- mgr 提交（PR，commit 格式 `type(scope): desc [sherlock]`）。

## 5. 边界（明确不做）
- 不扩展符号抽取（Variable 之上不加 Field/Route 等新标签抽取）。
- 不改 Cypher/watcher/artifact 等其它域。
- 不引入新依赖、不改 schema DDL（FTS 已含 Variable name）。

## 6. 风险
- **低**：改动集中在两处排除集 + 展示层，816 索引已含 Variable，无需重索引 schema。
- 既有测试若锁定「Variable 不可命中」需改为「可命中」——先审计现有断言再改。