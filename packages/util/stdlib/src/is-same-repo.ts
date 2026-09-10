/**
 * Git repository identity helpers — decide whether two paths live in the same
 * repository by comparing their `git rev-parse --git-common-dir` results.
 *
 * Ported from clowder-ai `api/src/utils/is-same-repo.ts`.
 * Only depends on Node built-ins (`node:child_process`, `node:fs`, `node:path`).
 */

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

function gitCommonDir(dir: string): string | null {
  try {
    const d = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    return realpathSync(resolve(dir, d))
  } catch {
    return null
  }
}

let cachedRepoGitDir: string | null | undefined

/**
 * Warm the repository-identity cache for a given repo root. Optional; calling
 * `isSameRepo` is enough on its own.
 */
export function initRepoIdentity(repoRoot: string): void {
  cachedRepoGitDir = gitCommonDir(repoRoot)
}

/**
 * Return `true` when `projectPath` is inside the same git repository as
 * `repoRoot`. Non-repository paths resolve to `false`.
 */
export function isSameRepo(projectPath: string, repoRoot: string): boolean {
  if (resolve(projectPath) === resolve(repoRoot)) return true
  if (cachedRepoGitDir === undefined) initRepoIdentity(repoRoot)
  if (!cachedRepoGitDir) return false

  const projGitDir = gitCommonDir(projectPath)
  return projGitDir !== null && projGitDir === cachedRepoGitDir
}