/**
 * wait 运行时状态机契约：纯净状态转移 + 交付标记。
 *
 * @flowforge/infrastructure-github-signals/tests
 */

import { describe, expect, it } from 'vitest'
import {
  markWaitOutcomeDelivered,
  markWaitOutcomeLegacyUnfenced,
  transitionWaitState,
  type WaitRuntimeState,
  type WaitTransitionEvent,
} from '../src/wait-state-machine.ts'
import type { WaitOutcomeV1 } from '../src/contract/github-wait.ts'
import { makePrAwait, makePrTask } from './fixtures.ts'

function activeState(): WaitRuntimeState {
  return makePrTask().automationState as { await?: unknown; waitOutcome?: unknown } as WaitRuntimeState
}

function eventFor(kind: WaitTransitionEvent['type']): WaitTransitionEvent {
  return { type: kind as 'predicates_matched', generation: 1, at: 500, matched: [] }
}

describe('transitionWaitState — 谓词匹配', () => {
  it('terminalizes into a pending waitOutcome copying the owner fence', () => {
    const active = activeState()
    const event: WaitTransitionEvent = {
      type: 'predicates_matched',
      generation: 1,
      at: 500,
      matched: [{ kind: 'pr_review_decision_changed', delta: 'APPROVED' }],
    }
    const result = transitionWaitState(active, event)
    expect(result.applied).toBe(true)
    const state = (result as { applied: true; state: WaitRuntimeState }).state
    expect(state.await).toBeUndefined()
    expect(state.waitOutcome?.reason).toBe('matched')
    expect(state.waitOutcome?.delivery).toBe('pending')
    expect(state.waitOutcome?.ownerFence).toEqual({ kind: 'containing_task', generation: 1 })
    expect(state.waitOutcome?.matched).toEqual([{ kind: 'pr_review_decision_changed', delta: 'APPROVED' }])
  })

  it('returns empty_match (not applied) for a matched event with no deltas', () => {
    const active = activeState()
    const result = transitionWaitState(active, eventFor('predicates_matched'))
    expect(result.applied).toBe(false)
    expect((result as { reason: string }).reason).toBe('empty_match')
  })
})

describe('transitionWaitState — 终止与过期', () => {
  it('terminalizes on subject_terminal with a pending outcome', () => {
    const result = transitionWaitState(activeState(), {
      type: 'subject_terminal',
      generation: 1,
      at: 500,
      subjectState: 'merged',
    })
    expect(result.applied).toBe(true)
    const state = (result as { applied: true; state: WaitRuntimeState }).state
    expect(state.waitOutcome?.reason).toBe('subject_terminal')
    expect(state.waitOutcome?.terminalSubjectState).toBe('merged')
    expect(state.waitOutcome?.delivery).toBe('pending')
  })

  it('terminalizes as expired when event.at >= expiresAt', () => {
    const result = transitionWaitState(activeState(), {
      type: 'predicates_matched',
      generation: 1,
      at: 10_001,
      matched: [{ kind: 'pr_review_decision_changed', delta: 'x' }],
    })
    const state = (result as { applied: true; state: WaitRuntimeState }).state
    expect(state.waitOutcome?.reason).toBe('expired')
    expect(state.waitOutcome?.delivery).toBe('not_applicable')
  })

  it('terminalizes on user_cancel preserving the actor', () => {
    const result = transitionWaitState(activeState(), {
      type: 'user_cancel',
      generation: 1,
      at: 500,
      actor: { kind: 'user', userId: 'user-1' },
    })
    const state = (result as { applied: true; state: WaitRuntimeState }).state
    expect(state.waitOutcome?.reason).toBe('user_cancel')
    expect(state.waitOutcome?.actor).toEqual({ kind: 'user', userId: 'user-1' })
  })
})

describe('transitionWaitState — 世代门禁', () => {
  it('rejects a stale await generation with generation_inactive', () => {
    const stale: WaitRuntimeState = {
      await: { ...makePrAwait(), generation: 2, ownerFence: { kind: 'containing_task', generation: 2 } },
    }
    const result = transitionWaitState(stale, {
      type: 'predicates_matched',
      generation: 1,
      at: 500,
      matched: [{ kind: 'pr_review_decision_changed', delta: 'x' }],
    })
    expect(result.applied).toBe(false)
    expect((result as { reason: string }).reason).toBe('generation_inactive')
  })

  it('rejects when there is no active await at all', () => {
    const result = transitionWaitState({}, {
      type: 'predicates_matched',
      generation: 1,
      at: 500,
      matched: [{ kind: 'pr_review_decision_changed', delta: 'x' }],
    })
    expect(result.applied).toBe(false)
    expect((result as { reason: string }).reason).toBe('generation_inactive')
  })
})

describe('markWaitOutcomeDelivered', () => {
  it('flips a pending outcome to delivered', () => {
    const outcome: WaitOutcomeV1 = {
      v: 1,
      outcomeId: 'wait:pr:acme/omega#7:g1:matched',
      generation: 1,
      subjectRef: 'pr:acme/omega#7',
      ownerFence: { kind: 'containing_task', generation: 1 },
      reason: 'matched',
      at: 500,
      delivery: 'pending',
    }
    const state: WaitRuntimeState = { waitOutcome: outcome }
    const next = markWaitOutcomeDelivered(state, outcome.outcomeId)
    expect(next.waitOutcome?.delivery).toBe('delivered')
  })

  it('is a no-op for unknown outcome ids or non-pending delivery', () => {
    const state: WaitRuntimeState = {
      waitOutcome: {
        v: 1,
        outcomeId: 'x',
        generation: 1,
        subjectRef: 'pr:acme/omega#7',
        ownerFence: { kind: 'containing_task', generation: 1 },
        reason: 'expired',
        at: 500,
        delivery: 'not_applicable',
      },
    }
    expect(markWaitOutcomeDelivered(state, 'x').waitOutcome?.delivery).toBe('not_applicable')
  })
})

describe('markWaitOutcomeLegacyUnfenced', () => {
  function legacyState(outcomeId: string): WaitRuntimeState {
    return {
      waitOutcome: {
        v: 1,
        outcomeId,
        generation: 1,
        subjectRef: 'pr:acme/omega#7',
        ownerFence: {} as WaitOutcomeV1['ownerFence'],
        reason: 'matched',
        at: 500,
        delivery: 'pending',
      },
    }
  }

  it('quarantines a pending outcome whose owner fence fails validation', () => {
    const next = markWaitOutcomeLegacyUnfenced(legacyState('legacy-1'), 'legacy-1')
    expect(next.waitOutcome?.delivery).toBe('legacy_unfenced')
  })

  it('is a no-op when the owner fence is valid', () => {
    const state: WaitRuntimeState = {
      waitOutcome: {
        v: 1,
        outcomeId: 'fenced-1',
        generation: 1,
        subjectRef: 'pr:acme/omega#7',
        ownerFence: { kind: 'containing_task', generation: 1 },
        reason: 'matched',
        at: 500,
        delivery: 'pending',
      },
    }
    expect(markWaitOutcomeLegacyUnfenced(state, 'fenced-1').waitOutcome?.delivery).toBe('pending')
  })
})