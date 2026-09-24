import { existsSync, readdirSync } from 'node:fs'
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.FF_BUILD_FACE must be host or client, received ${String(value)}`)
}

/** Directories directly under `dir`, in absolute path form. */
function subdirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => `${dir}/${e.name}`)
}

/**
 * Packages the Host pass bundles. A tsdown workspace glob picks up a directory
 * even when it is not a package (no `package.json`, e.g. the tests-only scaffold
 * `packages/limb/e2e`); without a `lib/types` entry that aborts the whole bundle
 * with "Cannot find entry". Deriving the list from real `package.json`
 * directories under the pnpm workspaces (`vendor/*`, `packages/*<slash>*`,
 * `apps/*`) keeps the bundle graph a subset of the buildable packages.
 */
function packageWorkspaceEntries(): string[] {
  const dirs: string[] = []
  for (const pkg of subdirs('vendor')) {
    if (existsSync(`${pkg}/package.json`)) dirs.push(pkg)
  }
  for (const group of subdirs('packages')) {
    for (const pkg of subdirs(group)) {
      if (existsSync(`${pkg}/package.json`)) dirs.push(pkg)
    }
  }
  for (const pkg of subdirs('apps')) {
    if (existsSync(`${pkg}/package.json`)) dirs.push(pkg)
  }
  return dirs
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
    workspace: packageWorkspaceEntries(),
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
