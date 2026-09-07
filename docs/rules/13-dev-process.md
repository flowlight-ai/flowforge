# 第十三部分：软件工程化流程规范（铁律）

> **来源**：EP0 工程化流程插件 `@flowforge/plugin-dev`（`packages/plugins/dev`）
> **依据**：operator 2026-09-07 指令——工程化流程为第一优先级，融合 flowforge / devforge / superpowers / clowder-ai 四项目思想
> **强制等级**：⛔ 违反即作废。本仓库一切需求开发（代码与文档）必须走本流程
> **关联**：[doc:process/README.md]（流程总览）｜[doc:rules/11-doc-layering.md]（静态文档分层）｜[doc:refactor/04-code-standards.md]（TS 编码规范）

---

## 13.1 双平面架构（状态契约的核心设计）

| 平面 | 载体 | 职责 |
|---|---|---|
| **Plane 1 文档资产层** | `docs/process/`（14 份流程指令资产 + 4 类模板 + 产物目录） | harness 无关：任何 AI 工具直接阅读执行 |
| **Plane 2 插件执行层** | `packages/plugins/dev`（`@flowforge/plugin-dev`） | 七阶段状态机、四工作流模板、门禁校验、`ff_` CLI、证据采集 |

**状态契约**：流程实例状态落盘在 `docs/process/instances/<name>.json`（**状态在文件不在会话**）。
换 AI 工具 / 换 LLM 模型 / 换会话，凭 `ff_dev resume` 均可从中断处无损接续——这是双向互操作的基础。

## 13.2 七阶段脊柱（不允许跳过或倒退）

```
requirement（需求） → design（设计） → plan（计划） → implement（实现）
                     → review（审查） → verify（验证） → finish（收尾）
```

**三道硬门禁**（由 `ff_dev advance/gate/evidence` 把守，不满足即非零退出拒绝迁移）：

| 门禁 | 规则 | 违反后果 |
|---|---|---|
| design → plan | 设计文档未经操作者签核（DCP 评估型门禁登记） | 状态机拒绝迁移 |
| plan → implement | 实施计划未通过 No-Placeholder 校验（含占位符/无测试步骤/任务头五要素缺失） | 状态机拒绝迁移 |
| verify → finish | 未记录验证证据（命令/退出码/输出摘要） | 状态机拒绝迁移 |

**四工作流模板**（同一脊柱，仅门禁与产物期望不同）：
`greenfield`（0→1 孵化）/ `feature`（标准功能）/ `change`（既有功能变更）/ `hotfix`（线上修复，design/plan 门禁 fastpass，**verify 硬门禁永不豁免**）。

## 13.3 ff_ 命令族（工具无关的 CLI 契约）

任何 AI 工具开发本仓库，动手写第一行代码前必须：

1. 读 `docs/process/README.md`（流程总览 + 方法论资产索引）；
2. 执行 `node packages/plugins/dev/bin/ff_dev.mjs resume`——有活跃实例按简报接续，无实例 `ff_dev init <name> --workflow feature|greenfield|change|hotfix` 创建。

| 命令 | 语义 |
|---|---|
| `ff_dev init <name> [--workflow ...]` | 创建流程实例（落盘 instances/） |
| `ff_dev status [name]` / `advance <name>` | 查看状态 / 推进下一阶段（门禁校验） |
| `ff_dev gate <name> <design\|plan\|verify> [...]` | 开门禁并登记证据/评分 |
| `ff_dev evidence <name> --command "..." --exit 0 --summary "..."` | 记录验证证据 |
| `ff_dev resume [name]` | **接续简报**（当前阶段/门禁状态/下一步 + skills 资产路径） |
| `ff_doctor plan\|state\|docs\|all` | 遵从度检查（CI 与 mgr 拦截依赖） |

**退出码契约**（CI 与脚本依赖此契约，不可变更）：`0` = 合规/成功；`1` = 违规/门禁拒绝；`2` = 用法错误。

## 13.4 产物路径（铁律）

| 阶段 | 产物 | 落点 | 命名 |
|---|---|---|---|
| design | 设计文档 | `docs/process/specs/` | `YYYY-MM-DD-<topic>-design.md` |
| plan | 实施计划 | `docs/process/plans/` | `YYYY-MM-DD-<feature>.md` |
| review | 审查记录（两阶段：spec 合规 + 代码质量，P1/P2/P3 分级） | `docs/process/reviews/` | `YYYY-MM-DD-<name>.md` |
| verify | 验证证据（命令/exit code/输出摘要/耗时/时间戳） | `docs/process/verifications/` | `<name>.md` |
| （全程） | 实例状态 | `docs/process/instances/` | `<name>.json` |

**No-Placeholder 铁律**：实施计划禁止 TBD/TODO/待补充占位符、"类似任务 N"式惰性引用、无代码块步骤、任务头五要素（Goal/Architecture/Tech Stack/Spec 引用/Global Constraints）缺失。校验器：`ff_doctor plan`。

## 13.5 遵从度五层保障（"提示词可以不听，CI 不放行"）

| 层 | 手段 | 强度 |
|---|---|---|
| L0 入口引导 | `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` 三件套 | 软 |
| L1 方法论资产 | `docs/process/skills/` 14 份 | 软 |
| L2 状态机门禁 | `ff_dev advance` 拒绝无证据推进 | 硬（工具内） |
| L3 本地 Git 拦截 | mgr 提交前跑 `ff_doctor`（EP0-6 后续批次实施，决策点 D5） | 硬（本地） |
| L4 CI 强制拦截 | `.github/workflows/ts-ci.yml`：typecheck + vitest + `ff_doctor all`，PR 必须 | **硬（远端）** |

## 13.6 与既有规范的关系（引用优先级）

1. **本规范**（13-dev-process）管"动态时序"——什么时候能进入下一阶段；
2. [doc:rules/11-doc-layering.md] 管"静态结构"——文档写在哪、分几层（F/A/D 分层内嵌于 design/plan 模板）；
3. [doc:refactor/04-code-standards.md] 管"编码质量"——TS 包结构/命名/测试要求（其批次交付流程衔接 forgeProcess）；
4. `docs/git-workflow.md` + 根目录 `AGENTS.md` 管"Git 协作"——mgr 命令/PR 规范/署名（finish 阶段产物）；
5. 测试铁律 T1-T9（`docs/rules/test-iron-rules.md`）管"测试纪律"——已融入 ⑥ TDD / ⑩ 完成前验证两份 skills 资产。

冲突时**以我方规范优先**（flowforge 规范 → dsh 规范 → clowder 规范，见 [doc:refactor/03-fusion-strategy.md]）。

## 13.7 流程切换声明（2026-09-07 生效）

自本规范发布起：**所有批次（EP1-EP4 及一切后续需求）交付必须走 plugin-dev 七阶段流程**。
存量文档与存量代码的回补治理按"改动哪块、治理哪块"节奏执行（决策点 D2），台账见 `docs/process/governance.md`。
