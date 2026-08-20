/**
 * Disposition admission pure functions — F264 contract tests (stage-5 batch 2):
 * - explicit disposition always wins; scoped preference next; next_work fallback
 * - next_work passthrough (no binding, no fallback)
 * - continue_current degradation matrix:
 *   carrier undeclared → carrier_capability_undeclared
 *   declared non-exact semantics → unsupported_carrier
 *   exact_active_turn + live user-owned parent → boundParentInvocationId
 *   exact_active_turn + no parent / foreign parent → no_active_parent
 * - composition boundary: missing capability resolver stays undeclared data
 *
 * @module @flowforge/chat-messages/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId } from '@flowforge/cats-shared'
import {
  resolveFreshnessCarrierCapabilityOrUndeclared,
  resolveMessageDispositionForAdmission,
  resolveQueueAuthorIntentByCatId,
  UNDECLARED_CARRIER_CAPABILITY,
} from '../src/disposition.ts'
import type { ExactParentTracker, FreshnessCarrierCapability } from '../src/disposition.ts'

const CAT_OPUS = createCatId('opus')
const CAT_NANO = createCatId('nano')

const EXACT_CAPABILITY: FreshnessCarrierCapability = {
  provider: 'acp',
  carrier: 'claude',
  deliverySemantics: 'exact_active_turn',
}
const QUEUED_CAPABILITY: FreshnessCarrierCapability = {
  provider: 'im',
  carrier: 'webchat',
  deliverySemantics: 'queued_only',
}

function tracker(overrides: Partial<ExactParentTracker> = {}): ExactParentTracker {
  return {
    has: () => false,
    getUserId: () => undefined,
    getExecutionId: () => undefined,
    ...overrides,
  }
}

describe('resolveMessageDispositionForAdmission', () => {
  it('explicit disposition wins over scoped preference', () => {
    expect(
      resolveMessageDispositionForAdmission({
        explicit: 'continue_current',
        threadId: 't1',
        resolveScopedPreference: () => 'next_work',
      }),
    ).toBe('continue_current')
  })

  it('falls back to the scoped preference when no explicit input', () => {
    expect(
      resolveMessageDispositionForAdmission({
        threadId: 't1',
        resolveScopedPreference: () => 'continue_current',
      }),
    ).toBe('continue_current')
  })

  it('defaults to next_work when nothing resolves', () => {
    expect(resolveMessageDispositionForAdmission({ threadId: 't1' })).toBe('next_work')
    expect(
      resolveMessageDispositionForAdmission({ threadId: 't1', resolveScopedPreference: () => undefined }),
    ).toBe('next_work')
  })
})

describe('resolveQueueAuthorIntentByCatId', () => {
  it('next_work passthrough — no binding and no fallback markers', () => {
    const intents = resolveQueueAuthorIntentByCatId({
      targetCats: [CAT_OPUS],
      requested: 'next_work',
      threadId: 't1',
      userId: 'alice',
      invocationTracker: tracker({ has: () => true }),
    })
    expect(intents[CAT_OPUS]).toEqual({
      requested: 'next_work',
      carrierCapability: UNDECLARED_CARRIER_CAPABILITY,
    })
  })

  it('undeclared carrier degrades continue_current with carrier_capability_undeclared', () => {
    const intents = resolveQueueAuthorIntentByCatId({
      targetCats: [CAT_OPUS],
      requested: 'continue_current',
      threadId: 't1',
      userId: 'alice',
    })
    expect(intents[CAT_OPUS]).toMatchObject({
      requested: 'continue_current',
      fallbackReason: 'carrier_capability_undeclared',
    })
    expect(intents[CAT_OPUS]!.fallbackAt).toBeTypeOf('number')
  })

  it('declared non-exact semantics degrade with unsupported_carrier', () => {
    const intents = resolveQueueAuthorIntentByCatId({
      targetCats: [CAT_OPUS],
      requested: 'continue_current',
      threadId: 't1',
      userId: 'alice',
      resolveCarrierCapability: () => QUEUED_CAPABILITY,
    })
    expect(intents[CAT_OPUS]).toMatchObject({
      requested: 'continue_current',
      carrierCapability: QUEUED_CAPABILITY,
      fallbackReason: 'unsupported_carrier',
    })
  })

  it('exact_active_turn + live user-owned parent binds the parent invocation', () => {
    const intents = resolveQueueAuthorIntentByCatId({
      targetCats: [CAT_OPUS],
      requested: 'continue_current',
      threadId: 't1',
      userId: 'alice',
      resolveCarrierCapability: () => EXACT_CAPABILITY,
      invocationTracker: tracker({
        has: () => true,
        getUserId: () => 'alice',
        getExecutionId: () => 'exec-1',
      }),
    })
    expect(intents[CAT_OPUS]).toEqual({
      requested: 'continue_current',
      boundParentInvocationId: 'exec-1',
      carrierCapability: EXACT_CAPABILITY,
    })
  })

  it('exact_active_turn without an active parent degrades with no_active_parent', () => {
    const intents = resolveQueueAuthorIntentByCatId({
      targetCats: [CAT_OPUS],
      requested: 'continue_current',
      threadId: 't1',
      userId: 'alice',
      resolveCarrierCapability: () => EXACT_CAPABILITY,
      invocationTracker: tracker({ has: () => false }),
    })
    expect(intents[CAT_OPUS]).toMatchObject({ fallbackReason: 'no_active_parent' })
  })

  it('parent owned by another user is not bindable', () => {
    const intents = resolveQueueAuthorIntentByCatId({
      targetCats: [CAT_OPUS],
      requested: 'continue_current',
      threadId: 't1',
      userId: 'alice',
      resolveCarrierCapability: () => EXACT_CAPABILITY,
      invocationTracker: tracker({
        has: () => true,
        getUserId: () => 'bob',
        getExecutionId: () => 'exec-bob',
      }),
    })
    expect(intents[CAT_OPUS]).toMatchObject({ fallbackReason: 'no_active_parent' })
  })

  it('resolves each target cat independently', () => {
    const intents = resolveQueueAuthorIntentByCatId({
      targetCats: [CAT_OPUS, CAT_NANO],
      requested: 'continue_current',
      threadId: 't1',
      userId: 'alice',
      resolveCarrierCapability: (catId) => (catId === CAT_OPUS ? EXACT_CAPABILITY : QUEUED_CAPABILITY),
      invocationTracker: tracker({
        has: () => true,
        getUserId: () => 'alice',
        getExecutionId: () => 'exec-1',
      }),
    })
    expect(intents[CAT_OPUS]).toMatchObject({ boundParentInvocationId: 'exec-1' })
    expect(intents[CAT_NANO]).toMatchObject({ fallbackReason: 'unsupported_carrier' })
  })
})

describe('resolveFreshnessCarrierCapabilityOrUndeclared', () => {
  it('returns undeclared data when the resolver is missing', () => {
    expect(resolveFreshnessCarrierCapabilityOrUndeclared(undefined, CAT_OPUS)).toBe(UNDECLARED_CARRIER_CAPABILITY)
  })

  it('returns undeclared data when the resolver yields nothing', () => {
    expect(resolveFreshnessCarrierCapabilityOrUndeclared(() => undefined, CAT_OPUS)).toBe(
      UNDECLARED_CARRIER_CAPABILITY,
    )
  })

  it('passes through a declared capability', () => {
    expect(resolveFreshnessCarrierCapabilityOrUndeclared(() => EXACT_CAPABILITY, CAT_OPUS)).toBe(EXACT_CAPABILITY)
  })
})
