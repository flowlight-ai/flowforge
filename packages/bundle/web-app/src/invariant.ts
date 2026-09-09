/**
 * Package-owned invariant companion for `@flowforge/web-app`.
 * @module @flowforge/web-app/invariant
 */

import type { Context } from '@flowforge/cordis'
import type { InvariantInstaller } from '@flowforge/invariants'

const PACKAGE_NAME = '@flowforge/web-app'

/** Cordis companion plugin name. */
export const name = 'web-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle is a host glue over the webserver carrier
 * whose observable contract (the URL line, dist serving, and browser handoff)
 * is process-level and owned by the host composition; it registers nothing and
 * holds no mutable relation to audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))