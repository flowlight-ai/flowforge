/** Package-owned cats-stores lifecycle invariants. @module @flowforge/cats-stores/invariant */

import type { Context } from '@flowforge/cordis'

/** Cordis companion plugin name. */
export const name = 'cats-stores-invariant'

/**
 * Backend aggregate must be available before any backend plugin starts.
 * The Memory backend plugin declares `static inject = ['catStores']`, so this
 * invariant is enforced structurally by Cordis's dependency scheduler.
 */
export const inject: readonly string[] = ['catStores']

/** Install is a no-op placeholder; cats-stores invariants will be added as the domain lands. */
const install = () => {}

/**
 * Register the cats-stores invariant companion.
 * @param ctx - Cordis context.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.effect(() => install, 'cats-stores-invariant'))
