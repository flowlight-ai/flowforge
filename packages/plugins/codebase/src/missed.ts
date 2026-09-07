/**
 * @flowforge/plugin-codebase — missed graph (EP-CB3, T4.2).
 *
 * "Absence ≠ complete": reports which on-disk files were NOT indexed, folded
 * into a navigable directory skeleton. Complements EP-CB2's flat
 * checkIndexCoverage list (this surface returns a directory tree).
 *
 * @module @flowforge/plugin-codebase/missed
 */

import type { CodebaseStore } from './store.ts'
import { discoverFiles } from './discover.ts'
import { requireProject } from './query.ts'

export interface MissedFile {
  /** Repo-relative path of a file absent from the index. */
  readonly path: string
}

export interface MissedDir {
  readonly dir: string
  readonly files: readonly MissedFile[]
  readonly subdirs: readonly MissedDir[]
}

export interface MissedResult {
  readonly project: string
  readonly totalMissed: number
  readonly tree: readonly MissedDir[]
  readonly files: readonly MissedFile[]
}

interface Node {
  readonly name: string
  readonly files: MissedFile[]
  readonly children: Map<string, Node>
}

/**
 * Compute the missed-graph skeleton: discovered disk files minus indexed File
 * nodes, folded into a directory tree (roots at the project root level).
 */
export function missedGraph(store: CodebaseStore, project: string, repoPath: string): MissedResult {
  requireProject(store, project)
  const indexed = new Set(
    store.listFileNodes(project)
      .map(node => node.filePath)
      .filter((path): path is string => path !== undefined),
  )
  const disk = discoverFiles(repoPath.replace(/\\/g, '/'))
  const missed: MissedFile[] = disk.files
    .filter(file => !indexed.has(file.relativePath))
    .map(file => ({ path: file.relativePath }))
    .sort((a, b) => a.path.localeCompare(b.path))

  // Build a directory tree from the missed file paths.
  const root = new Map<string, Node>()
  const ensure = (dir: string): Node => {
    const segments = dir.split('/').filter(segment => segment.length > 0)
    if (segments.length === 0) {
      // Root-level files fold under a single "" bucket stored in root.
      let bucket = root.get('')
      if (bucket === undefined) {
        bucket = { name: '', files: [], children: new Map<string, Node>() }
        root.set('', bucket)
      }
      return bucket
    }
    let level = root
    let current: Node | undefined
    let acc = ''
    for (const segment of segments) {
      acc = acc === '' ? segment : `${acc}/${segment}`
      let entry = level.get(acc)
      if (entry === undefined) {
        entry = { name: segment, files: [], children: new Map<string, Node>() }
        level.set(acc, entry)
      }
      current = entry
      level = entry.children
    }
    return current ?? { name: '', files: [], children: new Map<string, Node>() }
  }

  for (const file of missed) {
    const slash = file.path.lastIndexOf('/')
    const dirPath = slash < 0 ? '' : file.path.slice(0, slash)
    const folder = ensure(dirPath)
    folder.files.push(file)
  }

  // Convert the nested map to a sorted tree.
  const toTree = (nodes: Map<string, Node>): readonly MissedDir[] => {
    const list = Array.from(nodes.values()).sort((a, b) => a.name.localeCompare(b.name))
    return list.map(node => ({
      dir: node.name,
      files: [...node.files].sort((a, b) => a.path.localeCompare(b.path)),
      subdirs: toTree(node.children),
    }))
  }

  return {
    project,
    totalMissed: missed.length,
    tree: toTree(root),
    files: missed,
  }
}