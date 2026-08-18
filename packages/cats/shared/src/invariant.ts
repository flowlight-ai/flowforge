/** Package-owned cats-shared lifecycle invariants. @module @flowforge/cats-shared/invariant */

import type { Context } from '@flowforge/cordis'

/** Cordis companion plugin name. */
export const name = 'cats-shared-invariant'
/** No services required before the companion can register. */
export const inject: readonly string[] = []

/** Install is a no-op placeholder; cats-shared invariants will be added as the domain lands. */
const install = () => {}

/**
 * Register the cats-shared invariant companion.
 * @param ctx - Cordis context.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.effect(() => install, 'cats-shared-invariant'))
