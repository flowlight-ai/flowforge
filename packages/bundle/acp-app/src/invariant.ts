/**
 * Package-owned invariant companion for `@flowforge/acp-app`.
 * @module @flowforge/acp-app/invariant
 */

import type { Context } from '@flowforge/cordis'
import type { InvariantInstaller } from '@flowforge/invariants'

const PACKAGE_NAME = '@flowforge/acp-app'

/** Cordis companion plugin name. */
export const name = 'acp-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle is a startup provider over the ACP carrier,
 * whose observable contract (JSON-RPC frames on stdio, bounded exit on client
 * EOF) is process-level and owned by the ACP package itself. This package
 * registers nothing and holds no mutable relation to audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))