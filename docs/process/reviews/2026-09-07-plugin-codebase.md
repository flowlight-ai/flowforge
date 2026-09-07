# plugin-codebase 代码审查记录

> 两阶段审查：阶段 1 规格符合性 + 阶段 2 代码质量。

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-codebase` |
| 审查范围 | 工作区未提交改动（packages/plugins/codebase 全新包 + docs 挂接 + .gitignore + AGENTS.md + 13-dev-process.md 回填） |
| 依据 | 实施计划：`docs/process/plans/2026-09-07-plugin-codebase.md`（全局约束：mgr PR / 单文件 ≤1000 行 / 退出码 0-1-2 / T1-T9 禁 Mock 文件系统与 sqlite / 数据落点 .flowforge/ gitignore / 覆盖率诚实契约） |
| 审查者 | 主会话（sherlock 实现 + 自审；跨模型评审不可用，降级记录见约束核对） |
| 日期 | 2026-09-07 |

## 阶段 1：规格符合性（Spec Compliance）

对照计划任务 1-5 逐项核对：

| 任务 | 状态 | 备注 |
|---|---|---|
| 任务 1 包骨架 + graph-model.ts | 符合 | package.json 对齐 plugin-dev 模板（bin/exports/files）；NODE_LABELS 11 项 + EDGE_TYPES 11 项 + 属性族类型齐备；graph-model.spec 7 测试通过 |
| 任务 2 store.ts（node:sqlite + FTS5） | 符合 | projects/nodes/edges/node_props/node_fts 五表；RAM-first 批量事务；tokenizeName camelCase 切分（含连续大写缩写词 XMLParser→xml parser）；BM25 结构加权 + 噪音标签过滤（File/Folder/Variable/Project——对齐 C #518/#519 语义，Module 保留）；分页契约 total/hasMore；store.spec 17 测试通过（真实临时目录 DB） |
| 任务 3 discover/indexer/coverage | 符合 | 默认排除 node_modules/lib/dist/.git/.flowforge 等 17 目录 + 显式 exclude；三模式 full/moderate/fast 档位过滤；index_status 元数据落 projects 表；覆盖率三态（excluded/skipped/parsePartial）；discover-indexer.spec 11 测试通过（fixture 微型仓库） |
| 任务 4 query/project/tools | 符合 | label/name_pattern（regex）/file_pattern/min_degree/max_degree/limit/offset 结构化过滤；searchNodes BM25；项目名安全化（sanitize）；tools.ts 6 工具注册表（index_repository/list_projects/delete_project/index_status/get_graph_schema/search_graph）形态对齐 tool-lsp；query.spec 9 测试通过 |
| 任务 5 CLI + 端到端 + 文档收尾 | 符合 | 七子命令 + 退出码契约；cli.spec 13 测试通过；包 README + .gitignore 显式 .flowforge/ 规则 + AGENTS.md/13-dev-process 交叉引用回填完成 |

**裁决**：规格符合 ✅

## 阶段 2：代码质量（Code Quality）

| 维度 | 权重 | 发现 |
|---|---|---|
| code_quality | 0.60 | 零运行时依赖（node:sqlite 内置）；三层架构边界清晰（store 域 / 面）；单文件最大 store.ts 约 700 行 < 1000 行上限；exactOptionalPropertyTypes 严格模式全适配（条件 spread 可选参数）；错误分类清晰（UsageError/ProjectNotFoundError/mapQueryError）；CLI withStore 统一资源释放 |
| security | 0.40（否决维） | 无网络访问；SQL 全参数化绑定（无字符串拼接注入面）；正则来自 CLI 显式参数（name-pattern/file-pattern）并有 try-catch 兜底为用法错误；文件读取限制 maxFileBytes 上限防超大文件 |

**TR-1 技术门禁**：加权 0.96 / 阈值 0.65（greenfield）

### 发现清单（P1/P2/P3 分级）

| 级别 | 条目 | 位置 | 处置 |
|---|---|---|---|
| P3 | EP-CB0 仅结构层节点，`search` 因噪音标签过滤在本仓库返回空（C 语义正确：File/Folder/Variable/Project 均为噪音标签），符号级搜索随 EP-CB1 落地 | store.ts BM25_NOISE_LABELS | 已在 README 与 34-stage 注明，属批次边界非缺陷 |
| P3 | Module 检测以 Folder 属性承载，专属 Module 节点 + IMPORTS 边延至 EP-CB1 | indexer.ts | 设计文档已声明（indexer.ts 头注释） |
| P3 | web/node_modules.bak 下一个 2MB+ 文件被 skipped 上报（行数统计上限）——覆盖率契约正确工作 | coverage 契约 | 无需处置（诚实上报即设计目标） |

无 P1/P2 发现。

## 约束核对

- [x] 审查者为独立个体且与实现者不同模型族（跨模型评审）——**降级**：本环境无第二模型族可用，主会话自审 + 对照 C 源项目逐项语义核验（噪音标签 SQL 原文 / BM25 权重 / 分页排序稳定性），降级记录于此
- [x] 测试证据核对（T1-T9 底线：Mock LLM 的测试直接判 P1）——57 测试全部真实文件系统 + 真实 sqlite（临时目录 DB + fixture 微型仓库），无 Mock
- [x] "⚠️ 无法从 diff 验证"条目已由控制器亲自解决——真实仓库冒烟（index 8376 文件 / query / schema / status）由主会话亲自执行并截取输出
- [x] 降级记录：跨模型评审不可用 → 主会话自审 + C 源项目语义对照（mcp.c L3614-3641 BM25 SQL 原文核验）
