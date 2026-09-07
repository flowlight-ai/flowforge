# FlowForge 软件工程化流程（docs/process/）

> 来源：EP0 工程化流程插件 `@flowforge/plugin-dev`（Plane 1 文档资产层）。
> 移植自 superpowers 工程方法论，融合我方规范（mgr git 流程、测试铁律 T1-T9、文档分层管理）。
> 任务依据：`docs/refactor/33-stage-ep0-plugin-dev.md`（T0.1.6/T0.1.7）。

## 1. 定位：双平面架构

本目录是流程体系的 **Plane 1（文档资产层）**，与 **Plane 2（插件执行层）** 正交互补：

| 平面 | 载体 | 职责 |
|---|---|---|
| **Plane 1 — 文档资产层** | `docs/process/`（本目录） | harness 无关的流程方法论与文档模板，任何 AI 工具（Claude Code / Codex / Copilot CLI / Gemini CLI / flowforge 自身）均可直接阅读执行 |
| **Plane 2 — 插件执行层** | `packages/plugins/dev`（`@flowforge/plugin-dev`） | flowforge 原生自动化：七阶段流程状态机、门禁校验、实例注册表、CLI 命令、子代理调度 |

**分工原则**：流程插件管"动态时序"（什么时候能进入下一阶段），`docs/rules/11-doc-layering` 管"静态结构"（文档写在哪、分几层）。两者正交，互不替代。

## 2. 七阶段交付流程

所有需求（文档交付与代码交付）一律走以下七个阶段，不允许跳过或倒退：

```
requirement（需求） → design（设计） → plan（计划） → implement（实现）
                     → review（审查） → verify（验证） → finish（收尾）
```

**三道硬门禁（gate）**：

| 门禁 | 规则 | 违反后果 |
|---|---|---|
| design → plan | 设计文档未经操作者签核，禁止编写实施计划 | 状态机拒绝迁移（`ProcessTransitionError`） |
| plan → implement | 实施计划未通过校验（含占位符、无测试步骤），禁止写实现代码 | 状态机拒绝迁移 |
| verify → finish | 未记录验证证据（命令、退出码、输出摘要），禁止宣称完成 | 状态机拒绝迁移 |

## 3. 目录索引

```
docs/process/
├── README.md                  # 本文件：双平面说明 + 七阶段流程图 + 使用指引
├── governance.md              # 存量治理台账（EP0-7 盘点基线 + 治理进度）
├── skills/                    # 14 份流程指令资产（Plane 1 核心）
│   ├── using-plugin-dev.md             # ⑭ 流程插件入口（先读这个）
│   ├── brainstorming.md               # ① 需求头脑风暴（requirement/design 阶段）
│   ├── writing-plans.md                # ② 编写实施计划（plan 阶段）
│   ├── executing-plans.md             # ③ 执行计划（implement 阶段）
│   ├── subagent-driven-development.md # ④ 子代理驱动开发（implement 阶段）
│   ├── dispatching-parallel-agents.md # ⑤ 并行子代理调度（implement 阶段）
│   ├── test-driven-development.md     # ⑥ 测试驱动开发（implement 阶段）
│   ├── systematic-debugging.md        # ⑨ 系统化调试（implement 阶段）
│   ├── using-git-worktrees.md         # ⑪ Git worktree 隔离开发（implement 前置）
│   ├── requesting-code-review.md      # ⑦ 发起代码审查（review 阶段）
│   ├── receiving-code-review.md       # ⑧ 接收代码审查（review 阶段）
│   ├── verification-before-completion.md # ⑩ 完成前验证（verify 阶段）
│   ├── finishing-a-development-branch.md # ⑫ 完成开发分支（finish 阶段）
│   └── writing-skills.md              # ⑬ 编写技能（元方法论，资产自身迭代）
├── templates/                 # 4 类产物模板（design/plan/review/verification）
├── specs/                     # 设计文档产物（brainstorming 产物，YYYY-MM-DD-<topic>-design.md）
├── plans/                     # 实施计划产物（writing-plans 产物，YYYY-MM-DD-<feature>.md）
├── reviews/                   # 审查记录产物（两阶段审查，P1/P2/P3 分级）
├── verifications/             # 验证证据产物（命令/exit code/输出摘要/耗时/时间戳）
└── instances/                 # 流程实例状态（<name>.json，状态契约——跨工具/跨会话接续）
```

## 3a. ff_ 命令族与状态契约（Plane 2 执行入口）

四工作流模板（同一脊柱，门禁与产物期望不同）：`greenfield`（0→1）/ `feature`（标准）/ `change`（变更）/ `hotfix`（修复，verify 硬门禁永不豁免）。

```sh
node packages/plugins/dev/bin/ff_dev.mjs resume            # 接续简报（任何工具开工第一步）
node packages/plugins/dev/bin/ff_dev.mjs init <name> --workflow feature|greenfield|change|hotfix
node packages/plugins/dev/bin/ff_dev.mjs status [name]     # 实例状态（阶段/门禁/产物/工作流）
node packages/plugins/dev/bin/ff_dev.mjs advance <name>    # 推进（三道硬门禁校验，拒绝即非零退出）
node packages/plugins/dev/bin/ff_dev.mjs gate <name> <design|plan|verify> [--score N --evidence <path> --approver <who>]
node packages/plugins/dev/bin/ff_dev.mjs evidence <name> --command "..." --exit 0 --summary "..."
node packages/plugins/dev/bin/ff_doctor.mjs all            # 遵从度检查（CI ts-ci.yml 硬拦截项）
```

**状态契约**：实例状态落盘 `instances/<name>.json`（状态在文件不在会话）——flowforge 主导开发换智能体/换模型接续（场景 1）、外部 AI 工具主导开发接续（场景 2），均凭 `ff_dev resume` 从中断处无损继续。退出码契约：`0`=合规 / `1`=违规 / `2`=用法错误（CI 与脚本依赖）。

规范铁律详见 `docs/rules/13-dev-process.md`；存量治理台账见 `governance.md`。

## 4. 阶段 ↔ 指令资产映射

| 阶段 | 主资产 | 辅助资产 | 产物落点 |
|---|---|---|---|
| requirement | brainstorming ① | using-plugin-dev ⑭ | （澄清记录，或直接并入 design） |
| design | brainstorming ①（架构路径） | — | `specs/YYYY-MM-DD-<topic>-design.md` |
| plan | writing-plans ② | — | `plans/YYYY-MM-DD-<feature>.md` |
| implement | executing-plans ③ / subagent-driven-development ④ | TDD ⑥、debugging ⑨、worktrees ⑪、parallel-agents ⑤ | 代码 + 测试 |
| review | requesting-code-review ⑦ | receiving-code-review ⑧ | `reviews/` |
| verify | verification-before-completion ⑩ | — | `verifications/` |
| finish | finishing-a-development-branch ⑫ | — | mgr PR + 分支清理 |
| （横切） | writing-skills ⑬ | — | 流程资产自身的迭代 |

## 5. 任何 AI 工具如何使用本目录资产

1. **会话开始**：先读 `skills/using-plugin-dev.md`（⑭ 流程插件入口），确认当前任务属于哪个阶段。
2. **按阶段取用**：进入某阶段前，通读该阶段的主资产与辅助资产，再开始工作。
3. **门禁自查**：跨阶段推进前，对照 §2 三道硬门禁自查；不满足则停在当前阶段补齐。
4. **规范优先级**：本目录资产与 `docs/rules/`（编码规范、红线）、`docs/mgr/`（git 流程）、测试铁律 T1-T9 冲突时，**以我方规范优先**（详见每份资产的"与我方规范对接"一节）。
5. **产物落点**：各阶段产物一律写入 §3 目录索引中的对应目录，命名遵循 `YYYY-MM-DD-<topic>` 约定。

## 6. 与静态文档分层的关系

`docs/` 现有 SRS/SAD/SDD 静态分层规范（`docs/rules/11-doc-layering`）描述的是"文档长什么样、放在哪里"；本目录描述的是"先做什么、后做什么、什么时候被门禁拦住"。一次需求交付中：

- **静态分层**决定 design/plan 文档的内部结构与归档位置（F/A/D 分层）；
- **工程化流程**决定从需求到收尾的推进时序与质量门禁。

两者叠加使用，不冲突、不重复。
