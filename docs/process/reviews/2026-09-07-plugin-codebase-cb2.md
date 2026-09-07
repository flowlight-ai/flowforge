# plugin-codebase EP-CB2 代码审查记录

> 两阶段审查：阶段 1 规格符合性 + 阶段 2 代码质量。

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `plugin-codebase-cb2` |
| 审查范围 | 工作区未提交改动（packages/plugins/codebase/src/{trace,search,architecture,changes,compare,adr,docgen,mcp}.ts + store/query/index/tools/cli 扩展 + 8 个新测试文件 + cli 冒烟 + verification 证据 + review_code.md 登记） |
| 依据 | 设计：`docs/process/specs/2026-09-07-plugin-codebase-cb2-design.md`（全局约束：mgr PR / 单文件 ≤1000 行 / 退出码 0-1-2 / T1-T9 禁 Mock 文件系统与 sqlite） |
| 审查者 | 主会话（sherlock 实现 + 自审 + 契约测试锚定） |
| 日期 | 2026-09-07 |

## 阶段 1：规格符合性（Spec Compliance）

对照设计 §2 In-scope 逐项核对：

| 任务 | 状态 | 备注 |
|---|---|---|
| trace_path（T3.1a） | 符合 | 双向 BFS + visited 防环 + max_depth 截断；id→QN 符号邻接（修复 edgesOf 节点 ID / 遍历 QN 键不匹配缺陷）；trace.spec 7 测试 |
| search_code（T3.1b） | 符合 | 磁盘原文行级检索 + 正则/字面量回退 + file_pattern + 读取上限诚实 truncated；修复 limit 截断时 hasMore 恒 false 缺陷；search.spec 5 测试 |
| get_architecture（T3.1c） | 符合 | 模块边界 + 跨模块依赖聚合 + 热点文件（complexity→degree 排序）；修复边 target 为符号 ID 致依赖遗漏缺陷；architecture.spec 4 测试 |
| check_index_coverage（T3.2a） | 符合 | 三态核验复用
| detect_changes（T3.2b） | 符合 | 纯 Node mtime vs last_indexed_at 基线；changed/added/removed 分类；changes.spec 5 测试 |
| compare_graphs（T3.2c） | 符合 | 两快照节点/边差集 + identical 判定；compare.spec 3 测试 |
| manage_adr（T3.3） | 符合 | list/get/create + 编号递增 + Markdown 模板；修复 `# ADR-N:` 开头正则不匹配致 list 恒空缺陷；adr.spec 5 测试 |
| docgen（T3.4） | 符合 | spec/plan 骨架 + No-Placeholder 纪律 + out_path 落地；docgen.spec 4 测试 |
| MCP 装配（T3.5） | 符合 | READ_ONLY 工具面 + tool-lsp 契约卡片；写工具排除；mcp.spec 3 测试 |
| CLI 子命令扩展 | 符合 | trace/grep/arch/coverage + CLI 冒烟 4 用例 |

**裁决**：规格符合 ✅

## 阶段 2：代码质量（Code Quality）

- **确定性输出**：trace/arch/compare/search 均显式排序（深度→qn / 模块→依赖→路径），连续两次运行稳定（验收复跑一致）。
- **风险与对策核验**：
  - search_code 磁盘开销 → `maxFiles` 读取上限 + `truncated` 诚实标记（search.spec 锁定）。
  - detect_changes 时区/mtime 抖动 → UTC ms 比较 + 测试显式 mtime 注入（未来时间戳触发，避免与 last_indexed_at≈now 竞态）。
  - 文档生成器占位纪律 → 仅 STRUCTURE 骨架，无假 PROSE（docgen.spec 断言标题集合）。
- **单文件行数**：全部 ≤1000 行。
- **T1-T9 铁律**：零 Mock 真实 DB + 真实 fixture + 真实磁盘。

**裁决**：代码质量 ✅

## 结论

两阶段审查通过，可提交 PR（管理端合入后即收尾 EP-CB2）。