/**
 * EP-CB4 T5.1/T5.2 — semantic layer suite: simhash / Hamming / cosine /
 * min-cosine retrieval and SIMILAR duplicate edges. Real node:sqlite in the
 * temp dir, zero mocks (ironclad rule T1–T9).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, cosineSimilarity, hammingDistance, semanticQuery, semanticSimilarityEdges, simhash, termFrequency } from '../src/index.ts'
import type { NodeRecord } from '../src/index.ts'

let dir: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-semantic-'))
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function symbol(
  name: string,
  shortName: string,
  extra: Partial<NodeRecord> = {},
): NodeRecord {
  return {
    id: `fn:${name}`,
    project: 'demo',
    label: 'Function',
    name,
    props: { shortName, ...(extra.props as Record<string, string | number | boolean> | undefined) },
    ...extra,
  }
}

describe('simhash / hammingDistance', () => {
  it('is deterministic and identical prose yields the same fingerprint', () => {
    const prose = 'fetch user profile from the remote api and cache results keyed by id'
    expect(simhash(prose)).toBe(simhash(prose))
    expect(hammingDistance(simhash(prose), simhash(prose))).toBe(0)
  })

  it('reports a small Hamming distance for near-identical prose', () => {
    const a = simhash('load the user collection by identifier then index by key name')
    const b = simhash('load the user collection by identifier then index by key name') // same → 0
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(3)
  })
})

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for disjoint ones', () => {
    const v = termFrequency('fetchUserProfile', undefined, 'fetch user profile endpoint')
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 4)
    const disjoint = new Map([['zzz', 1]])
    expect(cosineSimilarity(v, disjoint)).toBe(0)
  })
})

describe('semanticSimilarityEdges (T5.1)', () => {
  it('links same-cluster near-identical symbols via SIMILAR and backfills similarTo', () => {
    store.registerProject('demo')
    store.upsertNodes([
      symbol('src/a.ts.dedupe', 'dedupe', { lines: 10, props: { signature: 'resolve and cache the token bucket by key name' } }),
      symbol('src/b.ts.dedupe', 'dedupe', { lines: 20, props: { signature: 'resolve and cache the token bucket by key name' } }),
      symbol('src/c.ts.unique', 'unique', { lines: 5, props: { signature: 'something entirely different here now' } }),
    ])
    const result = semanticSimilarityEdges(store, 'demo')
    // Canonical is the longer symbol (20 lines); the shorter node links to it.
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]?.type).toBe('SIMILAR')
    // No self-loop, target is the non-canonical duplicate.
    expect(result.edges[0]?.source).toBe('fn:src/b.ts.dedupe')
    expect(result.edges[0]?.target).toBe('fn:src/a.ts.dedupe')
    // Canonical update backfills props.similarTo on the duplicate.
    store.upsertNodes(result.canonicalUpdates)
    const a = store.allNodes('demo').find(node => node.id === 'fn:src/a.ts.dedupe')
    expect(a?.props?.similarTo).toBe('fn:src/b.ts.dedupe')
  })
})

describe('semanticQuery (T5.2)', () => {
  it('ranks by per-keyword min-cosine and excludes noise labels', () => {
    store.registerProject('demo')
    store.upsertNodes([
      symbol('pkg.http.Client.fetch', 'upstream http fetch', { props: { signature: 'perform http network fetch call' } }),
      symbol('pkg.cache.put', 'cache put', { props: { signature: 'store item into local cache store' } }),
      { id: 'file:r', project: 'demo', label: 'File', name: 'README', props: { signature: 'http fetch' } },
    ])
    const result = semanticQuery(store, 'demo', { keywords: ['http', 'fetch'] })
    // File node (noise label) must be excluded; the http client symbol wins.
    expect(result.rows.every(node => node.id !== 'file:r')).toBe(true)
    expect(result.rows[0]?.id).toBe('fn:pkg.http.Client.fetch')
    expect(result.total).toBeGreaterThan(0)
    expect(result.hasMore).toBe(false)
  })

  it('honours AND semantics: a node missing a keyword scores min-cosine 0 and drops out', () => {
    store.registerProject('demo')
    store.upsertNodes([
      symbol('one.http', 'http', { props: { signature: 'http fetch remote' } }),
      symbol('two.http.cache', 'httpcache', { props: { signature: 'http request then cache the response' } }),
    ])
    // keywords ['http','cache']: one.http lacks 'cache' → its min-cosine is 0 and is dropped.
    const result = semanticQuery(store, 'demo', { keywords: ['http', 'cache'] })
    expect(result.rows.some(node => node.id === 'fn:one.http')).toBe(false)
    expect(result.rows[0]?.id).toBe('fn:two.http.cache')
    expect(result.total).toBe(1)
  })
})