/**
 * Contract suite: seven-phase delivery state machine (linear order,
 * hard gates, illegal-transition rejection, snapshot/restore) and the
 * process instance registry (create/get/list, duplicates, import).
 */

import { describe, expect, it } from 'vitest'
import {
  ForgeProcessRegistry,
  ForgeProcessStateMachine,
  PROCESS_PHASES,
  PROCESS_TRANSITIONS,
  ProcessRegistryError,
  ProcessTransitionError,
} from '../src/index.ts'

const fixedNow = (): Date => new Date('2026-09-07T00:00:00.000Z')

describe('PROCESS_PHASES / PROCESS_TRANSITIONS', () => {
  it('defines the seven phases in delivery order', () => {
    expect(PROCESS_PHASES).toEqual([
      'requirement',
      'design',
      'plan',
      'implement',
      'review',
      'verify',
      'finish',
    ])
  })

  it('forms a strictly linear chain with exactly three hard gates', () => {
    expect(PROCESS_TRANSITIONS).toHaveLength(6)
    const gated = PROCESS_TRANSITIONS.filter(transition => transition.requiresGate !== undefined)
    expect(gated.map(transition => transition.requiresGate)).toEqual([
      'designApproved',
      'planValidated',
      'verificationEvidence',
    ])
    for (let index = 0; index < PROCESS_TRANSITIONS.length; index += 1) {
      expect(PROCESS_TRANSITIONS[index]!.from).toBe(PROCESS_PHASES[index])
      expect(PROCESS_TRANSITIONS[index]!.to).toBe(PROCESS_PHASES[index + 1])
    }
  })
})

describe('ForgeProcessStateMachine', () => {
  it('starts in requirement and records the initial history entry', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    expect(machine.phase).toBe('requirement')
    expect(machine.finished).toBe(false)
    expect(machine.history).toEqual([{ phase: 'requirement', enteredAt: '2026-09-07T00:00:00.000Z' }])
    expect(machine.gates).toEqual({
      designApproved: false,
      planValidated: false,
      verificationEvidence: false,
    })
  })

  it('walks the full happy path when all gates are opened in order', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    expect(machine.advance().phase).toBe('design')

    machine.approveDesign('docs/refactor/33-stage-ep0-plugin-dev.md')
    expect(machine.advance().phase).toBe('plan')

    machine.validatePlan('docs/process/plans/ep0-1.md')
    expect(machine.advance().phase).toBe('implement')

    expect(machine.advance().phase).toBe('review')
    machine.registerReview('docs/process/reviews/ep0-1.md')
    expect(machine.advance().phase).toBe('verify')

    machine.recordVerification('docs/process/verifications/ep0-1.md')
    expect(machine.advance().phase).toBe('finish')
    expect(machine.finished).toBe(true)
    expect(machine.artifacts).toEqual({
      design: 'docs/refactor/33-stage-ep0-plugin-dev.md',
      plan: 'docs/process/plans/ep0-1.md',
      review: 'docs/process/reviews/ep0-1.md',
      verification: 'docs/process/verifications/ep0-1.md',
    })
    expect(machine.history.map(record => record.phase)).toEqual(PROCESS_PHASES)
  })

  it('blocks design → plan until the design is signed off', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    machine.advance() // requirement → design
    expect(machine.guard()).toEqual({
      allowed: false,
      reason: expect.stringContaining("gate 'designApproved' closed") as unknown as string,
    })
    expect(() => machine.advance()).toThrow(ProcessTransitionError)
    machine.approveDesign('docs/design.md')
    expect(machine.guard()).toEqual({ allowed: true })
    expect(machine.advance().phase).toBe('plan')
  })

  it('blocks plan → implement until the plan is validated', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    machine.advance()
    machine.approveDesign('docs/design.md')
    machine.advance() // → plan
    expect(() => machine.advance()).toThrow(/gate 'planValidated' closed/)
    machine.validatePlan('docs/plan.md')
    expect(machine.advance().phase).toBe('implement')
  })

  it('blocks verify → finish until verification evidence is recorded', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    machine.advance()
    machine.approveDesign('docs/design.md')
    machine.advance()
    machine.validatePlan('docs/plan.md')
    machine.advance() // → implement
    machine.advance() // → review
    machine.advance() // → verify
    expect(() => machine.advance()).toThrow(/gate 'verificationEvidence' closed/)
    machine.recordVerification('docs/verification.md')
    expect(machine.advance().phase).toBe('finish')
  })

  it('rejects advancing past the terminal phase', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    walkToFinish(machine)
    expect(() => machine.advance()).toThrow(/terminal phase 'finish'/)
    expect(machine.guard()).toEqual({ allowed: false, reason: expect.stringContaining('already finished') as unknown as string })
  })

  it('rejects skipping phases, moving backwards and staying in place', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    expect(() => machine.advanceTo('implement')).toThrow(/illegal transition requirement → implement/)
    expect(() => machine.advanceTo('requirement')).toThrow(/illegal transition requirement → requirement/)
    machine.advance()
    machine.approveDesign('docs/design.md')
    machine.advance() // → plan
    machine.validatePlan('docs/plan.md')
    expect(() => machine.advanceTo('design')).toThrow(/illegal transition plan → design/)
    expect(machine.advanceTo('implement').phase).toBe('implement')
  })

  it('carries the attempted transition in the error', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    machine.advance()
    try {
      machine.advance()
      expect.unreachable('advance must throw with a closed gate')
    } catch (error) {
      const transitionError = error as ProcessTransitionError
      expect(transitionError).toBeInstanceOf(ProcessTransitionError)
      expect(transitionError.readonlyFrom).toBe('design')
      expect(transitionError.attemptedTo).toBe('plan')
    }
  })

  it('round-trips through snapshot/restore without losing state', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    machine.advance()
    machine.approveDesign('docs/design.md')
    machine.advance()
    machine.validatePlan('docs/plan.md')
    machine.advance() // → implement
    const snapshot = machine.snapshot()

    const restored = ForgeProcessStateMachine.restore(snapshot, { now: fixedNow })
    expect(restored.phase).toBe('implement')
    expect(restored.gates).toEqual(snapshot.gates)
    expect(restored.artifacts).toEqual(snapshot.artifacts)
    expect(restored.history).toEqual(snapshot.history)
    expect(restored.advance().phase).toBe('review')
  })

  it('rejects restoring snapshots with unknown phases', () => {
    const machine = new ForgeProcessStateMachine({ name: 'ep0', now: fixedNow })
    const snapshot = machine.snapshot()
    const corrupted = { ...snapshot, phase: 'retro' }
    expect(() => ForgeProcessStateMachine.restore(corrupted as typeof snapshot)).toThrow(/unknown phase 'retro'/)
  })
})

describe('ForgeProcessRegistry', () => {
  it('creates, gets and lists instances', () => {
    const registry = new ForgeProcessRegistry({ now: fixedNow })
    registry.create('ep0')
    registry.create('ep1')
    expect(registry.has('ep0')).toBe(true)
    expect(registry.get('ep0').phase).toBe('requirement')
    expect(registry.list()).toEqual(['ep0', 'ep1'])
    expect(registry.find('missing')).toBeUndefined()
  })

  it('rejects duplicate creation and unknown lookup/removal', () => {
    const registry = new ForgeProcessRegistry({ now: fixedNow })
    registry.create('ep0')
    expect(() => registry.create('ep0')).toThrow(ProcessRegistryError)
    expect(() => registry.get('missing')).toThrow(/'missing' not found/)
    expect(() => registry.remove('missing')).toThrow(ProcessRegistryError)
  })

  it('removes instances and exports snapshots', () => {
    const registry = new ForgeProcessRegistry({ now: fixedNow })
    registry.create('ep0').advance()
    registry.create('ep1')
    registry.remove('ep0')
    expect(registry.list()).toEqual(['ep1'])
    expect(registry.snapshots()).toEqual([
      expect.objectContaining({ name: 'ep1', phase: 'requirement' }) as unknown as Record<string, unknown>,
    ])
  })

  it('imports snapshots and keeps them operational', () => {
    const source = new ForgeProcessRegistry({ now: fixedNow })
    const machine = source.create('ep0')
    machine.advance()
    machine.approveDesign('docs/design.md')

    const target = new ForgeProcessRegistry({ now: fixedNow })
    target.importSnapshots(source.snapshots())
    expect(target.has('ep0')).toBe(true)
    expect(target.get('ep0').phase).toBe('design')
    expect(target.get('ep0').advance().phase).toBe('plan') // gate carried over via snapshot

    expect(() => target.importSnapshots(source.snapshots())).toThrow(/already exists/)
  })
})

function walkToFinish(machine: ForgeProcessStateMachine): void {
  machine.advance()
  machine.approveDesign('docs/design.md')
  machine.advance()
  machine.validatePlan('docs/plan.md')
  machine.advance()
  machine.advance()
  machine.advance()
  machine.recordVerification('docs/verification.md')
  machine.advance()
}
