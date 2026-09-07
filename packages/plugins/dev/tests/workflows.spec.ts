/**
 * Workflow profile contract suite (EP0-3 T0.3.6): four devforge templates over
 * the fixed seven-phase spine — gate configurations carried over verbatim,
 * hotfix fastpass semantics (verify never exempted), and phase-gate lookup.
 */

import { describe, expect, it } from 'vitest'
import { PROCESS_PHASES } from '../src/state-machine.ts'
import {
  gatesForPhase,
  getWorkflowProfile,
  WORKFLOW_KINDS,
  WORKFLOW_PROFILES,
} from '../src/workflows.ts'

describe('WORKFLOW_PROFILES', () => {
  it('defines exactly the four devforge kinds', () => {
    expect(WORKFLOW_KINDS).toEqual(['greenfield', 'feature', 'change', 'hotfix'])
    expect(Object.keys(WORKFLOW_PROFILES).sort()).toEqual([...WORKFLOW_KINDS].sort())
  })

  it('anchors every gate at a legal spine phase', () => {
    for (const profile of Object.values(WORKFLOW_PROFILES)) {
      for (const gate of profile.decisionGates) {
        expect(PROCESS_PHASES).toContain(gate.phase)
        expect(gate.dimensions.length).toBeGreaterThan(0)
        expect(gate.rejectRetries).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps dimension weights summing to ~1 per gate (devforge 原样)', () => {
    for (const profile of Object.values(WORKFLOW_PROFILES)) {
      for (const gate of profile.decisionGates) {
        const sum = gate.dimensions.reduce((total, dim) => total + dim.weight, 0)
        expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
      }
    }
  })
})

describe('feature 工作流（feature.yaml 全门禁）', () => {
  const profile = WORKFLOW_PROFILES.feature

  it('has four gates: DCP-1 / DCP-2 / TR-1 / DCP-3', () => {
    expect(profile.decisionGates.map(gate => gate.id)).toEqual(['dcp1', 'dcp2', 'tr1', 'dcp3'])
    expect(profile.decisionGates.map(gate => gate.phase)).toEqual([
      'requirement',
      'design',
      'review',
      'verify',
    ])
  })

  it('keeps DCP-2 and DCP-3 as human decision points', () => {
    const human = profile.decisionGates.filter(gate => gate.humanRequired).map(gate => gate.id)
    expect(human).toEqual(['dcp2', 'dcp3'])
  })

  it('carries the devforge DCP-1 weighted threshold 0.65 with security veto', () => {
    const dcp1 = profile.decisionGates[0]!
    expect(dcp1.passThreshold).toBe(0.65)
    expect(dcp1.vetoDimensions).toEqual(['security'])
    expect(dcp1.dimensions.map(dim => dim.name)).toEqual(['business_value', 'feasibility', 'security'])
  })

  it('has no fastpass and no parallel implement', () => {
    expect(profile.fastpass).toEqual({ design: false, plan: false })
    expect(profile.parallelImplement).toBe(false)
  })
})

describe('greenfield 工作流（0→1 孵化）', () => {
  const profile = WORKFLOW_PROFILES.greenfield

  it('marks parallel implement and the AI→human review fallback chain', () => {
    expect(profile.parallelImplement).toBe(true)
    expect(profile.reviewFallbackToHuman).toBe(true)
  })
})

describe('change 工作流（轻量门禁）', () => {
  const profile = WORKFLOW_PROFILES.change

  it('has three gates with no DCP-3 release gate and no human stops', () => {
    expect(profile.decisionGates.map(gate => gate.id)).toEqual(['dcp1', 'dcp2', 'tr1'])
    expect(profile.decisionGates.some(gate => gate.humanRequired)).toBe(false)
    expect(profile.deployWithMonitoring).toBe(false)
  })
})

describe('hotfix 工作流（快速通道）', () => {
  const profile = WORKFLOW_PROFILES.hotfix

  it('fastpasses design and plan gates', () => {
    expect(profile.fastpass).toEqual({ design: true, plan: true })
  })

  it('keeps a single-dimension quick TR-1 (code_quality @ 0.50)', () => {
    const tr1 = profile.decisionGates[0]!
    expect(tr1.id).toBe('tr1')
    expect(tr1.dimensions).toEqual([{ name: 'code_quality', weight: 1.0, threshold: 0.5 }])
    expect(tr1.passThreshold).toBe(0.5)
  })

  it('keeps the release gate at verify with auto-pass-on-timeout (审计语义)', () => {
    const release = profile.decisionGates[1]!
    expect(release.id).toBe('dcp1_hotfix')
    expect(release.phase).toBe('verify')
    expect(release.autoPassOnTimeout).toBe(true)
    expect(release.rejectFallback).toBe('rollback')
  })

  it('still demands verification evidence in its artifact contract (硬门禁永不豁免)', () => {
    expect(profile.artifacts.verify.join(' ')).toContain('回归证据')
  })
})

describe('getWorkflowProfile / gatesForPhase', () => {
  it('looks up profiles and rejects unknown kinds', () => {
    expect(getWorkflowProfile('feature').kind).toBe('feature')
    expect(() => getWorkflowProfile('spike')).toThrow(/unknown workflow kind 'spike'/)
  })

  it('returns only the gates anchored at a phase', () => {
    const profile = WORKFLOW_PROFILES.feature
    expect(gatesForPhase(profile, 'design').map(gate => gate.id)).toEqual(['dcp2'])
    expect(gatesForPhase(profile, 'implement')).toEqual([])
    expect(gatesForPhase(WORKFLOW_PROFILES.hotfix, 'verify').map(gate => gate.id)).toEqual(['dcp1_hotfix'])
  })
})
