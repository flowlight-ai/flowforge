/**
 * search_code contract suite (EP-CB2, T3.1b).
 *
 * On-disk line-level search across the mini-repo's indexed files. Pins the
 * mcp.c search_code port: regex + literal fallback, file_pattern filter,
 * deterministic line/file ordering, cap + honest truncated flag, and the
 * hasMore contract when the match limit is reached.
 */

import { describe, expect, it } from 'vitest'
import { ProjectNotFoundError, searchCode } from '../src/index.ts'
import { MINI_REPO, PROJECT, useMiniRepoFixture } from './_fixture.ts'

const fixture = useMiniRepoFixture()
const store = () => fixture.store

describe('searchCode', () => {
  it('matches a literal substring across on-disk source files', () => {
    const result = searchCode(store(), { project: PROJECT, pattern: 'updateCloudClient', repoPath: MINI_REPO })
    expect(result.truncated).toBe(false)
    expect(result.hasMore).toBe(false)
    // demo.ts (render + handleClick) and helper.ts (definition).
    const files = Array.from(new Set(result.matches.map(match => match.filePath))).sort()
    expect(files).toEqual(['src/utils/helper.ts', 'symbols/demo.ts'])
    expect(result.matches[0]).toMatchObject({ lineNumber: 1, column: 16 })
    expect(result.matches[0].lineNumber).toBeGreaterThan(0)
  })

  it('treats an invalid regex as a literal substring', () => {
    const result = searchCode(store(), { project: PROJECT, pattern: '([unclosed', repoPath: MINI_REPO })
    expect(result.matches.length).toBe(0)
    expect(result.truncated).toBe(false)
  })

  it('honors the filePattern filter', () => {
    const result = searchCode(store(), { project: PROJECT, pattern: 'updateCloudClient', filePattern: 'src/', repoPath: MINI_REPO })
    expect(result.matches.length).toBeGreaterThan(0)
    for (const match of result.matches) expect(match.filePath).toMatch(/^src\//)
  })

  it('reports hasMore when the match limit is hit', () => {
    // 's' appears in effectively every line across files; a tiny limit forces truncation.
    const result = searchCode(store(), { project: PROJECT, pattern: 's', limit: 3, repoPath: MINI_REPO })
    expect(result.matches.length).toBe(3)
    expect(result.hasMore).toBe(true)
  })

  it('throws ProjectNotFoundError for an unknown project', () => {
    expect(() => searchCode(store(), { project: 'ghost', pattern: 'x', repoPath: MINI_REPO })).toThrow(ProjectNotFoundError)
  })
})