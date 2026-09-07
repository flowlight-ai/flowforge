/**
 * @flowforge/plugin-codebase — change detection (EP-CB2, T3.2b).
 *
 * Ported from codebase-memory-mcp's `detect_changes` tool, implemented as a
 * pure-Node git-aware scan (no git CLI / network dependency — stays consistent
 * across environments and honors the T1-T9 no-mock / no-external-call rules):
 * files whose mtime is newer than the project's `last_indexed_at` are flagged
 * as changed; files absent on disk are reported as removed; indexed files that
 * appear but lack an indexed row are reported as added.
 *
 * Pure read-only consumer over the store + fs.stat.
 *
 * @module @flowforge/plugin-codebase/changes
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { CodebaseStore } from './store.ts'
import { ProjectNotFoundError } from './query.ts'
import { discoverFiles } from './discover.ts'

export interface DetectChangesOptions {
  readonly project: string
  readonly repoPath: string
}

export interface ChangeGroup {
  readonly changed: readonly string[]
  readonly added: readonly string[]
  readonly removed: readonly string[]
}

export interface DetectChangesResult extends ChangeGroup {
  readonly project: string
  readonly lastIndexedAt: string | undefined
  readonly totalChanged: number
}

/**
 * Detect source changes since the last index. `baseline` is the project's
 * `last_indexed_at`; when absent, every file is treated as changed (no index).
 */
export function detectChanges(store: CodebaseStore, options: DetectChangesOptions): DetectChangesResult {
  const project = options.project
  if (store.listProjects().find(info => info.name === project) === undefined) {
    throw new ProjectNotFoundError(project)
  }
  const repoPath = options.repoPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const baseline = store.lastIndexedAt(project)
  const baselineMs = baseline === undefined ? new Date(0).getTime() : Date.parse(baseline)

  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  const indexedPaths = new Set<string>()
  for (const node of store.listFileNodes(project)) {
    const relPath = node.filePath
    if (relPath === undefined) continue
    indexedPaths.add(relPath)
    const absolute = join(repoPath.replaceAll('/', '\\'), relPath.split('/').join('\\'))
    let mtimeMs: number
    try {
      mtimeMs = statSync(absolute).mtimeMs
    } catch {
      removed.push(relPath)
      continue
    }
    if (mtimeMs > baselineMs) changed.push(relPath)
  }

  // Added detection: disk files (structural discovery) not present in the index.
  const disk = discoverFiles(repoPath.replaceAll('\\', '/'))
  for (const file of disk.files) {
    if (!indexedPaths.has(file.relativePath)) {
      const absolute = join(repoPath.replaceAll('/', '\\'), file.relativePath.split('/').join('\\'))
      let mtimeMs: number
      try {
        mtimeMs = statSync(absolute).mtimeMs
      } catch {
        continue
      }
      // Only files modified after the index baseline count as "added" hints.
      if (mtimeMs > baselineMs) added.push(file.relativePath)
    }
  }

  changed.sort()
  added.sort()
  removed.sort()
  return { project, lastIndexedAt: baseline, changed, added, removed, totalChanged: changed.length + added.length + removed.length }
}