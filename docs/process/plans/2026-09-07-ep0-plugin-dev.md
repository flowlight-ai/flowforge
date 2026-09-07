# 实施计划：EP0 工程化流程插件 @flowforge/plugin-dev

**目标**：交付 `@flowforge/plugin-dev` 插件与 `docs/process/` 流程资产，实现四项目思想融合的标准化工程交付，任何 AI 智能体可按七阶段流程规范交付需求（实例：ep0-plugin-dev）。

**架构**：双平面——Plane 1 `docs/process/`（harness 无关资产）+ Plane 2 `packages/plugins/dev`（状态机/门禁/CLI）；状态契约落盘 `docs/process/instances/<name>.json` 支持跨工具接续。

**技术栈**：TypeScript（ESM，tsx 直跑）、vitest、零运行时依赖 CLI（手写参数解析）、GitHub Actions（ts-ci.yml）。

**规格**：`docs/process/specs/2026-09-07-ep0-plugin-dev-design.md`（本实例设计文档）；`docs/refactor/33-stage-ep0-plugin-dev.md`（完整方案）。

## 全局约束

- 提交一律走 ./mgr PR，禁止直接 push 远端。
- 测试遵守 T1-T9：禁止 Mock LLM、禁止无断言测试、禁止假数据。
- 单文件 ≤ 1000 行；Plane 1 与 Plane 2 同批更新。
- 退出码契约 0/1/2 不可变更（CI 与脚本依赖）。

### 任务 1：插件内核（状态机 + 注册表 + 持久化 + 工作流）

- [x] 步骤 1：写失败测试 tests/dev.spec.ts，断言状态机拒绝跳段与无门禁推进。
- [x] 步骤 2：实现 state-machine.ts / registry.ts / persistence.ts / workflows.ts（下方接口契约）。
- [x] 步骤 3：跑 pnpm vitest run 确认测试通过后走 ./mgr sync 提交（PR #152 已合入）。

```ts
export const PROCESS_TRANSITIONS: readonly ProcessTransition[] = [
  { from: 'design', to: 'plan', requiresGate: 'designApproved' },
  { from: 'plan', to: 'implement', requiresGate: 'planValidated' },
  { from: 'verify', to: 'finish', requiresGate: 'verificationEvidence' },
]
```

```ts
export interface WorkflowProfile {
  readonly kind: WorkflowKind
  readonly decisionGates: readonly DecisionGateConfig[]
  readonly fastpass: { readonly design: boolean; readonly plan: boolean }
}
```

### 任务 2：ff_ CLI 命令族 + No-Placeholder 校验器 + 遵从度检查

- [x] 步骤 1：写失败测试 tests/cli.spec.ts 与 tests/plan-validator.spec.ts，覆盖 doctor 四模式正反例与占位符拦截。
- [x] 步骤 2：实现 cli/main.ts（init/status/advance/gate/evidence/resume/snapshot）与 cli/doctor.ts（plan/state/docs/all）。
- [x] 步骤 3：跑 pnpm vitest run 确认 87 项测试通过，typecheck 通过后提交。

```ts
export function validatePlan(markdown: string, options: { fastpass?: boolean } = {}): PlanValidationResult {
  const lines = markdown.split(/\r?\n/)
  const { prose } = splitFences(lines)
  const errors: PlanIssue[] = []
  scanPlaceholders(prose, errors)
  scanLazyReferences(prose, errors)
  checkRequiredHeaders(lines, errors)
  checkTasks(lines, errors, options.fastpass)
  return { passed: errors.length === 0, errors, warnings: [], taskCount: tasks.length }
}
```

### 任务 3：证据采集 + 两阶段审查协议 + dispatcher 编排

- [x] 步骤 1：写失败测试 tests/evidence 对应 spec、tests/review-protocol.spec.ts、tests/dispatcher.spec.ts。
- [x] 步骤 2：实现 evidence.ts（verifications/<name>.md 追加）、review-protocol.ts（DCP/TR 门禁评估 + P1/P2/P3）、dispatcher.ts（NullDispatcher 人工降级）。
- [x] 步骤 3：跑 pnpm vitest run 确认测试通过后提交。

```ts
export function evaluateGate(gate: DecisionGateConfig, scores: Readonly<Record<string, number>>): GateEvaluationResult {
  const passed = rounded >= gate.passThreshold && failedDimensions.length === 0 && !vetoed
  return { gateId: gate.id, passed, weightedScore: rounded, failedDimensions, vetoed, reason }
}
```

### 任务 4：遵从度体系落地（入口三件套 + CI 硬拦截 + 规范回填）

- [x] 步骤 1：同步 AGENTS.md / CLAUDE.md / GEMINI.md 三件套为统一内容（含 ff_dev resume 开工第一步）。
- [x] 步骤 2：新增 .github/workflows/ts-ci.yml：typecheck + vitest + ff_doctor all 三道硬拦截。
- [x] 步骤 3：新增 docs/rules/13-dev-process.md 铁律并回填 docs/AGENTS.md、04-code-standards.md §6；跑 pnpm vitest run 确认 87 项测试通过、ff_doctor all 确认合规后走 ./mgr sync 提交。

```yaml
- name: Process compliance (ff_doctor all)
  run: node packages/plugins/dev/bin/ff_doctor.mjs all --repo .
```
