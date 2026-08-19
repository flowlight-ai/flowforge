/** Package-owned cats-profile lifecycle invariants. @module @flowforge/cats-profile/invariant */

import type { Context } from '@flowforge/cordis'

/** Cordis companion plugin name. */
export const name = 'cats-profile-invariant'

/**
 * The profile services depend on the cats-stores aggregate (approval
 * proposals persist through `ctx.catStores.profileUpdateProposals()`) and on
 * the cats registry (`ctx.cats` — relationshipKey resolution). Services
 * declare `static inject = ['catStores', 'cats']` so Cordis's dependency
 * scheduler orders them after both aggregates are ready.
 */
export const inject: readonly string[] = ['catStores', 'cats']

/** Install is a no-op placeholder; profile invariants land with the services. */
const install = () => {}

/**
 * Register the cats-profile invariant companion.
 * @param ctx - Cordis context.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.effect(() => install, 'cats-profile-invariant'))
