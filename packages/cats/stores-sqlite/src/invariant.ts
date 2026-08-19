/** Package-owned cats-stores-sqlite lifecycle invariants. @module @flowforge/cats-stores-sqlite/invariant */

import type { Context } from '@flowforge/cordis'

/** Cordis companion plugin name. */
export const name = 'cats-stores-sqlite-invariant'

/**
 * Backend aggregate must be available before the backend plugin starts.
 * The Sqlite backend plugin declares `static inject = ['catStores']`, so this
 * invariant is enforced structurally by Cordis's dependency scheduler.
 */
export const inject: readonly string[] = ['catStores']

/**
 * Install is a no-op placeholder; storage correctness is verified by the
 * SQLite round-trip and CAS contract suites rather than an in-process probe.
 */
const install = () => {}

/**
 * Register the cats-stores-sqlite invariant companion.
 * @param ctx - Cordis context.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.effect(() => install, 'cats-stores-sqlite-invariant'))
