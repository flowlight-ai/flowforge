# @flowforge/plugin-codebase

FlowForge 代码智能底座插件：知识图谱（knowledge graph）建模、node:sqlite 存储（FTS5 BM25 全文检索）、结构层索引与结构化查询，提供 `ff_codebase` CLI 与工具注册表面。

移植自 `codebase-memory-mcp`（纯 C，197 文件 / 14.4 万行），是 EP-CB 批次的交付物（总体计划见 [docs/refactor/34-stage-ep-cb-plugin-codebase.md](../../../docs/refactor/34-stage-ep-cb-plugin-codebase.md)）。

## 定位

1. **plugin-dev 的基础**：代码索引与文档生成，为 dev 流程 design/plan 阶段供料（EP-CB2 文档生成器对接 specs/plans 模板）；
2. **全仓库快速索引基础**：任何上层模块与业务（web 界面、API、智能体）经统一查询面消费代码知识图谱；
3. **业界对齐**：tree-sitter 知识图谱 + BM25 检索 + Cypher 查询（C 源项目经 31 仓库实证：83% 回答质量、10× token 节省、2.1× 更少工具调用）。

## 架构：三层 + 索引监督进程

```
packages/plugins/codebase/
├── bin/ff_codebase.mjs            # CLI 入口（ff_ 命令族）
├── src/
│   ├── graph-model.ts             # 图谱域模型：节点标签/边类型/属性族（C 语义照搬）
│   ├── store.ts                   # node:sqlite 存储引擎（FTS5 BM25 + 分页契约）
│   ├── discover.ts                # 文件发现（默认排除 + 显式 exclude）
│   ├── indexer.ts                 # 结构层索引器（Project→Folder→File 树 + RAM-first）
│   ├── query.ts                   # 结构化查询 + BM25 搜索
│   ├── coverage.ts                # 覆盖率诚实契约（excluded/skipped/parsePartial 三态）
│   ├── tools.ts                   # 工具注册表（17 工具中 EP-CB0 交付 6 个）
│   ├── project.ts                 # 项目注册表（多仓库：list/delete/安全化命名）
│   └── index.ts                   # 库导出面
└── tests/                         # vitest 契约测试（真实 fixture 微型仓库，不 Mock）
```

- **RAM-first**：索引期节点/边先驻内存聚合，再以批量事务落盘（对齐 C 的 graph_buffer 设计）；
- **索引监督进程**：`ff_codebase index` 作为独立 CLI 进程执行索引（重活隔离），工具侧只读消费 DB——崩不倒宿主；
- **数据落点**：`<repo>/.flowforge/codebase.db`（仓库本地，gitignore 已排除；集中注册表 `~/.flowforge/projects.json` 属后续批次）。

## CLI

```
ff_codebase index   --repo <path> [--mode full|moderate|fast] [--name <n>] [--exclude a,b] [--db <path>]
ff_codebase query   --repo <path> [--label <label>] [--name-pattern <re>] [--file-pattern <re>]
                    [--min-degree <n>] [--max-degree <n>] [--limit <n>] [--offset <n>] [--project <name>]
ff_codebase search  --repo <path> --query "<bm25 tokens>" [--limit <n>] [--offset <n>] [--project <name>]
ff_codebase schema  [--repo <path>] [--project <name>] [--db <path>]
ff_codebase status  [--repo <path>] [--project <name>] [--db <path>]
ff_codebase projects [--repo <path>] [--db <path>]
ff_codebase delete  --project <name> [--repo <path>] [--db <path>]
```

- 默认 DB：`<repo>/.flowforge/codebase.db`；默认项目名：仓库目录名（安全化）。
- 退出码契约（对齐 `ff_dev`/`ff_doctor`）：`0` 成功；`1` 项目不存在/无结果；`2` 用法错误。

直接运行（无需构建）：

```sh
node packages/plugins/codebase/bin/ff_codebase.mjs index --repo . --mode fast
node packages/plugins/codebase/bin/ff_codebase.mjs query --label File --limit 5
node packages/plugins/codebase/bin/ff_codebase.mjs schema
```

## 索引模式与覆盖率诚实契约

| 模式 | 行为 |
|---|---|
| `full` | 索引所有发现的文件（受排除规则约束） |
| `moderate` / `fast` | 限定代码扩展名（ts/js/py/rs/go/java/…等代码与配置切片） |

覆盖率契约（"缺席 ≠ 完整"）：索引结果始终上报三态——

- `excluded`：被排除规则命中的目录（设计排除）；
- `skipped`：读取失败/超限跳过的文件（失败跳过，附原因）；
- `parsePartial`：部分解析的文件（EP-CB1 符号管线引入）。

## BM25 搜索语义（C 源项目 search_graph 照搬）

- **camelCase 切分**：`updateCloudClient` 按 `update cloud client` 建索引（`tokenizeName` 支持连续大写缩写词，如 `XMLParser → xml parser`）；
- **结构加权**：Function/Method +10、Route +8、Class/Interface（及类型/关系层）+5；
- **噪音标签过滤**：`File`/`Folder`/`Variable`/`Project` 不参与 BM25 排序结果（Module 保留以承载散文内容——C #518/#519 语义）。因此**纯结构层图谱（EP-CB0）的 search 返回空属正确行为**，符号级搜索随 EP-CB1 落地；文件名检索请用 `query --label File --name-pattern`；
- **分页契约**：`total`/`hasMore`/`offset`/`limit`，rank 并列时以 node id 稳定排序。

## 测试铁律（T1-T9）

- 索引管线使用**真实文件系统与真实 sqlite**（禁止 Mock 文件系统/sqlite）；
- fixture 微型仓库入库 `tests/fixtures/mini-repo/`；
- 运行：`pnpm vitest run packages/plugins/codebase`。

## 状态与路线图

| 批次 | 内容 | 状态 |
|---|---|---|
| EP-CB0 | 骨架 + 存储引擎 + 结构层索引闭环 | ✅ 本次交付 |
| EP-CB1 | tree-sitter 解析管线 + 符号级图谱（Q14/Q18 裁决后动工） | ⬜ |
| EP-CB2 | 工具面补全 + 文档生成器 + MCP 挂接 | ⬜ |
| EP-CB3 | Cypher 子集 + 增量索引 + 轨迹摄取（Q19 裁决后动工） | ⬜ |
| EP-CB4 | 语义层 + LSP 融合 + 跨仓库（Q15 裁决后动工） | ⬜ |
