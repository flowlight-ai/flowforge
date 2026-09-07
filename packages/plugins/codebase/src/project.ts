/**
 * @flowforge/plugin-codebase — project registry helpers (EP-CB0, T1.7).
 *
 * Ported from codebase-memory-mcp: project names derived from repository
 * directories are sanitized (non-ASCII percent-encoded, unsafe path
 * characters normalized) before they become identifiers.
 *
 * @module @flowforge/plugin-codebase/project
 */

import { basename } from 'node:path'

/** Sanitize a project name: percent-encode non-ASCII, normalize unsafe chars. */
export function sanitizeProjectName(name: string): string {
  const encoded = Array.from(name)
    .map(char => (char.charCodeAt(0) > 127 ? encodeURIComponent(char) : char))
    .join('')
  const normalized = encoded.replace(/[^A-Za-z0-9._-]+/g, '_')
  return normalized.length > 0 ? normalized : 'unnamed'
}

/** Derive the project name from the repository directory basename. */
export function deriveProjectName(repoPath: string): string {
  const base = basename(repoPath.replaceAll('\\', '/').replace(/\/+$/, ''))
  return sanitizeProjectName(base.length > 0 ? base : 'repo')
}
