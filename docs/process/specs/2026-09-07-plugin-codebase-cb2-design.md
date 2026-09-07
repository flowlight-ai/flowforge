# EP-CB2 工具面补全 + 文档生成器设计（@flowforge/plugin-codebase）

## 1. 目标

在 EP-CB0 结构层 + EP-CB1 符号层之上，补齐插件剩余的工具面（clowder/dsh 对齐的 17 工具占比），交付：
1. **调用链追踪 `trace_path`**——caller/callee 双向路径；
2. **原文检索 `search_code`**——非 BM25 的磁盘原文/语法检索；
3. **架构视图 `get_architecture`**——模块边界 + 跨模块依赖 + 热点文件；
4. **覆盖率检查 `check_index_coverage`**——"缺席≠完整"目标化核验；
5. **变更检测 `detect_changes`**——git 感知的增量提示；
6. **图谱对比 `compare_graphs`**——两快照差集；
7. **ADR 管理 `manage_adr`**——对接 `docs/decisions/`；
8. **文档生成器**——图谱 → plugin-dev specs/plans 模板骨架，构成 dev 插件供料闭环；
9. **MCP 挂接**——tools.ts 注册表 → flowforge mcp 工具体系（对齐 tool-lsp 装配契约）。

**决策依据**：EP-CB0/1 已完成；operator 2026-09-07 裁决 Q15（LSP 语义增强留 EP-CB4）、
Q19（Cypher 子集随 EP-CB3）；本批 T3.5 MCP 挂接对齐 tool-lsp（既有 `packages/mcp` 形态）。

## 2. 范围

### In scope（EP-CB2）
- `trace_path`（C mcp.c trace_path 移植：BFS/DFS 沿 CALLS/USAGE 双向，max_depth 上限 + visited 防环）
- `search_code`（C search_code 移植：磁盘原文行级检索 + 可选正则，files 白名单/pattern 过滤）
- `get_architecture`（C get_architecture 移植：模块边界汇总 + 跨模块 CALLS/IMPORTS 依赖 + 热点文件按 complexity/degree 排序）
- `check_index_coverage`（对齐 index_status + coverage.parse_partial/skipped/excluded 目标化核验）
- `detect_changes`（git 感知：mtime 对比 last_indexed_at + git diff/status 解析，纯 Node 免依赖）
- `compare_graphs`（两项目快照节点/边差集：added/removed + 空集判定）
- `manage_adr`（list/get/create 对接 `docs/decisions/`，ADR 编号递增 + Markdown 模板）
- 文档生成器（`src/docgen.ts`：图谱查询面 → plugin-dev specs/plans 骨架生成）
- MCP 挂接（`src/mcp.ts`：tool-lsp 装配契约对齐）
- CLI 子命令扩展（trace/arch/coverage/changes/compare/adr/docgen）

### Out of scope（后续批次）
- Cypher 查询引擎（EP-CB3）；watcher 增量索引（EP-CB3）；ingest_traces（EP-CB3）；
- semantic edges + simhash + 向量检索（EP-CB4）；LSP 融合（EP-CB4）；CROSS_* 跨仓库边（EP-CB4）

## 3. 架构：新增六个模块

```
src/
├── trace.ts      # T3.1a trace_path：图邻接遍历（C mcp.c 移植）
├── search.ts     # T3.1b search_code：磁盘原文检索
├── architecture.ts # T3.1c get_architecture：模块/依赖/热点聚合
├── coverage.ts   # T3.2a check_index_coverage：三态核验（扩展现有，仅加查询面）
├── changes.ts    # T3.2b detect_changes：git 变更检测
├── compare.ts    # T3.2c compare_graphs：快照差集
├── adr.ts        # T3.3  manage_adr：ADR 生命周期
├── docgen.ts     # T3.4  文档生成器（dev 供料闭环）
├── mcp.ts        # T3.5  MCP 装配（对齐 tool-lsp）
├── store.ts      # 扩展：节点查寻（byQn/byFile）、边遍历、mtime 字段
├── tools.ts      # 扩展：+trace_path/+search_code/+get_architecture/+check_index_coverage/+detect_changes/+compare_graphs/+manage_adr（+ep docgen 工具待定）
└── cli/main.ts   # 扩展：+trace/+arch/+coverage/+changes/+compare/+adr 子命令
```

**设计要点**：
- trace/search/arch 为**只读消费**面（开 DB 查询 + 选择性读磁盘），依赖现有 `store.edgesOf()/findNodeByQn()/fileOutline()`。
- detect_changes 用 `fs.stat` mtime 对比 `projects.last_indexed_at`（纯 Node，无 git CLI 依赖，契合 T1-T9 零 Mock、进程免外链）。
- docgen 消费查询面输出（symbol 清单/模块结构/依赖）生成 Markdown 骨架，模板与 `docs/process/` 模板纪律一致。
- MCP 挂接对齐既有 `packages/mcp` 的 tool-lsp 装配契约（见 §4.6）。

## 4. 核心语义（C 源对照）

### 4.1 trace_path（mcp.c trace_path 移植）

入参：`project` + `qualified_name` + `direction(callers|callees)` + `max_depth(默认5)`。
- 图数据：`store.edgesOf(project)` 过滤 CALLS/USAGE/INHERITS/IMPLEMENTS 载体边（对齐 C 的 trace 边集）。
- 遍历：BFS（callers=反向邻接 / callees=正向邻接），`visited` 去重防环，`max_depth` 截断。
- 出参：`{ start, direction, depth, path[] }`——path 为 `{ qn, label, depth, via }` 行（via=边类型）。
- 无节点 → ProjectNotFoundError / SymbolNotFoundError（退出码 1）；非符号入参 → UsageError（2）。
- 不变量：结果按深度升序、同深度按 qn 字典序，确定性输出（测试断言稳定）。

### 4.2 search_code（mcp.c search_code 移植）

入参：`project` + `pattern` + 可选 `file_pattern` + `limit`。
- 语义：**磁盘原文行级检索**（非索引），遍历 project 下 File 节点（store.search label=File 快照过滤），
  读取文件内容对 `pattern`（正则或字面量）逐行匹配。
- 产出：`{ matches[], total, hasMore }`，match = `{ file_path, line_number, line_text, column }`。
- 防滥用：单行过长的行跳过列号计算；总文件读取数设上限（防超大仓库卡死，退出码 0 + `truncated` 标记）。
- 正则编译失败 → UsageError（2）。

### 4.3 get_architecture（mcp.c get_architecture 移植）

入参：`project` + `depth(默认2)`。
- 模块边界：从 File 节点推导目录归类；Module 标记节点（EP-CB0 `props.module=true`）作为顶层模块。
- 跨模块依赖：CALLS/IMPORTS 边在模块间聚合 → `{ from, to, count, edgeTypes[] }` 依赖矩阵。
- 热点文件：按 `props.complexity`（无则回退 degree）降序 Top-N。
- 出参：`{ modules[], moduleCount, dependencies[], hotFiles[], depth }`。

### 4.4 check_index_coverage（对齐 index_status + coverage 三态）

入参：`project` + 可选 `file_pattern`。
- 复用 `indexStatus`（node/edge/symbol 计数）+ 覆盖率三态（excluded/skipped/parse_partial）目标化：
  通过 `file_pattern` 过滤并将"已索引 vs 缺席"并列上报。
- 出参：`{ project, nodeCount, edgeCount, symbolCount, coverage: { excluded, skipped, parsePartial }, absentFiles[] }`。
- 原则：诚实契约——"解析不完整(n)" + "缺席(n)" 显式上报，不当作"完整"。

### 4.5 detect_changes（git 感知，纯 Node）

入参：`project` + `repo_path`。
- 基线：`projects.last_indexed_at`；扫描:File 节点，`fs.stat` 取 mtime；mtime > last_indexed_at → changed。
- 变更分类：`{ changedFiles[], addedFiles[], removedFiles[], lastIndexedAt }`。
  - changed/new = mtime 更新 / 遗漏的已存在文件；removed = 索引中但磁盘缺失。
- 纯 Node 免 git CLI（T1-T9 环境一致，CI 无 git 网络依赖约束）。git diff 语义留后续（watcher EP-CB3 增强）。

### 4.6 MCP 装配（对齐 tool-lsp）

既有 `packages/mcp` 的 tool-lsp 形态：`{ name, description, inputSchema, execute }` 注册表 +
capability seam。EP-CB2 交付 `src/mcp.ts`：
- `mountCodebaseTools(registry)`——把 `tools.ts` 已实现工具（EP-CB0/1/2）包装为 mcp 工具描述。
- 工具 `execute` 分发 → `executeTool` 接口（异步已具备）。
- 不新增 cordis 依赖：mcp.ts 为纯装配层（对齐 EP-CB0 T1.8 的独立性承诺）。

### 4.7 文档生成器 docgen（dev 供料闭环）

入参：`project` + `template(spec|plan)` + 可选 `feature_name`/`out_path`。
- 消费图谱查询面：模块/符号清单/复杂度 Top 文件 → 生成 plugin-dev `specs/`/`plans/` Markdown 骨架
  （标题/目标/范围/任务清单占位），占位遵循 docs/process No-Placeholder 纪律（骨架仅 STRUCTURE，不产假内容）。
- 出参：`{ outPath, template, sections[] }`，统一走文件写入（可指定 out_path）。
- 意义：dev 插件 design/plan 阶段可直接以图谱供料生成文档雏形。

## 5. 数据契约 / 稳定性

- 所有查询面确定性输出（排序字段固定），测试断言稳定（连续两次运行一致）。
- 退出码契约 0/1/2 延续 ff_codebase。
- 单文件 ≤1000 行，T1-T9 零 Mock：真实 DB + 真实 fixture 仓库 + 真实磁盘检索。

## 6. 测试策略

新增 spec：trace.spec（双向/防环/深度截断/未知 qn）、search.spec（disk 匹配/正则/file_pattern/超大截断）、
architecture.spec（模块边界/跨模块依赖/热点排序）、coverage.spec（三态并列/缺席上报）、
changes.spec（mtime 变更/新增/删除）、compare.spec（added/removed/空集）、adr.spec（list/get/create 编号递增）、
docgen.spec（spec/plan 骨架、No-Placeholder 纪律、out_path 落地）、mcp.spec（装配结果对齐 tool-lsp 形状）、cli.spec 增冒烟。
fixture：mini-repo 已覆盖符号层，复用 + 增 tests/fixtures/ 变更检测语料（两态文件）。
预期：EP-CB0/1 既有 108 用例零回归 + 新增 ≥40 用例全绿。

## 7. 风险与对策

- **search_code 磁盘开销**：超大仓库。对策：文件读取上限 + `truncated` 诚实标记。
- **detect_changes 时区/mtime 抖动**：统一 UTC ms 比较 + tests 用显式 mtime 注入。
- **MCP 契约漂移**：先以 tool-lsp 形状单测锚定（本批），harness 集成（EP1）再验证实际装配。
- **文档生成器占位纪律**：骨架仅结构，不生成假内容（对齐 No-Placeholder validator）。