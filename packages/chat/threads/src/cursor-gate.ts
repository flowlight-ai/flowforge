/**
 * Cursor v2 activation gate — ported from clowder-ai
 * `cursor-activation.ts` (#1269 contract).
 *
 * Separates the canonical visibility coordinate from durable-slot initiation:
 * existing v2 slots always advance in v2 (rollback-safe); untouched/v1 slots
 * only initiate v2 when `VISIBILITY_CURSOR_V2=on`; otherwise the raw message
 * id is extracted from the canonical v2 token.
 *
 * @module @flowforge/chat-threads/service
 */

/** Check whether visibility-based v2 cursor initiation is active. */
export function isV2CursorActive(): boolean {
  return process.env.VISIBILITY_CURSOR_V2 === 'on'
}

/**
 * Gate v2 initiation for a specific durable slot.
 *
 * Returns the cursor format appropriate for writing to the slot:
 * - Existing v2 slot → always v2 (rollback-safe, advance in same format)
 * - Untouched/v1 slot + gate ON → v2 (initiate v2 encoding)
 * - Untouched/v1 slot + gate OFF → v1 (extract raw ID from canonical v2)
 */
export function gateForDurableSlot(canonical: string, existingSlotCursor: string | null): string {
  // Existing v2 → always advance in v2 (rollback-safe)
  if (existingSlotCursor?.startsWith('v2:')) return canonical
  // Gate ON → initiate v2
  if (isV2CursorActive()) return canonical
  // Gate OFF + untouched/v1 → extract raw message ID from v2 canonical
  if (canonical.startsWith('v2:')) {
    // v2 format: v2:<seq16>:<messageId> — extract messageId after second colon
    const secondColon = canonical.indexOf(':', 3)
    if (secondColon > 0) return canonical.slice(secondColon + 1)
  }
  // Already v1 or non-v2 — pass through
  return canonical
}
