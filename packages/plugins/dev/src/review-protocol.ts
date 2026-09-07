/**
 * @flowforge/plugin-dev — two-stage review protocol (EP0-5 T0.5.2).
 *
 * Fuses clowder's cross-review protocol (P1/P2/P3 grading) with
 * subagent-driven-development's (④) dual verdict: stage 1 spec compliance +
 * stage 2 code quality — both required. Also machines devforge's DCP/TR
 * weighted gate evaluation (`evaluateGate`) so `ff_dev gate --score` and the
 * orchestrator share one formula.
 *
 * @module @flowforge/plugin-dev/review-protocol
 */

import type { DecisionGateConfig } from './workflows.ts'

/** clowder 分级：P1 阻断 / P2 技术缺陷 / P3 风格建议。 */
export type FindingSeverity = 'P1' | 'P2' | 'P3'

/** One review finding. */
export interface ReviewFinding {
  readonly severity: FindingSeverity
  readonly title: string
  readonly location?: string
  readonly disposition: 'fix-now' | 'fix-this-round' | 'deferred' | 'parked'
}

/** Result of grading a finding list against the protocol. */
export interface ReviewVerdict {
  /** false when any P1/P2 remains unfixed — the task is NOT done. */
  readonly passed: boolean
  readonly counts: Readonly<Record<FindingSeverity, number>>
  /** P3 findings may be deferred without failing (⑧ P3 不阻塞). */
  readonly deferred: readonly ReviewFinding[]
}

/** Dispatch brief for one review (used by ④ task reviews and ⑦ full reviews). */
export interface ReviewDispatchSpec {
  readonly instanceName: string
  readonly planPath: string
  readonly baseSha: string
  readonly headSha: string
  /** 计划"全局约束"节原文照抄——审查者的注意力透镜。 */
  readonly globalConstraints: string
  /** 实现者模型族（跨模型评审约束：审查者必须不同族）。 */
  readonly authorModelFamily?: string
}

/** Build the dispatch brief handed to a reviewer subagent (or a human). */
export function buildReviewDispatch(spec: ReviewDispatchSpec): string {
  return [
    `# 审查派发单：${spec.instanceName}`,
    '',
    '## 变更摘要（DESCRIPTION）',
    '（实现者报告路径/一段话摘要）',
    '',
    '## 依据（PLAN_OR_REQUIREMENTS）',
    `- 实施计划：${spec.planPath}`,
    '',
    '## 审查范围',
    `- ${spec.baseSha}..${spec.headSha}（任务起始 commit 起，绝不用 HEAD~1）`,
    '',
    '## 全局约束（注意力透镜，逐条核对）',
    spec.globalConstraints,
    '',
    '## 双裁决（缺一不可）',
    '1. 规格符合性：对照计划任务逐项核对（符合/缺口）',
    '2. 代码质量：TR-1 维度加权（code_quality + security 否决维）',
    '',
    spec.authorModelFamily === undefined
      ? '## 跨模型约束\n- 未登记实现者模型族；如已知请补记（审查者应与实现者不同模型族）。'
      : `## 跨模型约束\n- 实现者模型族：${spec.authorModelFamily}；审查者必须来自不同模型族。`,
    '',
    '## 发现格式（P1/P2/P3）',
    '- P1（阻断）→ 立即修；P2（技术缺陷）→ 本轮修完再提交；P3（风格/建议）→ 记录延后',
    '- 禁止预判发现（"不要标 X"类引导不允许出现在任何派发单）',
    '- "⚠️ 无法从 diff 验证"条目单独列出，由控制器亲自解决',
    '',
    '## 审查者注意',
    '- 审 diff 不复跑实现者已跑过的测试（报告携带测试证据）',
    '- T1-T9 为评分底线：Mock LLM 的测试、无断言测试、假数据直接判 P1/P2',
  ].join('\n')
}

/** Grade a finding list: pass requires zero unresolved P1/P2. */
export function gradeReview(findings: readonly ReviewFinding[]): ReviewVerdict {
  const counts: Record<FindingSeverity, number> = { P1: 0, P2: 0, P3: 0 }
  const deferred: ReviewFinding[] = []
  let blocking = 0
  for (const finding of findings) {
    counts[finding.severity] += 1
    if (finding.severity === 'P1' || finding.severity === 'P2') {
      if (finding.disposition === 'fix-now' || finding.disposition === 'fix-this-round') blocking += 1
      else blocking += 1 // unresolved P1/P2 always blocks, deferred or not
    } else if (finding.disposition === 'deferred' || finding.disposition === 'parked') {
      deferred.push(finding)
    }
  }
  return { passed: blocking === 0, counts, deferred }
}

/** Outcome of one weighted gate evaluation (devforge DCP/TR formula). */
export interface GateEvaluationResult {
  readonly gateId: string
  readonly passed: boolean
  readonly weightedScore: number
  /** 维度得分低于自身阈值（即使总分过线也不通过——devforge 语义）。 */
  readonly failedDimensions: readonly string[]
  /** 否决维被触发（如 security）。 */
  readonly vetoed: boolean
  readonly reason: string
}

/**
 * Evaluate a DCP/TR gate: weighted sum + per-dimension thresholds + veto.
 * `scores` maps dimension name → [0,1] score.
 */
export function evaluateGate(
  gate: DecisionGateConfig,
  scores: Readonly<Record<string, number>>,
): GateEvaluationResult {
  const failedDimensions: string[] = []
  let weightedScore = 0
  let vetoed = false
  for (const dimension of gate.dimensions) {
    const score = scores[dimension.name]
    if (score === undefined) {
      return {
        gateId: gate.id,
        passed: false,
        weightedScore: 0,
        failedDimensions: [dimension.name],
        vetoed: false,
        reason: `缺少维度 '${dimension.name}' 的得分`,
      }
    }
    if (score < 0 || score > 1) {
      return {
        gateId: gate.id,
        passed: false,
        weightedScore: 0,
        failedDimensions: [dimension.name],
        vetoed: false,
        reason: `维度 '${dimension.name}' 得分 ${score} 超出 [0,1]`,
      }
    }
    if (score < dimension.threshold) failedDimensions.push(dimension.name)
    if (gate.vetoDimensions.includes(dimension.name) && score < dimension.threshold) vetoed = true
    weightedScore += score * dimension.weight
  }
  const rounded = Math.round(weightedScore * 1e6) / 1e6
  const passed = rounded >= gate.passThreshold && failedDimensions.length === 0 && !vetoed
  const reasons: string[] = []
  if (rounded < gate.passThreshold) reasons.push(`加权 ${rounded.toFixed(3)} < 阈值 ${gate.passThreshold}`)
  if (failedDimensions.length > 0) reasons.push(`维度未达自身阈值：${failedDimensions.join('、')}`)
  if (vetoed) reasons.push(`否决维触发：${gate.vetoDimensions.join('、')}`)
  return {
    gateId: gate.id,
    passed,
    weightedScore: rounded,
    failedDimensions,
    vetoed,
    reason: passed ? `通过（加权 ${rounded.toFixed(3)} ≥ ${gate.passThreshold}）` : reasons.join('；'),
  }
}

/** 降级链（greenfield / AI 审查不可用时）：AI 审查 → 人工标记。 */
export function reviewFallbackChain(): readonly ['ai-review', 'manual-mark'] {
  return ['ai-review', 'manual-mark'] as const
}
