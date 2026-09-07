/**
 * EP-CB4 T5.3 — Hybrid LSP enhancement seam suite: augmentWithLsp forwards
 * symbol nodes to an optional LSP provider and persists only LSP edge types.
 * Real node:sqlite in the temp dir, zero mocks (ironclad rule T1–T9).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, augmentWithLsp, LSP_EDGE_TYPES } from '../src/index.ts'
import type { LspEnhanceRequest } from '../src/index.ts'
import type { EdgeRecord } from '../src/index.ts'

let dir: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-lsp-'))
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function fn(name: string, extra: { label?: string; filePath?: string; language?: string } = {}): void {
  store.upsertNodes([
    {
      id: `fn:${name}`,
      project: 'demo',
      label: (extra.label as 'Function' | 'Method' | 'Class' | 'Interface') ?? 'Function',
      name,
      ...(extra.filePath === undefined ? {} : { filePath: extra.filePath }),
      ...(extra.language === undefined ? {} : { language: extra.language }),
    },
  ])
}

describe('augmentWithLsp (T5.3)', () => {
  it('defaults to pure tree-sitter when no seam is provided', () => {
    store.registerProject('demo')
    fn('a')
    const result = augmentWithLsp(store, 'demo')
    expect(result.project).toBe('demo')
    expect(result.edges).toEqual([])
    expect(store.edgesByType('demo', LSP_EDGE_TYPES)).toEqual([])
  })

  it('forwards every symbol node and persists only LSP edge types', () => {
    store.registerProject('demo')
    fn('a', { filePath: 'src/a.ts', language: 'typescript' })
    fn('b', { label: 'Method' })
    const requests: LspEnhanceRequest[] = []
    const seam = {
      enhance(request: LspEnhanceRequest): readonly EdgeRecord[] {
        requests.push(request)
        return [
          { project: request.project, source: request.nodeId, target: 'fn:b', type: 'CALLS' },
          // Structural edge type must be filtered out by the seam contract.
          { project: request.project, source: request.nodeId, target: 'fn:b', type: 'CONTAINS_FILE' },
        ]
      },
    }
    const result = augmentWithLsp(store, 'demo', { seam })

    // One request per Function/Method/Class/Interface node.
    expect(requests).toHaveLength(2)
    expect(requests[0]?.nodeId).toBe('fn:a')
    expect(requests[0]?.filePath).toBe('src/a.ts')
    expect(requests[0]?.language).toBe('typescript')

    // Only the CALLS edge surrivives; CONTAINS_FILE is dropped.
    expect(result.edges).toHaveLength(2)
    expect(result.edges.every(edge => edge.type === 'CALLS')).toBe(true)

    // Persisted into the store (idempotent PK).
    const stored = store.edgesByType('demo', LSP_EDGE_TYPES)
    expect(stored.some(edge => edge.type === 'CALLS' && edge.source === 'fn:a' && edge.target === 'fn:b')).toBe(true)
  })

  it('is idempotent across repeated runs (INSERT OR IGNORE PK dedup)', () => {
    store.registerProject('demo')
    fn('a')
    const seam = { enhance: () => [{ project: 'demo', source: 'fn:a', target: 'fn:b', type: 'IMPLEMENTS' }] }
    augmentWithLsp(store, 'demo', { seam })
    augmentWithLsp(store, 'demo', { seam })
    expect(store.edgesByType('demo', LSP_EDGE_TYPES).filter(edge => edge.type === 'IMPLEMENTS')).toHaveLength(1)
  })
})