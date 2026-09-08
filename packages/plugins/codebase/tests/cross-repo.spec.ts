/**
 * EP-CB4 T5.4 — cross-repository intelligence suite: detectCrossProjectEdges
 * resolves sibling targets against real sibling stores and records graded
 * CROSS_* edges in the local project. Real node:sqlite in temp dirs, no mocks.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, detectCrossProjectEdges } from '../src/index.ts'
import type { SiblingProject } from '../src/index.ts'

interface StoreFixture {
  store: CodebaseStore
  dbPath: string
}

let fixtures: StoreFixture[]

function openStore(slug: string): StoreFixture {
  const d = mkdtempSync(join(tmpdir(), `ff-codebase-${slug}-`))
  const dirtrack = d
  const store = new CodebaseStore(join(dirtrack, 'codebase.db'))
  store.open()
  const fixture = { store, dbPath: join(dirtrack, 'codebase.db') }
  fixtures.push(fixture)
  return fixture
}

beforeEach(() => {
  fixtures = []
})

afterEach(() => {
  for (const fixture of fixtures) {
    fixture.store.dispose()
    rmSync(fixture.dbPath.replace(/codebase\.db$/, ''), { recursive: true, force: true })
  }
})

describe('detectCrossProjectEdges (T5.4)', () => {
  it('resolves a sibling QN into a namespaced CROSS_HTTP_CALLS edge', () => {
    const local = openStore('local')
    const sibling = openStore('sib')
    local.store.registerProject('demo')
    sibling.store.registerProject('siblingA')
    sibling.store.upsertNodes([
      { id: 'fn:srv.http.Client', project: 'siblingA', label: 'Function', name: 'pkg.http.Client' },
    ])
    local.store.upsertNodes([
      { id: 'fn:gateway', project: 'demo', label: 'Function', name: 'gateway', props: { crossHttpTargets: 'siblingA::pkg.http.Client' } },
    ])

    const opts: { siblings: readonly SiblingProject[] } = { siblings: [{ name: 'siblingA', dbPath: sibling.dbPath }] }
    const result = detectCrossProjectEdges(local.store, 'demo', opts)

    expect(result.contributions).toHaveLength(1)
    expect(result.contributions[0]).toEqual({
      project: 'demo',
      source: 'fn:gateway',
      target: 'siblingA::pkg.http.Client',
      type: 'CROSS_HTTP_CALLS',
    })
    const stored = local.store.edgesByType('demo', ['CROSS_HTTP_CALLS'])
    expect(stored.some(edge => edge.source === 'fn:gateway' && edge.target === 'siblingA::pkg.http.Client' && edge.type === 'CROSS_HTTP_CALLS')).toBe(true)
  })

  it('records each driver onto its own CROSS_* edge family', () => {
    const local = openStore('local2')
    const sibling = openStore('sib2')
    local.store.registerProject('demo')
    sibling.store.registerProject('siblingA')
    sibling.store.upsertNodes([
      { id: 'n:http', project: 'siblingA', label: 'Function', name: 'pkg.http.Client' },
      { id: 'n:async', project: 'siblingA', label: 'Function', name: 'pkg.async.Dispatch' },
      { id: 'n:chan', project: 'siblingA', label: 'Function', name: 'pkg.channel.Sink' },
    ])
    local.store.upsertNodes([
      {
        id: 'fn:hub',
        project: 'demo',
        label: 'Function',
        name: 'hub',
        props: {
          crossHttpTargets: 'siblingA::pkg.http.Client',
          crossAsyncTargets: 'siblingA::pkg.async.Dispatch',
          crossChannelTargets: 'siblingA::pkg.channel.Sink',
        },
      },
    ])
    const result = detectCrossProjectEdges(local.store, 'demo', { siblings: [{ name: 'siblingA', dbPath: sibling.dbPath }] })
    expect(result.contributions).toHaveLength(3)
    expect(result.contributions.map(edge => edge.type).sort()).toEqual(['CROSS_ASYNC_CALLS', 'CROSS_CHANNEL', 'CROSS_HTTP_CALLS'])
  })

  it('emits nothing for unresolvable / missing / malformed targets', () => {
    const local = openStore('local3')
    const sibling = openStore('sib3')
    local.store.registerProject('demo')
    sibling.store.registerProject('siblingA')
    sibling.store.upsertNodes([{ id: 'n:ok', project: 'siblingA', label: 'Function', name: 'pkg.existing.Only' }])
    local.store.upsertNodes([
      // Sibling exists but has no matching QN.
      { id: 'fn:x', project: 'demo', label: 'Function', name: 'x', props: { crossAsyncTargets: 'siblingA::no.such.node' } },
      // Sibling name not registered among the options.
      { id: 'fn:y', project: 'demo', label: 'Function', name: 'y', props: { crossChannelTargets: 'ghost::pkg.Channel' } },
      // Malformed target without the '::' separator.
      { id: 'fn:z', project: 'demo', label: 'Function', name: 'z', props: { crossHttpTargets: 'plainTarget' } },
      // No cross driver props at all.
      { id: 'fn:w', project: 'demo', label: 'Function', name: 'w' },
    ])
    const result = detectCrossProjectEdges(local.store, 'demo', { siblings: [{ name: 'siblingA', dbPath: sibling.dbPath }] })
    expect(result.contributions).toEqual([])
  })
})