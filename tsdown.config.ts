import { existsSync, readFileSync } from 'node:fs'

import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

/**
 * The Host pass's workspace list: the Host TypeScript project's own references,
 * narrowed to the packages this pass can actually bundle.
 *
 * The host pass bundles `lib/types/{index,invariant,startup}.js`, which only
 * exists once `tsc -b tsconfig.host.json` has emitted that project — so a
 * package outside the build graph can never supply an entry and used to abort
 * the whole bundle with "Cannot find entry". Deriving the list from the
 * references keeps the bundle graph a subset of the build graph, so the two
 * cannot drift apart again.
 *
 * The build graph also references projects this pass must not touch: the native
 * `landlock-run` packages emit no TypeScript, and a few reference entries are
 * tsconfig-only directories rather than workspace packages. Those are filtered
 * out by requiring a `package.json` inside the original bundle scopes
 * (`packages/*<slash>*`, `vendor/*`, `apps/cli`).
 */
function hostWorkspaceEntries(): string[] {
  const manifest = readFileSync(new URL('./tsconfig.host.json', import.meta.url), 'utf8')
  const config = JSON.parse(manifest) as { references?: { path: string }[] }
  return (config.references ?? [])
    .map(reference => reference.path.replace(/^\.\//, '').replace(/\/tsconfig\.host\.json$/, ''))
    .filter(candidate =>
      candidate === 'apps/cli' || candidate.split('/').length === 2,
    )
    .filter(candidate => candidate.startsWith('packages/') || candidate.startsWith('vendor/') || candidate === 'apps/cli')
    .filter(candidate => existsSync(new URL(`./${candidate}/package.json`, import.meta.url)))
}

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.FF_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.FF_BUILD_FACE)
  return {
    workspace: client ? ['vendor/*', 'packages/*/*', 'apps/cli'] : hostWorkspaceEntries(),
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
