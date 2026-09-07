/**
 * Two-stage review protocol contract suite (EP0-5 T0.5.5): P1/P2/P3 grading
 * with the dual verdict, devforge's weighted DCP/TR gate formula (dimension
 * thresholds + security veto), and the cross-model review brief.
 */

import { describe, expect, it } from 'vitest'
import {
  buildReviewDispatch,
  evaluateGate,
  gradeReview,
  reviewFallbackChain,
  type ReviewFinding,
} from '../src/review-protocol.ts'
import { getWorkflowProfile } from '../src/workflows.ts'

function finding(severity: ReviewFinding['severity'], disposition: ReviewFinding['disposition']): ReviewFinding {
  return { severity, title: `发现-${severity}`, disposition }
}

describe('gradeReview — P1/P2/P3 分级裁决', () => {
  it('passes with zero findings and with only deferred P3s (⑧ P3 不阻塞)', () => {
    expect(gradeReview([]).passed).toBe(true)
    const verdict = gradeReview([finding('P3', 'deferred'), finding('P3', 'parked')])
    expect(verdict.passed).toBe(true)
    expect(verdict.counts).toEqual({ P1: 0, P2: 0, P3: 2 })
    expect(verdict.deferred).toHaveLength(2)
  })

  it('fails while any P1/P2 remains (disposition cannot launder a blocker)', () => {
    for (const severity of ['P1', 'P2'] as const) {
      for (const disposition of ['fix-now', 'fix-this-round', 'deferred', 'parked'] as const) {
        expect(gradeReview([finding(severity, disposition)]).passed).toBe(false)
      }
    }
  })

  it('counts severities across mixed findings', () => {
    const verdict = gradeReview([
      finding('P1', 'fix-now'),
      finding('P2', 'fix-this-round'),
      finding('P3', 'deferred'),
    ])
    expect(verdict.counts).toEqual({ P1: 1, P2: 1, P3: 1 })
    expect(verdict.passed).toBe(false)
  })
})

describe('evaluateGate — devforge 加权门禁公式', () => {
  const dcp1 = getWorkflowProfile('feature').decisionGates[0]!
  // dimensions: business_value 0.4 / feasibility 0.35 / security 0.25, pass 0.65

  it('passes when the weighted sum clears the threshold and every dimension clears its own', () => {
    const result = evaluateGate(dcp1, { business_value: 0.9, feasibility: 0.9, security: 0.9 })
    expect(result.passed).toBe(true)
    expect(result.weightedScore).toBeCloseTo(0.9, 6)
    expect(result.failedDimensions).toEqual([])
  })

  it('fails when the weighted sum is under the threshold', () => {
    const result = evaluateGate(dcp1, { business_value: 0.5, feasibility: 0.6, security: 0.7 })
    // 0.5*0.4 + 0.6*0.35 + 0.7*0.25 = 0.585 < 0.65
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('加权')
  })

  it('fails when a dimension misses its own threshold even if the sum passes', () => {
    const result = evaluateGate(dcp1, { business_value: 1.0, feasibility: 1.0, security: 0.69 })
    expect(result.weightedScore).toBeCloseTo(0.9225, 6)
    expect(result.passed).toBe(false)
    expect(result.failedDimensions).toEqual(['security'])
  })

  it('flags the security veto dimension', () => {
    const result = evaluateGate(dcp1, { business_value: 1.0, feasibility: 1.0, security: 0.69 })
    expect(result.vetoed).toBe(true)
  })

  it('rejects missing dimensions and out-of-range scores with hard errors', () => {
    expect(evaluateGate(dcp1, { business_value: 0.9 }).passed).toBe(false)
    expect(evaluateGate(dcp1, { business_value: 0.9, feasibility: 0.9, security: 1.5 }).reason).toContain('[0,1]')
  })
})

describe('buildReviewDispatch — 审查派发单', () => {
  const spec = {
    instanceName: 'ep0',
    planPath: 'docs/process/plans/ep0.md',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    globalConstraints: '- 提交一律走 mgr PR\n- 禁止 Mock LLM（T1）',
    authorModelFamily: 'glm',
  }

  it('carries the plan, the diff range, and the global-constraints lens', () => {
    const brief = buildReviewDispatch(spec)
    expect(brief).toContain(spec.planPath)
    expect(brief).toContain(`${spec.baseSha}..${spec.headSha}`)
    expect(brief).toContain('禁止 Mock LLM（T1）')
    expect(brief).toContain('规格符合性')
    expect(brief).toContain('代码质量')
  })

  it('records the cross-model constraint for the reviewer', () => {
    expect(buildReviewDispatch(spec)).toContain('实现者模型族：glm')
    const { authorModelFamily: _omitted, ...anonymousSpec } = spec
    const anonymous = buildReviewDispatch(anonymousSpec)
    expect(anonymous).toContain('未登记实现者模型族')
  })

  it('keeps the AI→human fallback chain order', () => {
    expect(reviewFallbackChain()).toEqual(['ai-review', 'manual-mark'])
  })
})
