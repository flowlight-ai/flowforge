/**
 * @flowforge/plugin-dev — workflow profiles (EP0-3).
 *
 * Four workflow templates over the fixed seven-phase spine
 * (requirement → design → plan → implement → review → verify → finish),
 * fused from devforge's `config/workflows/*.yaml`: the spine never changes,
 * a profile only changes artifact expectations, DCP/TR decision-gate
 * configurations, and fastpass semantics. Gate numbers are carried over from
 * devforge verbatim.
 *
 * @module @flowforge/plugin-dev/workflows
 */

import type { ProcessPhase } from './state-machine.ts'

/** The four devforge workflow kinds. */
export type WorkflowKind = 'greenfield' | 'feature' | 'change' | 'hotfix'

export const WORKFLOW_KINDS: readonly WorkflowKind[] = ['greenfield', 'feature', 'change', 'hotfix']

/** One weighted evaluation dimension of a decision gate. */
export interface DecisionGateDimension {
  readonly name: string
  readonly weight: number
  readonly threshold: number
}

/** DCP/TR evaluatable gate (devforge `gate_config`), anchored at a phase end. */
export interface DecisionGateConfig {
  readonly id: 'dcp1' | 'dcp2' | 'tr1' | 'dcp3' | 'dcp1_hotfix'
  readonly label: string
  /** The gate guards the transition OUT of this phase. */
  readonly phase: ProcessPhase
  readonly dimensions: readonly DecisionGateDimension[]
  readonly passThreshold: number
  readonly vetoDimensions: readonly string[]
  readonly humanRequired: boolean
  readonly rejectRetries: number
  readonly rejectFallback: 'terminate' | 'escalate' | 'rollback'
  /** hotfix release gate only: pass automatically when the review times out. */
  readonly autoPassOnTimeout?: boolean
}

/** Per-workflow overrides of the spine's boolean hard gates. */
export interface FastpassConfig {
  /**
   * hotfix：design→plan 门禁降级为"根因分析记录"（bug 报告即需求、根因即设计）。
   * verify 硬门禁【永不】豁免。
   */
  readonly design: boolean
  /** hotfix：plan→implement 降级为快速模式（No-Placeholder fastpass）。 */
  readonly plan: boolean
}

/** A complete workflow profile. */
export interface WorkflowProfile {
  readonly kind: WorkflowKind
  readonly label: string
  readonly description: string
  readonly decisionGates: readonly DecisionGateConfig[]
  readonly fastpass: FastpassConfig
  /** greenfield：implement 并行轨道（代码实现 ∥ 测试生成）。 */
  readonly parallelImplement: boolean
  /** greenfield：review 降级链（AI 审查不可用 → 人工标记继续）。 */
  readonly reviewFallbackToHuman: boolean
  /** finish 阶段是否含部署+监控（hotfix 含 24h 监控与自动回滚）。 */
  readonly deployWithMonitoring: boolean
  /** 各阶段产物要求（简述，供 resume 简报与 doctor 提示）。 */
  readonly artifacts: Readonly<Record<ProcessPhase, readonly string[]>>
}

function phaseArtifacts(
  requirement: readonly string[],
  design: readonly string[],
  plan: readonly string[],
  implement: readonly string[],
  review: readonly string[],
  verify: readonly string[],
  finish: readonly string[],
): Readonly<Record<ProcessPhase, readonly string[]>> {
  return { requirement, design, plan, implement, review, verify, finish }
}

const FEATURE_ARTIFACTS = phaseArtifacts(
  ['需求清单（brainstorming ① 澄清分级）'],
  ['docs/process/specs/YYYY-MM-DD-<topic>-design.md（含 DCP-1/DCP-2 记录）'],
  ['docs/process/plans/YYYY-MM-DD-<feature>.md（No-Placeholder 校验 PASS）'],
  ['代码 + 测试（TDD 红绿循环；T1-T9 铁律）'],
  ['docs/process/reviews/<name>.md（两阶段：spec 合规 + 代码质量）'],
  ['docs/process/verifications/<name>.md（证据条目 + DCP-3 发布决策）'],
  ['mgr PR 合入 + 实例归档'],
)

export const WORKFLOW_PROFILES: Readonly<Record<WorkflowKind, WorkflowProfile>> = {
  feature: {
    kind: 'feature',
    label: '功能开发流程（标准）',
    description: '现有项目新功能：需求→设计→实现→评审→测试→发布（devforge feature.yaml 全门禁）',
    decisionGates: [
      {
        id: 'dcp1',
        label: 'DCP-1 需求决策',
        phase: 'requirement',
        dimensions: [
          { name: 'business_value', weight: 0.4, threshold: 0.5 },
          { name: 'feasibility', weight: 0.35, threshold: 0.6 },
          { name: 'security', weight: 0.25, threshold: 0.7 },
        ],
        passThreshold: 0.65,
        vetoDimensions: ['security'],
        humanRequired: false,
        rejectRetries: 2,
        rejectFallback: 'terminate',
      },
      {
        id: 'dcp2',
        label: 'DCP-2 方案决策',
        phase: 'design',
        dimensions: [
          { name: 'feasibility', weight: 0.5, threshold: 0.6 },
          { name: 'security', weight: 0.3, threshold: 0.7 },
          { name: 'ux', weight: 0.2, threshold: 0.5 },
        ],
        passThreshold: 0.7,
        vetoDimensions: ['security'],
        humanRequired: true,
        rejectRetries: 1,
        rejectFallback: 'escalate',
      },
      {
        id: 'tr1',
        label: 'TR-1 代码评审门禁',
        phase: 'review',
        dimensions: [
          { name: 'code_quality', weight: 0.6, threshold: 0.6 },
          { name: 'security', weight: 0.4, threshold: 0.7 },
        ],
        passThreshold: 0.65,
        vetoDimensions: ['security'],
        humanRequired: false,
        rejectRetries: 3,
        rejectFallback: 'escalate',
      },
      {
        id: 'dcp3',
        label: 'DCP-3 发布决策',
        phase: 'verify',
        dimensions: [
          { name: 'release_risk', weight: 0.4, threshold: 0.6 },
          { name: 'test_coverage', weight: 0.35, threshold: 0.8 },
          { name: 'security', weight: 0.25, threshold: 0.8 },
        ],
        passThreshold: 0.75,
        vetoDimensions: ['security'],
        humanRequired: true,
        rejectRetries: 1,
        rejectFallback: 'escalate',
      },
    ],
    fastpass: { design: false, plan: false },
    parallelImplement: false,
    reviewFallbackToHuman: false,
    deployWithMonitoring: true,
    artifacts: FEATURE_ARTIFACTS,
  },

  greenfield: {
    kind: 'greenfield',
    label: '0→1 孵化流程',
    description: '新项目/新子系统：需求分析出架构，并行开发（代码∥测试），AI 审查→人工降级链',
    decisionGates: [
      {
        id: 'dcp1',
        label: 'DCP-1 需求决策',
        phase: 'requirement',
        dimensions: [
          { name: 'business_value', weight: 0.4, threshold: 0.5 },
          { name: 'feasibility', weight: 0.4, threshold: 0.6 },
          { name: 'security', weight: 0.2, threshold: 0.7 },
        ],
        passThreshold: 0.65,
        vetoDimensions: ['security'],
        humanRequired: false,
        rejectRetries: 2,
        rejectFallback: 'terminate',
      },
      {
        id: 'dcp2',
        label: 'DCP-2 方案（架构）决策',
        phase: 'design',
        dimensions: [
          { name: 'feasibility', weight: 0.5, threshold: 0.6 },
          { name: 'security', weight: 0.3, threshold: 0.7 },
          { name: 'ux', weight: 0.2, threshold: 0.5 },
        ],
        passThreshold: 0.7,
        vetoDimensions: ['security'],
        humanRequired: true,
        rejectRetries: 1,
        rejectFallback: 'escalate',
      },
      {
        id: 'tr1',
        label: '质量关卡（含降级链）',
        phase: 'review',
        dimensions: [
          { name: 'code_quality', weight: 0.6, threshold: 0.6 },
          { name: 'security', weight: 0.4, threshold: 0.7 },
        ],
        passThreshold: 0.65,
        vetoDimensions: ['security'],
        humanRequired: false,
        rejectRetries: 3,
        rejectFallback: 'escalate',
      },
    ],
    fastpass: { design: false, plan: false },
    parallelImplement: true,
    reviewFallbackToHuman: true,
    deployWithMonitoring: true,
    artifacts: phaseArtifacts(
      ['需求清单（brainstorming ① 澄清分级；含验收标准）'],
      ['docs/process/specs/YYYY-MM-DD-<topic>-design.md（架构基座：SRS→SAD→SDD 递进，12 号规范）'],
      ['docs/process/plans/YYYY-MM-DD-<feature>.md（任务级 No-Placeholder 校验 PASS）'],
      ['代码 ∥ 测试生成（并行轨道，⑤ 资产调度）'],
      ['docs/process/reviews/<name>.md（AI 审查不可用时人工标记降级记录）'],
      ['docs/process/verifications/<name>.md（全量测试证据）'],
      ['mgr PR 合入 + 实例归档'],
    ),
  },

  change: {
    kind: 'change',
    label: '变更请求流程（轻量门禁）',
    description: '现有功能变更/重构：DCP-1 变更决策（无人工）→ DCP-2（无人工）→ TR-1；无 DCP-3 发布门',
    decisionGates: [
      {
        id: 'dcp1',
        label: 'DCP-1 变更决策',
        phase: 'requirement',
        dimensions: [
          { name: 'business_value', weight: 0.4, threshold: 0.5 },
          { name: 'feasibility', weight: 0.4, threshold: 0.6 },
          { name: 'security', weight: 0.2, threshold: 0.7 },
        ],
        passThreshold: 0.6,
        vetoDimensions: ['security'],
        humanRequired: false,
        rejectRetries: 1,
        rejectFallback: 'terminate',
      },
      {
        id: 'dcp2',
        label: 'DCP-2 方案决策（变更）',
        phase: 'design',
        dimensions: [
          { name: 'feasibility', weight: 0.55, threshold: 0.6 },
          { name: 'security', weight: 0.45, threshold: 0.7 },
        ],
        passThreshold: 0.65,
        vetoDimensions: ['security'],
        humanRequired: false,
        rejectRetries: 1,
        rejectFallback: 'escalate',
      },
      {
        id: 'tr1',
        label: 'TR-1 代码评审门禁（变更）',
        phase: 'review',
        dimensions: [
          { name: 'code_quality', weight: 0.6, threshold: 0.6 },
          { name: 'security', weight: 0.4, threshold: 0.7 },
        ],
        passThreshold: 0.65,
        vetoDimensions: ['security'],
        humanRequired: false,
        rejectRetries: 2,
        rejectFallback: 'escalate',
      },
    ],
    fastpass: { design: false, plan: false },
    parallelImplement: false,
    reviewFallbackToHuman: false,
    deployWithMonitoring: false,
    artifacts: FEATURE_ARTIFACTS,
  },

  hotfix: {
    kind: 'hotfix',
    label: '热修复流程（快速通道）',
    description: 'Bug 修复：根因分析→修复与测试→TR-1 快速评审→紧急部署→发布决策→24h 监控+自动回滚。' +
      'design/plan 门禁 fastpass（根因分析记录/复现测试计划），verify 硬门禁【永不豁免】',
    decisionGates: [
      {
        id: 'tr1',
        label: 'TR-1 快速代码评审',
        phase: 'review',
        dimensions: [{ name: 'code_quality', weight: 1.0, threshold: 0.5 }],
        passThreshold: 0.5,
        vetoDimensions: [],
        humanRequired: false,
        rejectRetries: 1,
        rejectFallback: 'escalate',
      },
      {
        id: 'dcp1_hotfix',
        label: 'DCP 发布决策（热修复）',
        phase: 'verify',
        dimensions: [{ name: 'release_risk', weight: 1.0, threshold: 0.3 }],
        passThreshold: 0.3,
        vetoDimensions: [],
        humanRequired: true,
        rejectRetries: 1,
        rejectFallback: 'rollback',
        autoPassOnTimeout: true,
      },
    ],
    fastpass: { design: true, plan: true },
    parallelImplement: false,
    reviewFallbackToHuman: false,
    deployWithMonitoring: true,
    artifacts: phaseArtifacts(
      ['bug 报告 + 根因分析（systematic-debugging ⑨ 四阶段，含复现）'],
      ['修复方案（fastpass：根因分析记录即设计，可并入 requirement 产物）'],
      ['复现测试计划（fastpass：先写复现测试再修复，⑨ 阶段 4-1）'],
      ['修复 + 回归测试（TDD 红-绿：还原修复必须复现失败）'],
      ['docs/process/reviews/<name>.md（TR-1 快速评审，单维 0.50）'],
      ['docs/process/verifications/<name>.md（回归证据 + DCP 发布决策，超时自动通过需审计日志）'],
      ['紧急部署 + 24h 监控（异常自动回滚）+ mgr PR'],
    ),
  },
}

/** Look up a workflow profile; throws on unknown kinds. */
export function getWorkflowProfile(kind: WorkflowKind | string): WorkflowProfile {
  const profile = WORKFLOW_PROFILES[kind as WorkflowKind]
  if (profile === undefined) {
    throw new Error(
      `unknown workflow kind '${kind}' (expected one of ${WORKFLOW_KINDS.join(', ')})`,
    )
  }
  return profile
}

/** Decision gates anchored at the end of the given phase (in profile order). */
export function gatesForPhase(
  profile: WorkflowProfile,
  phase: ProcessPhase,
): readonly DecisionGateConfig[] {
  return profile.decisionGates.filter(gate => gate.phase === phase)
}
