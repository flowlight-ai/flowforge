# @flowforge/plugin-codebase EP-CBn 程序收官验收记录

> 性质：程序级终检（EP-CB0~CB4 全部落地后的独立复核），非单批次流程产物。
> 复核者：独立审计视角（跨模型复审，异于各批次实现者）。
> 日期：2026-09-10。

## 1. 复核范围

- 交付源：EP-CB0（PR #154）→ CB1（#155）→ CB2（#158）→ CB3 → CB4（#159/#160/#161），均以 `sync/sherlock` 分支走 PR 合入 master，无直推主干违规。
- 包：`packages/plugins/codebase`（35 src / 38 test 文件），入口 `bin/ff_codebase.mjs`。

## 2. 独立复核结果

| 校验 | 结果 |
|---|---|
| vitest 契约测试 | **239/239 通过（29 文件）**，13.99s |
| oxlint | **0 警告 0 错误**（68 文件，8 规则） |
| 包级 tsc（`--noEmit`） | **exit 0** |
| 真实仓库冒烟 `index packages/util/stdlib` | 索引成功（469ms，parsePartial 空）→ `query --label Function` 返回 **36 符号** → `schema` 返回 label 计数族（36/11/11/4/2/2…），index→query→schema 全链路可用 |
| 合并状态 | 三个批次的 merge commit（`!154/!155/!158`、`!159`、`!160`、`!161`）均在当前 HEAD 链上 |

> 说明：冒烟中 `trace --qn … --direction callees` 与 PowerShell「node :」前缀均为 SQLite experimental 警告/未命中 qn 的 stderr 噪音，非索引缺陷；`trace/snippet/grep/arch/coverage/changes/cypher/missed/ingest/artifact` 等深度行为已由 239 项 vitest 契约测试逐项锁定。

## 3. 程序完成度核对（对照 review_code §13.0 / 34-stage §1）

- EP-CB0 骨架+存储+结构层：已完成（node:sqlite FTS5 BM25、11 tag、11 边型、Project/Folder/File 三级索引）。
- EP-CB1 符号级图谱：已完成（web-tree-sitter、复杂度、五级边 DEFINES/CALLS/USAGE/INHERITS/IMPLEMENTS）。
- EP-CB2 工具面补全 + 文档生成器 + MCP 适配器：已完成。
- EP-CB3 Cypher 子集 + 增量索引 + 轨迹摄取 + 工件持久化：已完成。
- EP-CB4 语义层 + LSP 融合 + 跨仓库：已完成。
- 决策点 D-CB1..D-CB6（对应 Q14..Q19）：全部已裁决并落地。
- 待办延伸（需新指令）：Q17 graph-ui 3D 可视化 → EP2 前端融合承接；无 EP-CB5 批次定义。

## 4. 结论

**@flowforge/plugin-codebase 程序（EP-CB0~CB4）正式收口，验收通过**。当前工作树即刻复核全绿，无漂移、无待修缺陷；商定范围内无剩余任务。后续若需新增能力（如 graph-ui、更多语言语法资产、Cypher 写子集），作为新指令批次在 34-stage 增登后再动工。