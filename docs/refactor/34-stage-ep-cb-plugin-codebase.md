# 34 阶段 — EP-CB 代码智能插件 @flowforge/plugin-codebase 总体计划与任务清单

> **依据**：operator 2026-09-07 第二指令（review_code.md §16 总览，本文件为唯一任务依据）
> **源项目**：`D:\software\fl\ex\codebase-memory-mcp`（纯 C，197 文件 / 144,380 行）
> **交付方式**：全部批次走 plugin-dev 七阶段流程（`docs/rules/13-dev-process.md` 铁律）
> **状态图例**：⬜ 未开始 ｜ 🟨 进行中 ｜ ✅ 完成（PR 号）

---

## 1. 定位与目标

`@flowforge/plugin-codebase` 是代码智能底座插件：

1. **plugin-dev 的基础**：代码索引 + 文档生成，为 dev 流程 design/plan 阶段供料（EP-CB2 文档生成器对接 specs/plans 模板）；
2. **全仓库快速索引基础**：任何上层模块与业务（web 界面、API、智能体）经统一查询面消费代码知识图谱；
3. **业界对齐**：tree-sitter 知识图谱 + BM25 检索 + Cypher 查询（C 源项目经 31 仓库实证：83% 回答质量、10× token 节省、2.1× 更少工具调用）。

## 2. 总体架构：三层（存储 / 域 / 面）+ 索引监督进程

```
packages/plugins/codebase/
├── bin/ff_codebase.mjs            # CLI 入口（ff_ 命令族：index/query/schema/status/projects/search）
├── src/
│   ├── graph-model.ts             # 图谱域模型：节点标签/边类型/属性族（照搬 C 语义）
│   ├── store.ts                    # node:sqlite 存储引擎（FTS5 BM25 + 标签计数 + 分页契约）
│   ├── discover.ts                 # 文件发现（gitignore/排除规则感知——C discover 模块）
│   ├── indexer.ts                  # 结构层索引器（Project→Folder→File→Module 树 + RAM-first 聚合）
│   ├── query.ts                    # 结构化查询（label/name_pattern/file_pattern/degree/分页）
│   ├── coverage.ts                 # 覆盖率诚实契约（skipped/parse_partial/excluded 三态上报）
│   ├── tools.ts                    # 工具面定义（对齐 tool-lsp 形态：17 工具注册表）
│   ├── project.ts                  # 项目注册表（多仓库管理：list/delete/状态）
│   └── index.ts                    # 导出面（对齐 plugin-dev 包模板）
└── tests/                          # vitest 契约测试（真实 fixture 微型仓库，不 Mock 文件系统）
```

**数据落点**（Q16 建议值，EP-CB0 内确认）：`<repo>/.flowforge/codebase.db`（仓库本地，gitignore）；
后续批次加集中注册表（`~/.flowforge/projects.json`）支持跨仓库 list_projects。

**索引监督进程**（C index_supervisor 思想）：`ff_codebase index` 作为独立 CLI 进程跑索引
（重活隔离），插件/工具侧只读消费 DB——崩不倒宿主。

## 3. 批次计划与任务清单

### EP-CB0 骨架 + 存储引擎 + 结构层索引闭环 ✅ PR #154

> **DoD**：对本仓库跑通"index → query → schema"闭环；vitest 全绿；`ff_codebase` CLI 可用；
> 覆盖率诚实契约生效。

- [x] T1.1 包骨架：`packages/plugins/codebase`（package.json 对齐 plugin-dev 模板：name/description/bin/exports/files + vitest/tsx devDeps）+ tsconfig + 根 tsconfig.host.json 挂接
- [x] T1.2 graph-model.ts：节点标签枚举（Function/Method/Class/Interface/Module/File/Folder/Route/Variable/Resource/Channel）+ 边类型枚举（CALLS/USAGE/CALL_REFERENCE/INHERITS/IMPLEMENTS/CONTAINS_FOLDER/CONTAINS_FILE/IMPORTS/CROSS_*）+ 属性族类型（complexity/cognitive/loop_count/loop_depth/transitive_loop_depth/recursive/linear_scan_in_loop/alloc_in_loop/recursion_in_loop/unguarded_recursion/param_count/max_access_depth/signature/docstring/return_type/is_test/lines）
- [x] T1.3 store.ts：node:sqlite 建表（projects/nodes/edges/node_props/fts 虚表）+ RAM-first 批量事务落盘 + FTS5 BM25 全文（camelCase 切分：updateCloudClient → update cloud client）+ 标签计数 + 分页契约（total/has_more/offset/limit）
- [x] T1.4 discover.ts：文件发现（目录遍历 + gitignore 基本规则 + 默认排除 node_modules/lib/dist/.git）+ 排除上报（excluded/not_indexed_files）
- [x] T1.5 indexer.ts：结构层索引（Project→Folder→File 树 + Module 检测（package.json/pyproject，EP-CB0 记录于 Folder 属性，专属 Module 节点随 EP-CB1）+ 文件语言/行数/大小属性）+ 索引模式（full/moderate/fast 三个文件过滤档位）+ index_status 元数据（时间/文件数/节点数/模式）
- [x] T1.6 query.ts：结构化查询（label/name_pattern（regex）/file_pattern/min_degree/max_degree/limit/offset/fields/detail=ids）+ BM25 query 搜索（结构加权：Function/Method +10、Route +8、Class/Interface +5，噪音标签 File/Folder/Variable/Project 过滤——C 源项目权重照搬）
- [x] T1.7 project.ts：多项目管理（list_projects/delete_project/按名称覆盖 derive）+ 项目名安全化（非 ASCII 编码 + 不安全路径字符归一化——C 语义照搬）
- [x] T1.8 tools.ts：工具注册表（17 工具中 EP-CB0 交付 6 个：index_repository/list_projects/delete_project/index_status/get_graph_schema/search_graph 基础档）——形态对齐 tool-lsp（schema + 描述 + 输入校验），MCP 挂接留 EP-CB2
- [x] T1.9 CLI：`bin/ff_codebase.mjs`（init/index/query/schema/status/projects/search/delete 子命令 + 退出码契约 0/1/2 对齐 ff_dev/ff_doctor）
- [x] T1.10 测试：graph-model 契约测试 + store（真实临时目录 DB，不 Mock sqlite）+ discover/indexer（fixture 微型仓库：真实文件树）+ query（含分页契约与 BM25 排序断言）+ CLI 端到端冒烟
- [x] T1.11 文档：包 README + `.flowforge/` gitignore 规则 + 13-dev-process 与 review_code.md §16 交叉引用回填

### EP-CB1 tree-sitter 解析管线 + 符号级图谱 ✅（Q14/Q18 裁决后动工）

- [x] T2.1 解析器依赖落地（Q14：web-tree-sitter WASM vs 原生绑定）+ TS/JS 语法资产（web-tree-sitter@0.25 + tree-sitter-typescript/javascript 语法资产，WASM 预加载单例）
- [x] T2.2 符号抽取：Function/Method/Class/Interface/Enum/Type/Variable + 属性族全量（复杂度属性族计算器：cyclomatic/cognitive/loopDepth/maxAccessDepth/paramCount）
- [x] T2.3 边抽取：DEFINES/DEFINES_METHOD/CALLS/USAGE/INHERITS/IMPLEMENTS（勘误：文件→符号按 C 语义为 **DEFINES**，非 CONTAINS_FILE——后者为 Folder→File 结构边）
- [x] T2.4 get_file_outline / get_code_snippet 工具 + parse_partial 覆盖率上报（ERROR 树 → coverage.parsePartial）
- [x] T2.5 对本仓库全量索引验证（TS/JS 主仓库为验收语料）（108 用例连续两次全绿 + 全量索引 + outline/snippet 冒烟，见 `docs/process/verifications/plugin-codebase-cb1.md`）

### EP-CB2 工具面补全 + 文档生成器 ✅ PR #158

- [x] T3.1 trace_path（调用链追踪，id→QN 邻接 + 双向 BFS 防环/深度截断）/ search_code（磁盘原文行级检索，limit 截断诚实上报 hasMore）/ get_architecture（跨模块依赖聚合，符号节点经 filePath 解析到模块）
- [x] T3.2 check_index_coverage / detect_changes（mtime 变更检测）/ compare_graphs（快照差集，identical 契约）
- [x] T3.3 manage_adr（ADR 生命周期 list/get/create，`# ADR-N:` 正则勘误）/ delete_project 补全
- [x] T3.4 文档生成器 docgen.ts：图谱 → plugin-dev specs/plans 模板骨架生成（No-Placeholder 纪律，结构头齐备）
- [x] T3.5 MCP 挂接：mcp.ts 装配契约（18 工具注册表 → flowforge mcp 工具体系，对齐 tool-lsp）
- [x] T3.6 测试与验证：148 契约测试全绿（18 文件）+ 包级 tsc exit 0 + oxlint 0（见 `docs/process/verifications/plugin-codebase-cb2.md`）

### EP-CB3 Cypher 子集 + 增量索引 + 轨迹 ⬜（Q19 裁决后动工）

- [ ] T4.1 Cypher 查询引擎子集（MATCH/WHERE/RETURN/ORDER BY/LIMIT + 100k 行上限契约）
- [ ] T4.2 missed graph（未完全索引文件的文件结构图）+ graph="missed" 查询
- [ ] T4.3 watcher 增量索引 + detect_changes 集成
- [ ] T4.4 ingest_traces 轨迹摄取
- [ ] T4.5 持久化工件（压缩 artifact 团队共享，对齐 C 的 graph.db.zst 模型）

### EP-CB4 语义层 + LSP 融合 + 跨仓库 ⬜（Q15 裁决后动工）

- [ ] T5.1 semantic edges + simhash 相似度去重边
- [ ] T5.2 向量检索（semantic_query 数组关键词 per-keyword min-cosine 契约照搬）
- [ ] T5.3 LSP 融合：CALL/USAGE 语义解析经 ctx.lsp seam 增强（Hybrid LSP 落地）
- [ ] T5.4 cross-repo-intelligence（CROSS_HTTP_CALLS/CROSS_ASYNC_CALLS/CROSS_CHANNEL 跨项目边）
- [ ] T5.5 transitive_loop_depth 过程间传播（最坏嵌套环深沿 CALLS 边传播）

## 4. 决策点登记（对应 review_code.md §15 Q14-Q19，operator 2026-09-07 全部裁决）

| # | 决策点 | 裁决 | 状态 |
|---|---|---|---|
| D-CB1 | 解析器依赖（Q14） | web-tree-sitter（WASM）：纯 TS 生态、无原生编译、语法资产 vendored | ✅ 已裁决（operator 确认按建议执行） |
| D-CB2 | LSP 融合边界（Q15） | ctx.lsp 作为语义增强源接入，不替代 tree-sitter 主链路 | ✅ 已裁决（EP-CB4 接入） |
| D-CB3 | 数据落点（Q16） | 仓库本地 `.flowforge/codebase.db` + 集中注册表 | ✅ EP-CB0 按建议执行 |
| D-CB4 | graph-ui（Q17） | 纳入 EP2 前端融合，非核心链路 | ✅ 已裁决（EP2 前端融合批次承接） |
| D-CB5 | 语言节奏（Q18） | 先 TS/JS + JSON/YAML/MD 结构层，语言资产按需增量 | ✅ 已裁决（EP-CB1 按此执行） |
| D-CB6 | Cypher 深度（Q19） | 结构化查询先行，Cypher 子集随 EP-CB3 | ✅ 已裁决 |

## 5. 验收标准（EP-CB0）

1. `node packages/plugins/codebase/bin/ff_codebase.mjs index --repo .` 对本仓库完成结构层索引（数千文件级），退出码 0；
2. `ff_codebase query --label File --limit 5` 返回分页契约（total/has_more）；
3. `ff_codebase schema` 输出标签/边类型计数（对齐 C 的 get_graph_schema 语义）；
4. `ff_codebase search --query "plugin"` BM25 排序返回（camelCase 切分生效）；
5. `ff_codebase status` 上报 index_status 元数据 + 覆盖率三态（excluded 生效）；
6. vitest 全绿（契约测试 + CLI 冒烟）；typecheck/oxlint 干净；
7. 走完 plugin-dev 七阶段流程（实例 + 四产物 + mgr PR）。

## 6. 与既有体系的衔接

- **plugin-dev**：EP-CB0 本身作为 greenfield 工作流实例走七阶段（`ff_dev init plugin-codebase --workflow greenfield`）；
- **ff_ 命令族**：ff_codebase 加入 ff_dev/ff_doctor 家族（根 AGENTS.md 常用命令区补一行）；
- **ts-ci.yml**：`ff_doctor all` 已覆盖流程遵从度；plugin-codebase 包测试纳入 vitest 全量（自动生效）；
- **storage 选型**：node:sqlite 与 @flowforge/storage-sqlite 同源（内置驱动），图 schema 独立不并入 kv hub；
- **测试铁律**：T1-T9——索引管线用真实文件系统与真实 sqlite（禁止 Mock 文件系统/sqlite）；fixture 微型仓库入库 tests/fixtures/。
