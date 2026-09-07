# FlowForge 重构任务总注册表与进度（EP0-EP4）

> **本文档作用**：TS 重构剩余全部工作的任务注册与进度跟踪单一事实来源（勾选状态）。
> 任务内容登记以 `review_code.md` §13 为准（含来源编号 A/B/D/C/F），EP0 详细任务清单以
> `33-stage-ep0-plugin-dev.md` 为准（T0.x.y 级 checklist），本文件负责**进度状态**的统一维护。
>
> **维护规则**：
> - 每完成一个批次/任务：在本文件勾选 ✅ 并标注 PR 号与完成日期；同步勾选 `10-stage-map.md` §3.0 矩阵。
> - EP0 完成后，所有批次交付必须走 forgeProcess 七阶段流程（design→plan→implement→review→verify→finish→mgr PR）。
> - 待 operator 决策项（⚠）见 `review_code.md` §15，不阻塞已裁决批次。
>
> 状态图例：⬜ 未开始 ｜ 🟦 进行中 ｜ ✅ 完成（含 PR 号）｜ ⚠ 待 operator 裁决后排期

---

## EP0 工程化流程插件 `@flowforge/plugin-dev`（最高优先级，5 批次）

> operator 2026-09-07 裁决（Q7/Q8/Q9）：插件定名 `@flowforge/plugin-dev`，包路径 `packages/plugins/dev`，
> 流程文档自 `docs/process/` 起步；四源全量移植（flowforge Python 旧版 + dsh + clowder-ai + superpowers）。

| 批次 | 内容 | DoD | 状态 |
|---|---|---|---|
| EP0-1 | 插件骨架（状态机/实例注册表/类型面）+ `docs/process/` 建立 + 14 份流程指令资产移植 | 状态机单测全绿；14 份资产入库 | 🟩 |
| EP0-2 | 4 份文档模板（design/plan/review/verification）+ No-Placeholder 校验器 + 单测 | 校验器拦截 TBD/TODO/无代码块步骤 | 🟩 |
| EP0-3 | `ff_` CLI 命令族（operator 指令替换 `flowforge process *` 前缀）+ 四工作流模板 + 实例持久化 + 门禁接线 | CLI 端到端冒烟 + 门禁单测 | 🟩 |
| EP0-4 | ff_doctor 遵从度四模式 + 入口三件套 + ts-ci.yml + subagent 派发编排（NullDispatcher 降级）+ 两阶段审查（P1/P2/P3）+ verification 证据采集 | 真实小需求走完七阶段验收（实例 `ep0-plugin-dev` 7/7 完结，`ff_doctor all` 合规） | 🟩 |
| EP0-5 | 规范回填（`docs/rules/13-dev-process.md` + AGENTS.md 三件套 + 04-code-standards 联动）+ 流程切换声明 + 存量治理基线 | 规范体系更新；此后所有批次走 forgeProcess | 🟩 |

> EP0 全批次完成（2026-09-07）。遗留接线项：`ctx.forgeProcess` cordis 挂载与 mgr 前置 `ff_doctor`（D5）
> 随 harness/mgr 独立批次实施；存量文档/代码治理（T0.7.2/T0.7.3）按 D2 节奏并入 EP1-EP4（台账
> `docs/process/governance.md`）。此后所有批次交付必须走 forgeProcess 七阶段流程（`docs/rules/13-dev-process.md` §13.7）。

### EP0-1 细化任务（T0.x.y，详见 `33-stage-ep0-plugin-dev.md`）

- [x] T0.1.1 `packages/plugins/dev/package.json`（@flowforge/plugin-dev，ESM，对齐 canary/modes 包形态）
- [x] T0.1.2 `tsconfig.json` + 根 `tsconfig.host.json` references 增补
- [x] T0.1.3 `src/state-machine.ts`：七阶段 ProcessPhase + 合法迁移表 + 三道门禁 + ForgeProcessStateMachine
- [x] T0.1.4 `src/registry.ts`：ForgeProcessRegistry（create/get/list + 产物路径登记）
- [x] T0.1.5 `src/index.ts` 导出面 + `tests/dev.spec.ts`（合法推进/非法跳转/门禁三例/registry round-trip，16/16 绿）
- [x] T0.1.6 `docs/process/README.md`（双平面说明/目录索引/七阶段流程图/AI 工具使用指引）
- [x] T0.1.7 移植 14 份流程指令资产至 `docs/process/skills/`（①brainstorming ②writing-plans ③executing-plans
      ④subagent-driven-development ⑤dispatching-parallel-agents ⑥test-driven-development
      ⑦requesting-code-review ⑧receiving-code-review ⑨systematic-debugging ⑩verification-before-completion
      ⑪using-git-worktrees ⑫finishing-a-development-branch ⑬writing-skills ⑭using-plugin-dev）
- [x] T0.1.8 `pnpm vitest run packages/plugins/dev` 全绿 + `pnpm typecheck` 通过
- [x] T0.1.9 `10-stage-map.md` §3.0 勾选（P1-P4）+ 本文件进度更新
- [x] T0.1.10 `./mgr sync` 提交 PR（docs + code 同批，commit `5af3c6c3` → PR #152）

---

## EP1 三源 P0 遗漏项移植（16 项，约 14 批次）

> 内容与来源编号见 `review_code.md` §13.2；⚠ 项（Q1/Q3/Q5/Q6）需 EP1 前裁决。

| 序 | 任务 | 来源 | 预估批次 | 状态 |
|---|---|---|---|---|
| 1 | `mcp-server` 整包（工具治理全家 + 6 toolsets + protocol-server）⚠Q3 | B1 | 2 | ⬜ |
| 2 | `infrastructure/connectors` IM 框架本体 | B7 | 2 | ⬜ |
| 3 | `chat/messaging` 域（envelope/ledger/snapshot + Redis）⚠Q6 | B4 | 1 | ⬜ |
| 4 | `cats/signal-intake` 域（25+ 文件）⚠Q6 | B3 | 2 | ⬜ |
| 5 | `infrastructure/github-signals` 域 | B5 | 1 | ⬜ |
| 6 | `cats/context-assembly`（17 文件） | B12 | 1 | ⬜ |
| 7 | `api/session-controller` + `settings-controller` + `workspace-controller` | A1-A3 | 1 | ⬜ |
| 8 | `session-format` 4 包 + `session-log-export` | A17/A20 | 1 | ⬜ |
| 9 | `webhook` 2 包 | A29 | 1 | ⬜ |
| 10 | `credentials/authorization` | A8 | 0.5 | ⬜ |
| 11 | `extensions/ui-cordis` + `cordis-client-runner` | A9/A10 | 1 | ⬜ |
| 12 | `bundle/web-app`（+acp/sdk 模板） | A4-A7 | 1 | ⬜ |
| 13 | dsh `client/*` 能力级清单登记（归入 EP2 实施） | A32 | — | ⬜ |
| 14 | 矩阵补录：`10-stage-map.md` 增设 D45+/C43+/F45+ 编号 + crosswalk 漂移纠偏 | 文档 | 0.5 | 🟩（`10-stage-map.md` D45-D55/C43-C51/F45 补录 + crosswalk L31/L41/L59/L80 漂移纠偏 + D9/S1 表述勘误完成） |

---

## EP2 阶段 8 前端融合（批次 56-59 + dsh client 能力）

> 前置依赖：EP1-7（REST 控制器）+ EP1-12（web-app bundle）；⚠Q2（dsh client 46 包能力级融入）EP2 前确认。

| 序 | 任务 | 状态 |
|---|---|---|
| 1 | 批次 56：socket.io-client 实时通道 | ⬜ |
| 2 | 批次 57：xterm 终端面板 | ⬜ |
| 3 | 批次 58-59：Playwright 端到端 + 视觉回归 | ⬜ |
| 4 | Threads/群聊页 + @mention 菜单 + 线程分支交互 | ⬜ |
| 5 | dsh `client/*` 46 包能力级对照逐项融入 Next.js | ⬜ |

---

## EP3 阶段 9-10：集成回归 + 入口切换

| 序 | 任务 | 状态 |
|---|---|---|
| 1 | 阶段 9 全量集成回归（三源功能矩阵核对 + snapshots 预期输出体系 A36） | ⬜ |
| 2 | 阶段 10 入口切换：`flowforge` CLI 唯一入口，web 切换 TS 栈 | ⬜ |
| 3 | patches 体系补齐（A37：node-pty Windows 验证） | ⬜ |

---

## EP4 阶段 11：Python 日落 + stretch

| 序 | 任务 | 状态 |
|---|---|---|
| 1 | Python 遗留目录日落与删除（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`evolution/`、`harness/`、`sop/`、`sdk.py` 等） | ⬜ |
| 2 | stretch 项按裁决排期（S1 凭据启用 / S2 TTS/邮件推送 / S4 desktop / S6 Python SDK 等） | ⚠ |
| 3 | P1/P2 遗漏项收尾（A5-A7、A11、A13、A15-A16、A18-A19、A21-A23、A25-A28、A30-A31、B2、B6、B8-B9、B11、B13-B17、B19-B21、A35） | ⬜ |

---

## 待 operator 决策点（同步 `review_code.md` §15）

| # | 决策点 | 影响批次 |
|---|---|---|
| Q10/A | forgeProcess design 产物与 F/A/D 分层的衔接粒度 | EP0-3 后 |
| Q11/B | 流程层级映射（forgeProcess plan = 我方批次；superpowers task = 批次内 checklist） | EP0-3 后 |
| Q12/C | subagent 派发与六智能体署名的绑定规则 | EP0-4 前 |
| Q13/D | worktree 隔离 EP0 期可选、EP0-4 后评估是否强制 | EP0-4 后 |

---

> Agent Notes：本文件为**进度状态单一事实来源**。每完成一个批次：①勾选本文件对应条目 + PR 号；
> ②勾选 `10-stage-map.md` §3.0（EP0）或 §3.1-3.4（D/C/F 编号）；③EP0 后走 forgeProcess 七阶段交付。
