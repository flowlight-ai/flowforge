/**
 * Package-owned invariant companion for `@flowforge/code-runtime-python`.
 * @module @flowforge/code-runtime-python/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@flowforge/cordis'
import type { InvariantInstaller } from '@flowforge/invariants'

const PACKAGE_NAME = '@flowforge/code-runtime-python'

/** Cordis companion plugin name. */
export const name = 'code-runtime-python-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this process-boundary implementation exposes no
 * same-process event relation; the wire protocol and integration tests cover it.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */