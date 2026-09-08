/**
 * owner-fence / continuation-carrier 契约：fail-closed 线上校验器。
 *
 * @flowforge/infrastructure-github-signals/tests
 */

import { describe, expect, it } from 'vitest'
import {
  createWaitContinuationCarrier,
  parseWaitContinuationCarrier,
  parseWaitOwnerFence,
} from '../src/contract/owner-fence.ts'
import { makePrAwait } from './fixtures.ts'

describe('parseWaitOwnerFence', () => {
  it('accepts a valid containing_task fence', () => {
    const fence = parseWaitOwnerFence({ kind: 'containing_task', generation: 3 })
    expect(fence).toEqual({ kind: 'containing_task', generation: 3 })
  })

  it('accepts a valid action_successor fence', () => {
    const fence = parseWaitOwnerFence({ kind: 'action_successor', leaseId: 'lease-1', generation: 2 })
    expect(fence).toEqual({ kind: 'action_successor', leaseId: 'lease-1', generation: 2 })
  })

  it('rejects non-positive or non-integer generation', () => {
    expect(parseWaitOwnerFence({ kind: 'containing_task', generation: 0 })).toBeNull()
    expect(parseWaitOwnerFence({ kind: 'containing_task', generation: -1 })).toBeNull()
    expect(parseWaitOwnerFence({ kind: 'containing_task', generation: 1.5 })).toBeNull()
  })

  it('rejects extra keys (fail-closed exact shape)', () => {
    expect(
      parseWaitOwnerFence({ kind: 'containing_task', generation: 1, extra: true }),
    ).toBeNull()
  })

  it('rejects non-objects and arrays', () => {
    expect(parseWaitOwnerFence(null)).toBeNull()
    expect(parseWaitOwnerFence('x')).toBeNull()
    expect(parseWaitOwnerFence([{ kind: 'containing_task', generation: 1 }])).toBeNull()
  })
})

describe('parseWaitContinuationCarrier', () => {
  it('parses a canonical carrier', () => {
    const carrier = parseWaitContinuationCarrier({
      v: 1,
      waitId: 'task-pr-1',
      outcomeId: 'out-1',
      ownerFence: { kind: 'containing_task', generation: 1 },
    })
    expect(carrier).toEqual({
      v: 1,
      waitId: 'task-pr-1',
      outcomeId: 'out-1',
      ownerFence: { kind: 'containing_task', generation: 1 },
    })
  })

  it('rejects invalid ownerFence inside a carrier', () => {
    expect(
      parseWaitContinuationCarrier({
        v: 1,
        waitId: 'task-pr-1',
        outcomeId: 'out-1',
        ownerFence: { kind: 'containing_task', generation: 0 },
      }),
    ).toBeNull()
  })

  it('rejects malformed carriers', () => {
    expect(parseWaitContinuationCarrier({})).toBeNull()
    expect(parseWaitContinuationCarrier({ v: 2, waitId: 'a', outcomeId: 'b' })).toBeNull()
  })
})

describe('createWaitContinuationCarrier', () => {
  it('builds a canonical carrier from a wait outcome', () => {
    const carrier = createWaitContinuationCarrier('task-pr-1', {
      outcomeId: 'out-1',
      ownerFence: makePrAwait().ownerFence,
    })
    expect(carrier.waitId).toBe('task-pr-1')
    expect(carrier.outcomeId).toBe('out-1')
  })
})