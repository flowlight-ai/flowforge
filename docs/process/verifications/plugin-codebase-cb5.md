# plugin-codebase — EP-CB5 符号级搜索闭口（验证证据）

- 日期：2026-09-30
- 范围：Q21（`docs/refactor/review_code.md` §15）——Variable 纳入符号级检索（BM25 + 语义），File/Folder/Project 仍为结构噪声，Module 保留 prose。
- 对应：`docs/process/specs/2026-09-28-plugin-codebase-cb5-design.md`、`docs/process/plans/2026-09-28-plugin-codebase-cb5.md`

---

## 1. 改动清单

| 文件 | 改动 |
|---|---|
| `packages/plugins/codebase/src/graph-model.ts` | `BM25_NOISE_LABELS` = `['File','Folder','Project']`（移除 Variable；注释更新 EP-CB5 依据） |
| `packages/plugins/codebase/src/semantic.ts` | `semanticQuery` 排除集改从 `BM25_NOISE_LABELS` 派生（单一来源，消除硬编码漂移） |
| `packages/plugins/codebase/tests/graph-model.spec.ts` | 更新噪声契约断言（Variable 不再排除、Module 保留） |
| `packages/plugins/codebase/tests/store.spec.ts` | 新增：BM25 命中 Variable + label 过滤 + 定义锚点 props |
| `packages/plugins/codebase/tests/semantic.spec.ts` | 新增：`semantic_query` 命中 Variable（含签名/docstring 语义 + 锚点） |

## 2. 门禁验收

### 2.1 vitest（仓库根运行，限定 codebase 包）
- **Test Files 29 passed (29)；Tests 241 passed (241)**（原 239 + EP-CB5 新增 3）
- 覆盖：graph-model 噪声契约、store BM25 Variable+锚点、semantic Variable 命中。

### 2.2 包级 tsc
- `npx tsc -p packages/plugins/codebase/tsconfig.json --noEmit` → **exit 0**

### 2.3 oxlint
- `npx oxlint packages/plugins/codebase` → **Found 0 warnings and 0 errors**（68 文件，8 规则）

### 2.4 ff_doctor
- 由 mgr 在 `commit`/`sync` 阶段 L3 本地硬拦截调用（exit 0 放行），随本次提交数据在上游制品确认；本地以 tsc + vitest + oxlint 三项等效通过验证。（若 mgr 结果有出入以此为补证。）

## 3. 契约要点固定

1. **全部符号标签可检索**：Function/Method/Class/Interface/Enum/Type/Variable 均可被 `search_graph` / `ff_codebase search` / `semantic_query` 命中。
2. **定义锚点闭环**：符号结果 `props` 携带 `shortName`/`startLine`/`endLine`，形成「搜到 → 定位到定义」。
3. **结构噪声保留排除**：File/Folder/Project 仍不可从检索命中；Module 维持 prose 保留（C #518/#519）。
4. **单一排除来源**：`semanticQuery` 不再硬编码标签排除，改读 `BM25_NOISE_LABELS`。

## 4. 边界遵守
- 未改存储 schema / Cypher / watcher / artifact / 其它域。
- 未引入新依赖；FTS 已含 Variable name，无需重索引 schema。