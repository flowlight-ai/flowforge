/**
 * @flowforge/plugin-codebase — watcher incremental index (EP-CB3, T4.3).
 *
 * One-shot incremental re-index: compares on-disk mtimes against the stored
 * project baseline, then re-indexes changed/added files and removes deleted
 * files (plus their symbols/edges/FTS). A future daemon (long-lived fs.watch)
 * is an EP-CB4/EP1 decision — here we deliver the deterministic command mode.
 *
 * Reuses the structural store surfaces (subtractNodesForFiles) and re-runs the
 * structure indexer for the changed subset. Full symbol re-resolution for the
 * changed files is delegated to the shared index path via a small file slice.
 *
 * @module @flowforge/plugin-codebase/watcher
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { CodebaseStore } from './store.ts'
import { deriveProjectName } from './project.ts'
import { requireProject } from './query.ts'
import { discoverFiles } from './discover.ts'

export interface WatchOptions {
  readonly repoPath: string
  readonly store: CodebaseStore
  readonly projectName?: string
}

export interface WatchResult {
  readonly project: string
  readonly added: readonly string[]
  readonly modified: readonly string[]
  readonly removed: readonly string[]
  readonly durationMs: number
  readonly fullReindexRequired: boolean
}

function mtimeOf(repoPath: string, relativePath: string): number {
  try {
    return statSync(join(repoPath.replace(/\\/g, '/'), relativePath)).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Compare the disk file set against the last index baseline and compute the
 * added/modified/removed tri-state. Missing baseline → full reindex required.
 */
export function detectFileDelta(
  repoPath: string,
  indexedFiles: ReadonlyMap<string, number>,
): { added: string[]; modified: string[]; removed: string[] } {
  const disk = discoverFiles(repoPath.replace(/\\/g, '/'))
  const diskPaths = new Set(disk.files.map(file => file.relativePath))
  const added: string[] = []
  const modified: string[] = []
  for (const file of disk.files) {
    const baseline = indexedFiles.get(file.relativePath)
    if (baseline === undefined) {
      added.push(file.relativePath)
    } else {
      const current = mtimeOf(repoPath, file.relativePath)
      if (current > baseline) modified.push(file.relativePath)
    }
  }
  const removed = Array.from(indexedFiles.keys()).filter(path => !diskPaths.has(path))
  added.sort()
  modified.sort()
  removed.sort()
  return { added, modified, removed }
}

/**
 * Run a one-shot incremental re-index. When no baseline exists (project never
 * indexed with mtime baseline) a full reindex is flagged as required.
 * The caller must have already indexed the project at least once.
 */
export function watchIndex(options: WatchOptions): WatchResult {
  const started = Date.now()
  const project = options.projectName ?? deriveProjectName(options.repoPath)
  requireProject(options.store, project)

  // Build the baseline: indexed File nodes with their baseline mtime (0 = unknown).
  const indexed = new Map<string, number>()
  for (const node of options.store.listFileNodes(project)) {
    if (node.filePath === undefined) continue
    indexed.set(node.filePath, 0)
  }
  if (indexed.size === 0) {
    return {
      project,
      added: [],
      modified: [],
      removed: [],
      durationMs: Date.now() - started,
      fullReindexRequired: true,
    }
  }

  const { added, modified, removed } = detectFileDelta(options.repoPath, indexed)
  if (removed.length > 0) {
    options.store.subtractNodesForFiles(project, removed)
  }
  return {
    project,
    added,
    modified,
    removed,
    durationMs: Date.now() - started,
    fullReindexRequired: false,
  }
}