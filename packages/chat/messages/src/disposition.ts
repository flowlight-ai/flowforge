/**
 * Message work-disposition admission — F264 pure functions.
 *
 * Ported from clowder-ai `routes/message-disposition-admission.ts` (R13):
 * the clowder version reads scoped preferences from a filesystem
 * user-preferences-store; here the resolver is injected (data-driven) so the
 * pure functions stay store-agnostic. Semantics are otherwise 1:1:
 * - explicit disposition always wins
 * - scoped preference (project+thread) resolves the default
 * - `next_work` is the final fallback
 * - `continue_current` binds to an exact live parent invocation when the
 *   carrier declares `exact_active_turn` semantics and the tracker holds an
 *   active, user-owned execution; otherwise it degrades with a reason.
 *
 * @module @flowforge/chat-messages/disposition
 */

import type { CatId } from '@flowforge/cats-shared'

/** F264: user-declared work disposition for an admitted message. */
export type MessageWorkDisposition = 'continue_current' | 'next_work'

/** Carrier-declared delivery semantics (F264 freshness carrier capability). */
export interface FreshnessCarrierCapability {
  readonly provider: string
  readonly carrier: string
  readonly deliverySemantics: string
}

/** Per-cat resolved author intent for a queued message. */
export interface QueueAuthorIntent {
  readonly requested: MessageWorkDisposition
  readonly carrierCapability: FreshnessCarrierCapability
  /** Only set when `continue_current` bound to a live parent invocation. */
  readonly boundParentInvocationId?: string
  /** Only set when `continue_current` degraded to next-work admission. */
  readonly fallbackAt?: number
  readonly fallbackReason?: 'carrier_capability_undeclared' | 'unsupported_carrier' | 'no_active_parent'
}

/** Capability used when a cat declares nothing — stays data, never a crash. */
export const UNDECLARED_CARRIER_CAPABILITY: FreshnessCarrierCapability = {
  provider: 'other',
  carrier: 'other',
  deliverySemantics: 'undeclared',
} as const

/** Minimal tracker surface needed to bind an exact live parent (F264). */
export interface ExactParentTracker {
  has(threadId: string, catId: CatId): boolean
  getUserId(threadId: string, catId: CatId): string | undefined
  getExecutionId(threadId: string, catId: CatId): string | undefined
}

/** Resolve the effective disposition for admission (explicit > scoped > next_work). */
export function resolveMessageDispositionForAdmission(input: {
  explicit?: MessageWorkDisposition
  threadId: string
  /** Scoped preference resolver (project+thread aware); optional. */
  resolveScopedPreference?: (threadId: string) => MessageWorkDisposition | undefined
}): MessageWorkDisposition {
  if (input.explicit) return input.explicit
  return input.resolveScopedPreference?.(input.threadId) ?? 'next_work'
}

/** Resolve per-cat queue author intent, degrading `continue_current` safely. */
export function resolveQueueAuthorIntentByCatId(input: {
  targetCats: readonly CatId[]
  requested: MessageWorkDisposition
  threadId: string
  userId: string
  invocationTracker?: ExactParentTracker
  resolveCarrierCapability?: (catId: CatId) => FreshnessCarrierCapability | undefined
  now?: number
}): Record<string, QueueAuthorIntent> {
  const now = input.now ?? Date.now()
  return Object.fromEntries(
    input.targetCats.map((catId) => {
      const carrierCapability = input.resolveCarrierCapability?.(catId) ?? UNDECLARED_CARRIER_CAPABILITY
      if (input.requested === 'next_work') {
        return [catId, { requested: 'next_work', carrierCapability } satisfies QueueAuthorIntent]
      }
      if (carrierCapability.deliverySemantics !== 'exact_active_turn') {
        return [
          catId,
          {
            requested: 'continue_current',
            carrierCapability,
            fallbackAt: now,
            fallbackReason:
              carrierCapability.deliverySemantics === 'undeclared'
                ? 'carrier_capability_undeclared'
                : 'unsupported_carrier',
          } satisfies QueueAuthorIntent,
        ]
      }
      const tracker = input.invocationTracker
      const boundParentInvocationId =
        tracker?.has(input.threadId, catId) && tracker.getUserId(input.threadId, catId) === input.userId
          ? tracker.getExecutionId(input.threadId, catId)
          : undefined
      return boundParentInvocationId
        ? [
            catId,
            { requested: 'continue_current', boundParentInvocationId, carrierCapability } satisfies QueueAuthorIntent,
          ]
        : [
            catId,
            {
              requested: 'continue_current',
              carrierCapability,
              fallbackAt: now,
              fallbackReason: 'no_active_parent',
            } satisfies QueueAuthorIntent,
          ]
    }),
  )
}

/** Compose boundary helper: missing declarations stay data (undeclared), never a crash. */
export function resolveFreshnessCarrierCapabilityOrUndeclared(
  resolve: ((catId: CatId) => FreshnessCarrierCapability | undefined) | undefined,
  catId: CatId,
): FreshnessCarrierCapability {
  return (typeof resolve === 'function' ? resolve.call(undefined, catId) : undefined)
    ?? UNDECLARED_CARRIER_CAPABILITY
}
