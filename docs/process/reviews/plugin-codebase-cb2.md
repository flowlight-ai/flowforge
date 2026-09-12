# review: EP-CB2 工具面补全 + 文档生成器 @flowforge/plugin-codebase

> 实例：`plugin-codebase-cb2`（feature）｜ 规格：`docs/process/specs/2026-09-07-plugin-codebase-cb2-design.md` ｜ 计划：`docs/process/plans/2026-09-07-plugin-codebase-cb2.md`

## 审查范围

7 个 P0 工具（trace_path/search_code/get_architecture/check_index_coverage/detect_changes/compare_graphs/manage_adr）+ 文档生成器（dev 供料闭环）+ MCP 装配（对齐 tool-lsp），CLI 增 trace/arch/coverage/changes/compare/adr 子命令。

## 规格合规（spec 核对）

- **trace_path**：CALLS/USAGE/INHERITS/IMPLEMENTS 载体边邻接，callers 反向 / callees 正向 BFS，visited 防环 + max_depth 截断，深度升序+同深字典序确定性 ✅
- **search_code**：磁盘原文行级检索（非索引），file_pattern 过滤 + maxFiles 截断 `truncated` 诚实标记，正则编译失败→UsageError ✅
- **get_architecture**：模块边界（File→模块推导）+ 跨模块 CALLS/IMPORTS 依赖矩阵 + 热点文件按 degree/complexity 排序 ✅
- **coverage/changes/compare**：三态并列 + absentFiles 诚实上报；mtime 对比 last_indexed_at；快照差集 identical 契约 ✅
- **manage_adr / docgen**：`# ADR-N:` 编号递增 + docs/decisions/ 对接；docgen 骨架仅结构头、No-Placeholder 纪律（不产假内容）✅
- **MCP 装配**：mountCodebaseTools 对齐 tool-lsp 形状，只读工具面，零 cordis 依赖 ✅
- **框架零/只读消费**：trace/search/arch 只读消费现有 store 查询面，不触碰写路径 ✅

## 代码质量（契约测试审查）

- 239 契约测试全绿（29 files），含 EP-CB2 全部 9 个新模块 + cli 冒烟；EP-CB1 108 用例零回归 ✅
- 确定性输出（trace/arch 排序稳定），无 flaky；tsc --noEmit exit 0；oxlint 0 warnings ✅

## 本仓库验收（T3.5 实测）

- trace：BFS 11 路径（USAGE/CALLS via，depth1/2）exit 0
- arch：moduleCount=80（depth1），跨模块依赖矩阵 + hotFiles Top10（index.d.ts degree 1098）exit 0
- coverage：nodeCount=45721/edgeCount=156072/symbolCount=37456 + excluded/absentFiles 诚实并列 exit 0
- changes：lastIndexedAt 基线 mtime 比对（changed=1/added=4/removed=0）exit 0
- docgen：spec 骨架 8 sections（含结构占位，无假内容）落地 outPath exit 0

## 关键处置（经验记录）

1. **计划校验从表格化转结构强化**：EP-CB2 计划初版为"步骤 + 勾选"文本，gate plan 触发 TASK_NO_CODE/TASK_NO_TEST/PLACEHOLDER 三类违规；按 cb1 先例为每任务补 ````ts`` 代码块 + 测试文件引用、消除独立 TODO/TBD 占位词后 7/7 通过。
2. **docgen 占位纪律**：骨架 §5-7 用 HTML 注释占位而非 TBD 假文本，兼顾 No-Placeholder 校验与可读性。
3. **coverage 与 index 计数差异**：coverage 命令读取当前 DB 实时三态计数，与索引期瞬时快照不同属正常（示诚实）。

## 验收结论

全部通过。EP-CB2 工具面补全 + 文档生成器 + MCP 装配可接受，EP-CB0/1 零回归扩至 239 全绿。