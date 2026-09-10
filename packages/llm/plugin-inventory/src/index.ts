/**
 * Pure plugin-package inventory: resolves the exact owning package identity of
 * an active plugin module and folds deduplicated, deterministically sorted
 * package sets. The resolver is a small injectable pure query — no host, Loader,
 * or cordis coupling lives here; a host supplies its own active-entry rows and
 * manifest resolver.
 *
 * @module @flowforge/llm-plugin-inventory
 */

import { dirname, isAbsolute, join, parse } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { DeepSeekPluginPackageIdentity } from './types.ts'

export type * from './types.ts'

/** One active plugin row handed to the query. */
export interface ActivePluginEntry {
  /** Bare package specifier, relative module path, or absolute module path. */
  readonly name: string
  /** Base URL the entry was resolved against (module loader provenance). */
  readonly treeBaseUrl: string
  /** Optional alternate anchor that resolved the entry (e.g. a preset root). */
  readonly baseUrl?: string
}

/** Manifest read-back. */
export interface PackageManifest {
  readonly name?: unknown
  readonly version?: unknown
}

/** Manifest reading seam — hosts supply `fs`-backed reads, tests supply fixtures. */
export interface ManifestReader {
  exists(path: string): boolean
  read(path: string): PackageManifest
}

/** Parse a bare package or package-subpath specifier into its package name. */
export function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.includes(':') || isAbsolute(specifier)) return undefined
  const [first = '', second = ''] = specifier.split('/')
  // An active entry already passed module resolution, so a scoped bare name has its package segment.
  return first.startsWith('@') ? `${first}/${second}` : first
}

/** Read one manifest identity, optionally treating an absent name as a loose-module marker. */
export function identityFromManifest(
  manifest: PackageManifest,
  path: string,
  allowAnonymous: boolean,
  packageLabel: string,
): DeepSeekPluginPackageIdentity | undefined {
  if (allowAnonymous && manifest.name === undefined) return undefined
  if (typeof manifest.name !== 'string' || manifest.name.length === 0
    || typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`${packageLabel}: ${path} must declare non-empty name and version`)
  }
  return { name: manifest.name, version: manifest.version }
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${name}`
}

/** Find the nearest owning manifest path for a relative or absolute plugin module. */
export function nearestManifestPath(modulePath: string, reader: ManifestReader): string | undefined {
  let current = dirname(modulePath)
  const root = parse(current).root
  while (true) {
    const manifest = joinPath(current, 'package.json')
    if (reader.exists(manifest)) return manifest
    if (current === root) return undefined
    current = dirname(current)
  }
}

const nullReader: ManifestReader = {
  exists: () => false,
  read: () => ({}),
}

/**
 * Resolve one active entry's owning package identity, or absence for a
 * non-package loose module. Manifest lookup walks Node-style search paths
 * anchored at the entry's resolution base.
 */
export function resolveActivePackageIdentity(
  entry: ActivePluginEntry,
  reader: ManifestReader = nullReader,
  packageLabel = 'llm-plugin-inventory',
): DeepSeekPluginPackageIdentity | undefined {
  const packageName = barePackageName(entry.name)
  let manifestPath: string | undefined
  if (packageName !== undefined) {
    for (const anchor of [entry.treeBaseUrl, entry.baseUrl ?? entry.treeBaseUrl]) {
      manifestPath = findManifestUpward(packageName, anchor, reader)
      if (manifestPath !== undefined) break
    }
    if (manifestPath === undefined) {
      throw new Error(`${packageLabel}: cannot resolve active package ${JSON.stringify(packageName)}`)
    }
  } else if (!entry.name.startsWith('cordis:')) {
    const moduleUrl = isAbsolute(entry.name)
      ? pathToFileURL(entry.name)
      : new URL(entry.name, entry.treeBaseUrl)
    if (moduleUrl.protocol === 'file:') {
      manifestPath = nearestManifestPath(fileURLToPath(moduleUrl), reader)
    }
  }
  if (manifestPath === undefined) return undefined
  const manifest = reader.read(manifestPath)
  return identityFromManifest(manifest, manifestPath, packageName === undefined, packageLabel)
}

function findManifestUpward(packageName: string, baseUrl: string, reader: ManifestReader): string | undefined {
  // Node-style: walk each ancestor node_modules of the anchor's filesystem path.
  let current = anchorToPath(baseUrl)
  const root = parse(current).root
  while (true) {
    const manifest = join(current, 'node_modules', packageName, 'package.json')
    if (reader.exists(manifest)) return manifest
    if (current === root) return undefined
    current = dirname(current)
  }
}

function anchorToPath(anchor: string): string {
  try {
    const url = new URL(anchor)
    return url.protocol === 'file:' ? fileURLToPath(url) : anchor
  } catch {
    return anchor
  }
}

/** Deterministic text order independent of the host's ICU data and locale. */
export function compareWireText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Fold active entries into the deduplicated, name/version-sorted inventory.
 * Entries whose owning package is a loose anonymous module are omitted.
 */
export function collectActivePluginPackages(
  entries: readonly ActivePluginEntry[],
  reader: ManifestReader = nullReader,
  packageLabel = 'llm-plugin-inventory',
): DeepSeekPluginPackageIdentity[] {
  const unique = new Map<string, DeepSeekPluginPackageIdentity>()
  for (const entry of entries) {
    const identity = resolveActivePackageIdentity(entry, reader, packageLabel)
    if (identity === undefined) continue
    unique.set(`${identity.name}\u0000${identity.version}`, identity)
  }
  return [...unique.values()].sort((left, right) => (
    compareWireText(left.name, right.name) || compareWireText(left.version, right.version)
  ))
}