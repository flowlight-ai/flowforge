# EP-CB4 实施计划：语义层 + LSP 融合 + 跨仓库智能

- 依据：`docs/process/specs/2026-09-07-plugin-codebase-cb4-design.md`
- 批次目标：T5.1–T5.5 全部落地，vitest/tsc/oxlint 全绿，mgr PR。
- 遵循：我方测试铁律 T1–T9（真实 sqlite + 临时目录 fixture，禁止 Mock 存储/文件系统）。

## 步骤与门禁

| # | 步骤 | 产物 | 门禁 |
|---|---|---|---|
| 1 | 图模型：EDGE_TYPES 追加 SIMILAR | `src/graph-model.ts` | tsc |
| 2 | TDD 红：编写语义层/向量/接缝/跨仓/环深契约测试 | `tests/semantic.spec.ts`、`tests/cross-repo.spec.ts`、`tests/loop-depth.spec.ts`、`tests/lsp-seam.spec.ts` | vitest 红 |
| 3 | T5.1+T5.2：simhash/Hamming/cosine/min-cosine + SIMILAR 边 + semanticQuery | `src/semantic.ts`、`src/query.ts` | vitest 绿 |
| 4 | T5.3：LspSeam + augmentWithLsp | `src/lsp-seam.ts` | vitest 绿 |
| 5 | T5.4：SiblingProject + detectCrossProjectEdges | `src/cross-repo.ts` | vitest 绿 |
| 6 | T5.5：transitive_loop_depth 传播 | `src/loop-depth.ts` | vitest 绿 |
| 7 | 面接线：index.ts 导出 + tools.ts 工具 + cli/main.ts 子命令 | `src/index.ts`、`src/tools.ts`、`src/cli/main.ts` | vitest/tsc |
| 8 | 全量核验 + oxlint | 全包 | vitest/tsc/oxlint 全绿 |
| 9 | mgr sync 提交 PR + review_code §13 登记 | PR | mgr 通过 |

## 文件清单

- 改：`graph-model.ts`、`query.ts`、`index.ts`、`tools.ts`、`cli/main.ts`
- 新增：`semantic.ts`、`lsp-seam.ts`、`cross-repo.ts`、`loop-depth.ts`
- 测试：`semantic.spec.ts`、`lsp-seam.spec.ts`、`cross-repo.spec.ts`、`loop-depth.spec.ts`、`cli.spec.ts`（冒烟追加）

## 验收

- ≥7 新增契约测试，全套（含 EP-CB0–3）回归全绿；
- 包级 `tsc -p tsconfig.json --noEmit` exit 0；
- `oxlint` 0 error / 0 warning；
- 走 plugin-dev 七阶段，经 `mgr.ps1 sync` 提交（类型 feat，scope codebase，署名）。