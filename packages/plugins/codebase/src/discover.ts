/**
 * @flowforge/plugin-codebase — file discovery (EP-CB0, T1.4).
 *
 * Ported from codebase-memory-mcp's discover module: walk the repository,
 * apply default + caller-provided exclusion rules, and report what was
 * deliberately excluded (coverage honesty contract: `excluded` is by design,
 * not a failure).
 *
 * @module @flowforge/plugin-codebase/discover
 */

import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Directory names excluded by design (build outputs, caches, VCS internals). */
export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'lib',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.flowforge',
  '.trae-cn',
  '__pycache__',
  '.venv',
  'target',
]

export interface DiscoveredFile {
  /** Repo-relative path with forward slashes (stable across platforms). */
  readonly relativePath: string
  readonly absolutePath: string
  readonly sizeBytes: number
}

export interface DiscoverResult {
  readonly files: readonly DiscoveredFile[]
  /** Exclusion rules that fired (default dirs + caller patterns), for coverage reporting. */
  readonly excluded: readonly string[]
}

export interface DiscoverOptions {
  /** Patterns beyond the default directory exclusions (matched against relative path segments). */
  readonly exclude?: readonly string[]
}

function toRelative(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/')
}

function isExcludedDir(name: string, extra: readonly string[]): boolean {
  return DEFAULT_EXCLUDED_DIRS.includes(name) || extra.includes(name)
}

/**
 * Walk `root` breadth-first and collect files. Symlinked directories are not
 * followed (cycle safety). Files that fail to stat are skipped silently —
 * the indexer reports them via the coverage contract instead.
 */
export function discoverFiles(root: string, options: DiscoverOptions = {}): DiscoverResult {
  const extra = options.exclude ?? []
  const excluded = new Set<string>()
  for (const dir of DEFAULT_EXCLUDED_DIRS) excluded.add(dir)
  for (const pattern of extra) excluded.add(pattern)
  const files: DiscoveredFile[] = []
  const queue: string[] = [root]
  while (queue.length > 0) {
    const dir = queue.shift() as string
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (isExcludedDir(entry.name, extra)) continue
        if (entry.isSymbolicLink()) continue
        queue.push(absolute)
        continue
      }
      if (!entry.isFile()) continue
      let size: number
      try {
        size = statSync(absolute).size
      } catch {
        continue
      }
      files.push({ relativePath: toRelative(root, absolute), absolutePath: absolute, sizeBytes: size })
    }
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return { files, excluded: Array.from(excluded).sort() }
}
