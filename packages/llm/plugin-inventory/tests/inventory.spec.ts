import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  barePackageName,
  collectActivePluginPackages,
  compareWireText,
  identityFromManifest,
  resolveActivePackageIdentity,
  type ManifestReader,
} from '../src/index.ts'

interface FixtureFile {
  path: string
  manifest: { name?: unknown; version?: unknown }
}

function fixtureReader(files: readonly FixtureFile[]): ManifestReader {
  const byPath = new Map(files.map(file => [file.path, file.manifest]))
  return {
    exists: path => byPath.has(path),
    read: path => {
      const manifest = byPath.get(path)
      if (manifest === undefined) throw new Error(`no fixture manifest at ${path}`)
      return manifest
    },
  }
}

/** Absolute fixture root mirroring a real node_modules layout. */
const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/', import.meta.url)).replace(/[\\/]+$/, '')
/** file:// URL anchor for the fixture directory (matches cordis baseUrl shape). */
const FIXTURE_ANCHOR = new URL('./fixtures/', import.meta.url).href

describe('barePackageName', () => {
  it('parses bare and scoped package names', () => {
    expect(barePackageName('flowforge-cordis')).toBe('flowforge-cordis')
    expect(barePackageName('@flowforge/cordis')).toBe('@flowforge/cordis')
    expect(barePackageName('@flowforge/cordis/lib/index.js')).toBe('@flowforge/cordis')
  })

  it('rejects relative, URL, and absolute specifiers', () => {
    expect(barePackageName('./plugin.ts')).toBeUndefined()
    expect(barePackageName('../plugin.ts')).toBeUndefined()
    expect(barePackageName('file:./plugin.ts')).toBeUndefined()
    expect(barePackageName('/abs/plugin.ts')).toBeUndefined()
  })
})

describe('identityFromManifest', () => {
  it('reads name and version', () => {
    expect(identityFromManifest({ name: 'pkg', version: '1.2.3' }, '/x/package.json', false, 'test'))
      .toEqual({ name: 'pkg', version: '1.2.3' })
  })

  it('treats an absent name as a loose-module marker when allowed', () => {
    expect(identityFromManifest({ version: '1.0.0' }, '/x/package.json', true, 'test')).toBeUndefined()
  })

  it('rejects malformed manifests', () => {
    expect(() => identityFromManifest({ name: '', version: '1' }, '/x/package.json', false, 'test'))
      .toThrow(/non-empty name and version/)
    expect(() => identityFromManifest({ name: 'pkg' }, '/x/package.json', false, 'test'))
      .toThrow(/non-empty name and version/)
  })
})

describe('resolveActivePackageIdentity', () => {
  it('resolves a bare package through node_modules search paths', () => {
    const reader = fixtureReader([{
      path: join(FIXTURE_ROOT, 'node_modules', '@flowforge', 'plugin-a', 'package.json'),
      manifest: { name: '@flowforge/plugin-a', version: '1.0.0' },
    }])
    const identity = resolveActivePackageIdentity({
      name: '@flowforge/plugin-a',
      treeBaseUrl: FIXTURE_ANCHOR,
    }, reader)
    expect(identity).toEqual({ name: '@flowforge/plugin-a', version: '1.0.0' })
  })

  it('throws when an active bare package has no reachable manifest', () => {
    const reader = fixtureReader([])
    expect(() => resolveActivePackageIdentity({
      name: 'missing-pkg',
      treeBaseUrl: FIXTURE_ANCHOR,
    }, reader)).toThrow(/cannot resolve active package/)
  })

  it('resolves a loose module to its nearest manifest without a name (anonymous)', () => {
    const reader = fixtureReader([{
      path: join(FIXTURE_ROOT, 'loose-module', 'package.json'),
      manifest: { version: '0.0.0' },
    }])
    const identity = resolveActivePackageIdentity({
      name: './loose-module/index.ts',
      treeBaseUrl: FIXTURE_ANCHOR,
    }, reader)
    expect(identity).toBeUndefined()
  })

  it('skips cordis: prefixed builtins', () => {
    const reader = fixtureReader([])
    expect(resolveActivePackageIdentity({ name: 'cordis:core', treeBaseUrl: 'file:///x/' }, reader))
      .toBeUndefined()
  })
})

describe('collectActivePluginPackages', () => {
  it('deduplicates identical identities and sorts by name then version', () => {
    const reader = fixtureReader([
      { path: join(FIXTURE_ROOT, 'node_modules', 'b-pkg', 'package.json'), manifest: { name: 'b-pkg', version: '2.0.0' } },
      { path: join(FIXTURE_ROOT, 'node_modules', 'a-pkg', 'package.json'), manifest: { name: 'a-pkg', version: '1.0.0' } },
      { path: join(FIXTURE_ROOT, 'nested', 'node_modules', 'b-pkg', 'package.json'), manifest: { name: 'b-pkg', version: '1.0.0' } },
    ])
    const nestedAnchor = new URL('./fixtures/nested/', import.meta.url).href
    const entries = [
      { name: 'b-pkg', treeBaseUrl: FIXTURE_ANCHOR },
      { name: 'b-pkg', treeBaseUrl: FIXTURE_ANCHOR },
      { name: 'a-pkg', treeBaseUrl: FIXTURE_ANCHOR },
      { name: 'a-pkg', treeBaseUrl: FIXTURE_ANCHOR },
      { name: 'b-pkg', treeBaseUrl: nestedAnchor, baseUrl: FIXTURE_ANCHOR },
    ]
    expect(collectActivePluginPackages(entries, reader)).toEqual([
      { name: 'a-pkg', version: '1.0.0' },
      { name: 'b-pkg', version: '1.0.0' },
      { name: 'b-pkg', version: '2.0.0' },
    ])
  })

  it('omits anonymous loose modules', () => {
    expect(collectActivePluginPackages([
      { name: './loose/index.ts', treeBaseUrl: FIXTURE_ANCHOR },
    ], fixtureReader([]))).toEqual([])
  })
})

describe('compareWireText', () => {
  it('orders deterministically without locale data', () => {
    expect(compareWireText('a', 'b')).toBe(-1)
    expect(compareWireText('b', 'a')).toBe(1)
    expect(compareWireText('a', 'a')).toBe(0)
  })
})
