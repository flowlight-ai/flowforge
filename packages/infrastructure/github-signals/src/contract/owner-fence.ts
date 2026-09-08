/**
 * @flowforge/infrastructure-github-signals — owner fence / continuation carrier parsing
 *
 * Self-contained port of the clowder-ai `@cat-cafe/shared` `parseWaitOwnerFence`,
 * `parseWaitContinuationCarrier` and `createWaitContinuationCarrier` (fail-closed
 * wire validators over JSON-scalar trees). Wire shape:
 *   ownerFence = { kind: 'containing_task', generation } | { kind: 'action_successor', leaseId, generation }
 *   carrier    = { v: 1, waitId, outcomeId, ownerFence }
 */

import type { WaitOutcomeV1 } from './github-wait.ts'
import type { WaitContinuationCarrierV1, WaitOwnerFence } from './predicate.ts'

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

/** Parses and validates an owner fence; returns `null` when the wire shape is invalid. */
export function parseWaitOwnerFence(value: unknown): WaitOwnerFence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.kind === 'containing_task' &&
    hasExactKeys(candidate, ['kind', 'generation']) &&
    Number.isSafeInteger(candidate.generation) &&
    (candidate.generation as number) > 0
  ) {
    return Object.freeze({ kind: 'containing_task', generation: candidate.generation as number })
  }
  if (
    candidate.kind === 'action_successor' &&
    hasExactKeys(candidate, ['kind', 'leaseId', 'generation']) &&
    typeof candidate.leaseId === 'string' &&
    candidate.leaseId.length > 0 &&
    Number.isSafeInteger(candidate.generation) &&
    (candidate.generation as number) > 0
  ) {
    return Object.freeze({
      kind: 'action_successor',
      leaseId: candidate.leaseId,
      generation: candidate.generation as number,
    })
  }
  return null
}

/** Parses and validates a wait continuation carrier; `null` on invalid wire shape. */
export function parseWaitContinuationCarrier(value: unknown): WaitContinuationCarrierV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    !hasExactKeys(candidate, ['v', 'waitId', 'outcomeId', 'ownerFence']) ||
    candidate.v !== 1 ||
    typeof candidate.waitId !== 'string' ||
    candidate.waitId.length === 0 ||
    typeof candidate.outcomeId !== 'string' ||
    candidate.outcomeId.length === 0
  ) {
    return null
  }
  const ownerFence = parseWaitOwnerFence(candidate.ownerFence)
  if (!ownerFence) return null
  return Object.freeze({
    v: 1,
    waitId: candidate.waitId,
    outcomeId: candidate.outcomeId,
    ownerFence,
  })
}

/** Builds a canonical continuation carrier for a wait outcome (throws if invalid). */
export function createWaitContinuationCarrier(
  waitId: string,
  outcome: Pick<WaitOutcomeV1, 'outcomeId' | 'ownerFence'>,
): WaitContinuationCarrierV1 {
  const carrier = parseWaitContinuationCarrier({
    v: 1,
    waitId,
    outcomeId: outcome.outcomeId,
    ownerFence: outcome.ownerFence,
  })
  if (!carrier) throw new Error('canonical wait outcome cannot produce a valid continuation carrier')
  return carrier
}