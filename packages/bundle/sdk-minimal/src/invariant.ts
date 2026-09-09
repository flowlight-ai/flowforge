/**
 * Package-owned invariant companion for `@flowforge/sdk-minimal`.
 * @module @flowforge/sdk-minimal/invariant
 */

import type { Context } from '@flowforge/cordis'
import type { InvariantInstaller } from '@flowforge/invariants'

const PACKAGE_NAME = '@flowforge/sdk-minimal'

/** Cordis companion plugin name. */
export const name = 'sdk-minimal-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the package is a static patch-list carrier (a YAML
// document of loader rows owned by other packages); it mounts no service,
// emits no events, and owns no mutable relation to check. Each inserted row's
// own package carries that row's invariants.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))