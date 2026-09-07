# EP0：软件工程化流程插件 `@flowforge/plugin-dev`（最高优先级，先于一切剩余开发）

> 目标：把 superpowers 工程化方法论（第四源）全量移植为 flowforge 独立插件（软件工程化流程插件），
> 建立"需求 → 设计 → 计划 → 实现 → 审查 → 验证 → 收尾"七阶段强制流程；此后 flowforge 所有
> 需求文档交付与需求代码交付全部基于该插件标准执行（operator 2026-09-07 指令，Q7/Q8/Q9 已裁决，
> 见 `review_code.md` §15）。计划总览见 `review_code.md` §11；任务总注册表见 `task.md`。
> 完成后按本文件"验收标准"逐条验收，并在 `10-stage-map.md` §3.0 勾选。

## 设计要点（摘自 review_code.md §11）

1. **双平面架构**：
   - **Plane 1 文档资产层**（harness 无关，任何 AI 工具可用）：`docs/process/` 下流程指令资产
     （14 份，superpowers skill 移植）+ 4 类文档模板（design/plan/review/verification）。
   - **Plane 2 插件执行层**（flowforge 原生自动化）：`packages/plugins/dev`
     （`@flowforge/plugin-dev`）提供流程状态机、门禁校验、CLI 命令面、subagent 编排。
2. **七阶段状态机**：`requirement → design → plan → implement → review → verify → finish`，
   实例持久化，非法跳转拒绝。
3. **与我方规范融合**（冲突裁决全文见 `review_code.md` §11.3）：
   - T1-T9 测试铁律最高（TDD 融入 implement 门禁；LLM 相关实现禁 Mock 优先）；
   - 出口必走 `./mgr sync` PR（保留 git-workflow 主导）；
   - 流程文档（design/plan）与 F/A/D 静态分层并行不冲突（结构 × 时序正交）；
   - 两阶段审查采用 clowder 交叉 review P1/P2/P3 分级格式。

## 任务清单（五批次）

### EP0-1 插件骨架 + 14 份流程指令资产（当前批次）

- [x] T0.1.1 `packages/plugins/dev/package.json`（`@flowforge/plugin-dev`，ESM，
      exports 指向 `lib/index.js` + `lib/types/index.d.ts`，对齐 canary/modes 包形态）
- [x] T0.1.2 `packages/plugins/dev/tsconfig.json`（extends `../../../tsconfig.base.json`，
      rootDir=src / outDir=lib/types）+ 根 `tsconfig.host.json` references 增补
      `"path": "./packages/plugins/dev"`
- [x] T0.1.3 `src/state-machine.ts`：七阶段 `ProcessPhase` + 合法迁移表 + 门禁校验
      （design 未签核禁止 plan / plan 未校验禁止 implement / verify 无证据禁止 finish）
      + `ForgeProcessStateMachine` 类（advance/guard/snapshot/restore）
- [x] T0.1.4 `src/registry.ts`：`ForgeProcessRegistry`（内存实例表 + 工厂 create/get/list
      + 产物路径登记 design/plan/review/verification artifact path）
- [x] T0.1.5 `src/index.ts` 导出面（类型 + 类 + 阶段常量），`tests/dev.spec.ts`
      覆盖：合法全流程推进 / 非法跳转拒绝 / 门禁拦截三例 / registry round-trip
      （16 个用例全绿）
- [x] T0.1.6 `docs/process/README.md`：双平面说明、目录索引、七阶段流程图、
      "任何 AI 工具如何使用本目录资产"指引
- [x] T0.1.7 移植 14 份流程指令资产至 `docs/process/skills/`（superpowers → flowforge
      适配：命名契约 P0 术语优先、对接 mgr 与 T1-T9、去除 Claude/Claude Code 专属措辞、
      每份含"触发时机/流程步骤/门禁/与我方规范对接"四节）：
      （前置：移除 `.gitignore` 对 `docs/process/` 的忽略——旧规则将其定位为
      "内部过程文档"，operator Q8 裁决后该目录为工程化流程资产层，必须入库）：
      ① `brainstorming.md` 需求头脑风暴
      ② `writing-plans.md` 编写实施计划（含 No Placeholders 铁律与任务模板）
      ③ `executing-plans.md` 执行计划（批次执行 + 检查点）
      ④ `subagent-driven-development.md` 子代理驱动开发（两阶段审查）
      ⑤ `dispatching-parallel-agents.md` 并行代理调度
      ⑥ `test-driven-development.md` 测试驱动开发（RED-GREEN-REFACTOR + T1 裁决）
      ⑦ `requesting-code-review.md` 发起代码审查
      ⑧ `receiving-code-review.md` 接收代码审查（P1/P2/P3 分级响应）
      ⑨ `systematic-debugging.md` 系统化调试（四阶段根因）
      ⑩ `verification-before-completion.md` 完成前验证（证据优先）
      ⑪ `using-git-worktrees.md` Git worktree 隔离开发
      ⑫ `finishing-a-development-branch.md` 完成开发分支（测试→mgr PR→清理）
      ⑬ `writing-skills.md` 编写技能（元方法论，服务流程资产自身迭代）
      ⑭ `using-plugin-dev.md` 流程插件入口（using-superpowers 的 flowforge 版）
- [x] T0.1.8 `pnpm vitest run packages/plugins/dev` 全绿 + `pnpm typecheck` 通过
      （16/16 通过；typecheck 中 dev 包 0 错误——`packages/chat/realtime` 的既有失败为
      未跟踪遗留文件所致，与本次无关）
- [x] T0.1.9 更新 `10-stage-map.md` §3.0（P1-P14 勾选 EP0-1 部分）+ `task.md` 进度
- [x] T0.1.10 `./mgr sync` 提交 PR（docs + code 同批）——commit `5af3c6c3`，
      PR #152（https://gitee.com/flowlight-ai/flowforge/pulls/152）

### EP0-2 文档模板 + No-Placeholder 校验器

- [ ] T0.2.1 `docs/process/templates/design-template.md`（目标/架构/技术栈/规范引用/全局约束/签核块）
- [ ] T0.2.2 `docs/process/templates/plan-template.md`（任务头：Goal/Architecture/Tech Stack/
      Spec 引用/Global Constraints + Task N 结构：Files/Interfaces/Steps checkbox 含 TDD 五步）
- [ ] T0.2.3 `docs/process/templates/review-template.md`（两阶段审查记录：spec 合规 + 代码质量，P1/P2/P3）
- [ ] T0.2.4 `docs/process/templates/verification-template.md`（验证证据：命令/exit code/输出摘要/时间戳）
- [ ] T0.2.5 `src/plan-validator.ts`：No-Placeholder 扫描（TBD/TODO/待补充/无代码块步骤/
      "类似任务 N"引用）+ plan 文档结构校验（任务头五要素 + checkbox 步骤存在）
- [ ] T0.2.6 `tests/plan-validator.spec.ts`（拦截正例 + 通过反例 + 边界）
- [ ] T0.2.7 `./mgr sync` 提交 PR

### EP0-3 CLI 命令面 + 门禁接线 + cordis 挂载

- [ ] T0.3.1 `src/service.ts`：`ForgeProcessService`（cordis 服务封装，挂载 `ctx.forgeProcess`，
      声明 inject/依赖，对齐 harness/boot 装配契约）
- [ ] T0.3.2 `apps/cli` 子命令 `flowforge process <new|design|plan|implement|review|verify|finish|status>`
      （参数：实例名/产物路径；落盘 `docs/process/instances/<name>.json` 状态快照）
- [ ] T0.3.3 门禁接线：`process plan` 前置校验 design 已签核；`process implement` 前置跑
      plan-validator；`process finish` 前置校验 verification 证据齐全
- [ ] T0.3.4 CLI 端到端冒烟测试（new→design→plan→implement→review→verify→finish 全链 + 门禁拒绝路径）
- [ ] T0.3.5 `./mgr sync` 提交 PR

### EP0-4 subagent 编排 + 两阶段审查 + 验证证据采集

- [ ] T0.4.1 `src/dispatcher.ts`：对接 `packages/subagent/subagent-ff-sdk`，
      每任务派发全新 subagent（署名绑定规则按 Q12 裁决结果）
- [ ] T0.4.2 `src/review-protocol.ts`：两阶段审查编排（阶段 1 spec 合规核对 / 阶段 2 代码质量），
      报告采用 P1/P2/P3 分级
- [ ] T0.4.3 `src/evidence.ts`：verification 证据采集（运行 vitest/pytest 命令、捕获 exit code
      与输出摘要、时间戳，写入 verification artifact）
- [ ] T0.4.4 端到端验收：以一个真实小需求走完七阶段（含全部产物文档）作为 DoD
- [ ] T0.4.5 `./mgr sync` 提交 PR

### EP0-5 规范回填 + 流程切换声明

- [ ] T0.5.1 新增 `docs/rules/13-dev-process.md`（软件开发流程铁律：七阶段时序/门禁/产物路径/
      AI 工具无关性要求/与 04-code-standards、git-workflow、T1-T9 的引用关系）
- [ ] T0.5.2 更新 `docs/AGENTS.md`：交付强制入口改为 forgeProcess 流程（保留既有条款，
      增补"新需求开发必须走 plugin-dev 七阶段"）
- [ ] T0.5.3 更新 `docs/refactor/04-code-standards.md` §2.7：批次交付与 forgeProcess 衔接
- [ ] T0.5.4 `10-stage-map.md` §3.0 全部 ✅ + `00-overview.md`/`task.md` 进度回填
- [ ] T0.5.5 切换声明：此后所有批次（EP1-EP4）交付必须走 forgeProcess 流程
- [ ] T0.5.6 `./mgr sync` 提交 PR

## 验收标准（EP0 整体）

1. `packages/plugins/dev` 可被 `apps/cli` 宿主装配，`ctx.forgeProcess` 服务可用（EP0-3 后）。
2. `docs/process/` 下 14 份流程指令资产 + 4 份模板齐全，任何 AI 工具可据此独立执行开发流程。
3. 七阶段状态机单测全绿：合法推进 / 非法跳转拒绝 / 三道门禁拦截 / 快照恢复。
4. plan-validator 能拦截占位符违规（TBD/TODO/无代码块步骤）。
5. 端到端验收：一个小需求从 requirement 到 finish 走完全流程，产物（design/plan/review/verification）
   齐备且通过 mgr PR 合入。
6. `docs/rules/13-dev-process.md` 生效，`docs/AGENTS.md` 完成流程切换声明。

## 提交信息模板

```
feat(plugins): EP0-x <批次要点> [sherlock]
docs(process): EP0-x 流程资产/规范回填 <要点> [sherlock]
```

## 风险备注

1. **Windows 长路径风险**：worktree 隔离（T0.1.7⑪ 资产内有方法论，但 EP0 期不强制启用，见决策点 D）。
2. **subagent-ff-sdk 契约变化**：EP0-4 对接时以该包当前导出面为准，若与设计不符先在批次内对齐再落码。
3. **流程采用率**：EP0-5 切换声明后，若 AI 工具跳过流程，靠 `process implement` 门禁拒绝落盘来兜底
   （门禁是硬约束，声明是软约束）。
4. **双平面一致性**：Plane 1 资产（文档）与 Plane 2 实现（状态机语义）必须同批更新，
   禁止只改文档不改实现（反之亦然）。
