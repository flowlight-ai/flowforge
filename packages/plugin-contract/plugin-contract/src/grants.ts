/**
 * Effective-grant validation, mapped from the upstream application
 * contract's `wire/grants`: a {@link GrantSnapshot} is the versioned capability set a
 * plugin instance actually holds at a moment in time. The host is the sole
 * writer; plugins observe. Every check here is fail-closed — an
 * unrecognized capability means denial, never benefit of the doubt.
 *
 * @module @flowforge/plugin-contract/grants
 */

import type { Capability } from './capability.ts'
import { VALID_CAPABILITIES } from './capability.ts'

/**
 * Maximum number of items in effectiveGrants: the capability table's size —
 * a plugin cannot hold more capabilities than exist.
 */
export const MAX_GRANT_ITEMS = VALID_CAPABILITIES.size

/**
 * A versioned capability snapshot.
 *
 * `grantRevision` is strictly monotonic per plugin instance — the host
 * increments it on every grant mutation; a plugin observing revision N may
 * discard any notification with revision < N.
 */
export interface GrantSnapshot {
  /** Monotonically increasing per plugin instance; host is the sole writer. */
  readonly grantRevision: number
  /** Unique Capability[], 0..MAX_GRANT_ITEMS items; duplicates are a violation. */
  readonly effectiveGrants: readonly Capability[]
}

/**
 * Validate that effectiveGrants:
 *   1. Does not exceed MAX_GRANT_ITEMS.
 *   2. Contains no duplicates.
 *   3. Contains only valid Capability enum members (closed-enum check).
 *
 * Fail-closed: any unrecognized capability value returns false. This is an
 * authorization boundary — fail-open would allow privilege escalation.
 */
export function validateEffectiveGrants(grants: readonly string[]): boolean {
  if (grants.length > MAX_GRANT_ITEMS) return false
  const seen = new Set<string>()
  for (const grant of grants) {
    if (!VALID_CAPABILITIES.has(grant)) return false
    if (seen.has(grant)) return false
    seen.add(grant)
  }
  return true
}

/**
 * The effective grants of an installed manifest are exactly the union of
 * its feature capabilities, deduplicated — nothing declared outside a
 * feature is ever granted.
 */
export function grantsOfFeatures(capabilities: readonly Capability[]): readonly Capability[] {
  return [...new Set(capabilities)]
}
