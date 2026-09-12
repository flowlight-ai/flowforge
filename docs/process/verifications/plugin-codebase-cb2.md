# plugin-codebase-cb2 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。EP-CB2 工具面补全 + 文档生成器 + MCP 挂接，本仓库全量验收。

### [2026-09-12T14:10:00.000Z] ff_codebase trace 调用链追踪
- **命令**：`ff_codebase trace --repo . --qn flowforge.packages.plugins.codebase.src.symbols.computeQualifiedName --direction callees --max-depth 2`
- **退出码**：0
- **输出摘要**：返回 11 条 BFS 路径（depth1/2），`via` 区分 USAGE/CALLS，深度升序确定性输出（含跨包 test 引用方与 project/snapshot 等 callees）
- **结论**：通过

### [2026-09-12T14:11:00.000Z] ff_codebase arch 架构视图
- **命令**：`ff_codebase arch --repo . --depth 1`
- **退出码**：0
- **输出摘要**：moduleCount=80（含 packages 模块 4914 文件、web 310、core 179、tests 168 等）；跨模块依赖矩阵含 CALLS/USAGE 边聚合；hotFiles Top10 按 degree 降序（首为 packages/cats/shared/src/types/index.d.ts degree=1098，notes index.ts/index.js 同族）
- **结论**：通过

### [2026-09-12T14:12:00.000Z] ff_codebase coverage 覆盖率核验（三态并列 + 缺席上报）
- **命令**：`ff_codebase coverage --repo .`
- **退出码**：0
- **输出摘要**：nodeCount=45721 / edgeCount=156072 / symbolCount=37456；excluded 列默认排除目录（.git/node_modules/dist 等）；absentFiles 并列上报未入库文件（含 .autonomous/patches 策略排除项）——诚实契约，"缺席≠完整"
- **结论**：通过

### [2026-09-12T14:13:00.000Z] ff_codebase changes 变更检测（mtime 增量）
- **命令**：`ff_codebase changes --repo .`
- **退出码**：0
- **输出摘要**：基于 lastIndexedAt（2026-09-12T05:45:45.221Z）mtime 比对：changed=1（instances/plugin-codebase-cb1.json）、added=4（本批次新增产物）、removed=0，totalChanged=5
- **结论**：通过

### [2026-09-12T14:14:00.000Z] ff_codebase docgen 文档生成器（dev 供料闭环）
- **命令**：`ff_codebase docgen --repo . --template spec --feature-name ep-cb2-verify --out .flowforge/cb2-verify-spec.md`
- **退出码**：0
- **输出摘要**：生成 spec 骨架 8 sections（目标/范围/现状供料/决策/数据契约/测试/验收），模块 615、符号类型 11 类；§5-7 为结构占位（No-Placeholder 纪律，无假内容）；outPath 落盘
- **结论**：通过

### [2026-09-12T14:15:00.000Z] vitest 全量回归 + tsc
- **命令**：`vitest run packages/plugins/codebase/tests/`（239 用例）+ `tsc --noEmit`（packages/plugins/codebase）+ `oxlint`
- **退出码**：0
- **输出摘要**：29 files / 239 tests 全绿（含 EP-CB2 trace/search/architecture/coverage/changes/compare/adr/docgen/mcp/cli 冒烟）；tsc exit 0；oxlint 0 warnings
- **结论**：通过### [2026-09-12T10:07:40.502Z] ff_codebase trace+arch+coverage+changes+docgen + vitest 239 + tsc + oxlint
- **命令**：`ff_codebase trace+arch+coverage+changes+docgen + vitest 239 + tsc + oxlint`
- **退出码**：0
- **输出摘要**：trace BFS / arch 80 modules / coverage 45721 nodes / changes 5 / docgen skeleton + 239 tests + tsc 0 + oxlint 0 all exit 0
- **结论**：通过