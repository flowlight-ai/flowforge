/** Package-owned cats-invocation lifecycle invariants. @module @flowforge/cats-invocation/invariant */

import type { Context } from '@flowforge/cordis'

/** Cordis companion plugin name. */
export const name = 'cats-invocation-invariant'

/**
 * The invocation aggregate depends on the cats-stores aggregate being available
 * (queue/tracker/progress services persist through `ctx.catStores`). Concrete
 * service implementations declare `static inject = ['catStores', 'catsInvocation']`
 * so Cordis's dependency scheduler orders them after both aggregates are ready.
 */
export const inject: readonly string[] = ['catStores']

/** Install is a no-op placeholder; cats-invocation invariants land with batch 3.4+. */
const install = () => {}

/**
 * Register the cats-invocation invariant companion.
 * @param ctx - Cordis context.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.effect(() => install, 'cats-invocation-invariant'))
