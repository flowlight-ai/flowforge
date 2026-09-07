# 设计文档：EP-CB0 代码智能插件骨架 @flowforge/plugin-codebase（greenfield 工作流）

> 实例：`plugin-codebase`（`docs/process/instances/plugin-codebase.json`）｜ 日期：2026-09-07
> 依据：`docs/refactor/34-stage-ep-cb-plugin-codebase.md`（EP-CB0 批次）+ review_code.md §16

## 1. 目标（Goal）

把 codebase-memory-mcp（纯 C，14.4 万行）以 TS 插件形态移植的第一批：交付
`@flowforge/plugin-codebase` 骨架 + 图谱域模型 + node:sqlite 存储引擎 + 结构层索引闭环
（index → query → schema），建立全仓库快速索引底座。后续批次（EP-CB1-4）在此骨架上扩展
符号级解析、工具面、Cypher、语义层。

## 2. 架构（Architecture）

三层（存储 / 域 / 面）+ 索引监督进程隔离：

```
bin/ff_codebase.mjs ── CLI 面（index/query/schema/status/projects/search/delete）
tools.ts ─────────── 工具注册表（17 工具面定义，EP-CB0 交付 6 个实现）
query.ts ──────────── 查询域（结构化过滤 + BM25 全文 + 分页契约）
indexer.ts ────────── 索引域（结构层：Project→Folder→File→Module 树）
  ├── discover.ts ─── 文件发现（排除规则 + excluded 上报）
  ├── coverage.ts ─── 覆盖率诚实契约（skipped/parse_partial/excluded）
  └── graph-model.ts 图谱域模型（标签/边/属性族——C 语义照搬）
store.ts ──────────── 存储引擎（node:sqlite + FTS5 BM25 + RAM-first 批量事务）
project.ts ────────── 项目注册表（多仓库管理）
```

关键设计决策：
1. **RAM-first**（C graph_buffer 思想）：索引期全部节点/边先驻内存聚合，一次性事务批量落盘；
2. **索引监督进程**（C index_supervisor 思想）：CLI 独立进程跑索引，插件/工具侧只读消费；
3. **覆盖率诚实契约**：excluded（设计排除）与 skipped（失败跳过）分离上报，"缺席≠完整"；
4. **分页契约**：total/has_more/offset/limit（C search_graph 契约照搬）；
5. **BM25 结构加权**：Function/Method +10、Route +8、Class/Interface +5，噪音标签过滤（C 权重照搬）；
6. **camelCase 切分**：updateCloudClient → update/cloud/client 三词入 FTS。

## 3. 技术栈（Tech Stack）

TypeScript（ESM、tsx 直跑）、`node:sqlite`（Node ≥22.5 内置，零外部依赖）、
vitest、零运行时依赖（对齐 plugin-dev 依赖纪律）。

## 4. 规范引用（Spec）

- `docs/refactor/34-stage-ep-cb-plugin-codebase.md`（EP-CB0 任务清单 T1.1-T1.11）
- `docs/rules/13-dev-process.md`（流程铁律）；`docs/rules/test-iron-rules.md`（T1-T9）
- C 源项目 `D:\software\fl\ex\codebase-memory-mcp\src\{store,graph_buffer,discover,mcp}`（语义参照）

## 5. 全局约束（Global Constraints）

- 提交一律走 `./mgr` PR；单文件 ≤ 1000 行；退出码契约 0/1/2。
- T1-T9：禁止 Mock 文件系统/sqlite——测试用真实临时目录 DB + fixture 微型仓库。
- 数据落点 `.flowforge/`（仓库本地，gitignore；D-CB3 裁决）。
- 覆盖率诚实：excluded/skipped 分离；"缺席≠完整"写入工具层描述。

## 6. 决策门记录

### DCP-1 需求决策（requirement → design）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| business_value | 0.40 | 0.5 | 0.95 | operator 指令：高优先级全量移植，dev 的基础 + 全仓库索引底座 |
| feasibility | 0.35 | 0.6 | 0.85 | EP-CB0 结构层无 tree-sitter 依赖（Q14 留 EP-CB1），node:sqlite 内置 |
| security | 0.25 | 0.7 | 0.85 | 零外联、零密钥、纯本地文件；DB 落 gitignore 目录 |

加权总分 0.897 / 阈值 0.65。**通过**。

### DCP-2 方案决策（design → plan）

| 维度 | 权重 | 阈值 | 得分 | 依据 |
|---|---|---|---|---|
| architecture_fit | 0.35 | 0.6 | 0.90 | 三层架构对齐 plugin-dev 包模板与 C 源项目模块边界 |
| completeness | 0.30 | 0.6 | 0.85 | T1.1-T1.11 覆盖 34-stage 验收标准 1-7 全部 |
| risk | 0.35 | 0.5 | 0.80 | node:sqlite FTS5 可用性需验证（node 24 已含）；大仓性能用本仓库实测 |

加权总分 0.855 / 阈值 0.65。**通过**。

## 7. 交付物清单（EP-CB0）

- 包 `packages/plugins/codebase`（bin + 8 个 src 模块 + tests + README）
- `ff_codebase` CLI 七个子命令；`.flowforge/` gitignore 规则
- 根 AGENTS.md ff_ 命令族补行；34-stage 勾选回填
