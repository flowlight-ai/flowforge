# plugin-codebase — EP-CB5 符号级搜索闭口（评审记录）

- 日期：2026-09-30
- 评审对象：`docs/process/specs/2026-09-28-plugin-codebase-cb5-design.md` + 实现
- 评审结论：✅ 通过

## 评审意见与处理

| 评审点 | 意见 | 处理 |
|---|---|---|
| 契约一致性 | `semanticQuery` 与 BM25 分处两处排除逻辑，易漂移 | 改为 `semanticQuery` 从 `BM25_NOISE_LABELS` 单源派生，消除双源 |
| 锚点可用性 | 设计时担心 search 结果可能不带 props | 核实 CLI emit 完整 `GraphNode`（props 天然透出），无需补列；以契约测试固化 |
| 兼容回归 | 改动可能破坏既有「Variable 不可命中」断言 | 审计确认仅 `graph-model.spec.ts` 一处锁定旧契约，已更新为 EP-CB5 正向契约；其余 File/Folder 排除用例不受影响 |
| 噪声边界 | 是否误伤 File/Folder/Module 语义 | 明确 File/Folder/Project 维持排除、Module 维持 prose 保留；有专门用例覆盖 |

## 门禁
- vitest 241/241 ✓、包级 tsc exit 0 ✓、oxlint 0 ✓
- 详见 `docs/process/verifications/plugin-codebase-cb5.md`