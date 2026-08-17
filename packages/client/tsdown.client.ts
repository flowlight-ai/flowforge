/**
 * Shared tsdown preset for packages that ship both a Node library and a
 * browser client bundle. The full browser-bundle pipeline (module-table
 * loader closure, CSS Modules via lightningcss, purity gates) lands with the
 * client/web stage; until then every consumer builds its Node half during
 * the Host pass and skips the Client pass, matching the workspace contract
 * this file is expected to expose (clientBundle / clientOnly).
 */
import type { UserConfig } from 'tsdown'

/**
 * Workspace mode replaces an empty config array with the root defaults. A
 * falsey entry instead removes this package before entry resolution.
 */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

/** ENV key selecting the build face; mirrors the root tsdown.config.ts. */
type BuildFace = 'host' | 'client' | undefined

function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.FF_BUILD_FACE must be host or client, received ${String(value)}`)
}

/** Build a Node library from tsc -b output (lib/types/*.js to lib/*.js). */
function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  overrides: UserConfig = {},
): UserConfig {
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    ...overrides,
  }
}

interface ClientBundleOptions {
  /** Emit the Node-side artifacts during the Host pass instead of the Client pass. */
  readonly hostPhase?: boolean
  /** Additional Node-side configs emitted alongside the package library. */
  readonly companions?: readonly UserConfig[]
  /** Overrides for the package's primary Node-side library config. */
  readonly lib?: UserConfig
}

type BuildFaceConfig = (ctx: { env?: Record<string, unknown> }) => UserConfig[]

/**
 * ENV-selected tsdown config for the current build face. The client bundle
 * itself arrives with the client/web stage; today only the Node half builds.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): BuildFaceConfig {
  const lib = clientLibraryConfig(id, libEntry, options.lib)
  return ({ env }) => {
    const face = buildFace(env?.FF_BUILD_FACE)
    const node = [lib, ...(options.companions ?? [])]
    // Client pass pending: the browser artifact is part of the client stage.
    if (face === 'host') return options.hostPhase === true ? node : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') return [SKIP_WORKSPACE_BUILD]
    return node
  }
}

/**
 * Client-only Node library (skip until the client/web stage lands).
 * TODO(client-stage): revisit once browser bundles land.
 */
export function clientOnly(_configs: readonly UserConfig[]): BuildFaceConfig {
  return () => [SKIP_WORKSPACE_BUILD]
}
