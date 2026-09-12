# review: EP-CB1 符号级抽取管线 @flowforge/plugin-codebase

> 实例：`plugin-codebase-cb1`（feature 工作流）｜ 规格：`docs/process/specs/2026-09-07-plugin-codebase-cb1-design.md` ｜ 计划：`docs/process/plans/2026-09-07-plugin-codebase-cb1.md`

## 审查范围

EP-CB0 结构层之上的 tree-sitter 符号级抽取：web-tree-sitter（TS/TSX/JS）解析 + 符号节点（Function/Method/Class/Interface/Enum/Type/Variable + 复杂度属性族）+ 五级边解析链（DEFINES/DEFINES_METHOD/CALLS/USAGE/INHERITS/IMPLEMENTS）+ get_file_outline/get_code_snippet 工具与 CLI + parse_partial 覆盖率上报；本仓库全量索引验收。

## 规格合规（spec 核对）

- **五模块落地**：parser（WASM 预加载单例）/ symbols / complexity / edges / outline，indexer 两遍集成（聚合→注册表→边解析），RAM-first 不变 ✅
- **QN 契约**：`computeQualifiedName` 按 QN 段拼接，index 主干跳过、点段剥离（store.spec 覆盖）✅
- **边语义勘误**：文件→符号按 C 语义为 **DEFINES**（34-stage T2.3 原文 CONTAINS_FILE 为笔误，属 Folder→File 结构边）；DELETES METHOD/CALLS/INHERITS/IMPLEMENTS 齐备 ✅
- **框架零改动约束**：仅新增 parser/symbols/complexity/edges/outline 及 CLI 子命令；索引不变量 `coverage.parsePartial` 由常量空数组升级为真实上报 ✅
- **测试真实语料**：mini-repo/symbols/demo.ts + broken.ts，无 Mock parser/sqlite ✅

## 代码质量（契约测试审查）

- 239 契约测试全绿（29 files），含 EP-CB1 符号层断言：Function/Class/Interface/Enum/Type/Variable 计数、DEFINES/DEFINES_METHOD/CALLS/INHERITS/IMPLEMENTS 边、parse_partial、cli outline/snippet 冒烟 ✅
- 全量测试连续两次运行一致（确定性落盘，无 flaky）✅
- tsc --noEmit exit 0 ✅

## 本仓库验收（T2.5 实测）

- 全量索引 exit 0：6575 文件 / 41072 符号 / 161175 边，duration ≈ 15.3 分钟；parse_partial 如实上报 100+ 语法损坏文件（.d.ts / typert 测试临时镜像目录 / vendor/cordis 装饰器语法）✅
- 符号级 BM25 search total=2074 且 props 含复杂度属性族 ✅
- outline/snippet 对 store.ts 冒烟 exit 0，返回真实切片 + ±5 邻域（勘误：`upsertNodes` 为 `...store.CodebaseStore.upsertNodes`）✅

## 关键处置（经验记录）

1. **计划示例 QN 缺类段**：plan 示例 `...store.upsertNodes` 实际为 `...store.CodebaseStore.upsertNodes`（方法挂类下）；验证时以 store.ts 实际 outline 校准。
2. **全仓 parse_partial 诚实上报**：大型仓库中装饰器/`.d.ts`/生成代码大量触发 ERROR/MISSING——覆盖上报如实标记而非静默丢弃，符合诚实契约。

## 验收结论

全部通过。EP-CB1 符号级抽取管线可接受，EP-CB0 57 测试零回归扩展至 239 全绿。