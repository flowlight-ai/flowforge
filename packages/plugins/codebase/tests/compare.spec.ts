/**
 * compare_graphs contract suite (EP-CB2, T3.2c).
 *
 * Diffs node/edge sets between two project snapshots. Uses a second project
 * seeded with an explicit node so the added/removed/identical contract is
 * pinned deterministically against the real indexed mini-repo.
 */

import { describe, expect, it } from 'vitest'
import { compareGraphs, ProjectNotFoundError } from '../src/index.ts'
import type { NodeRecord } from '../src/index.ts'
import { PROJECT, useMiniRepoFixture } from './_fixture.ts'

const fixture = useMiniRepoFixture()
const store = () => fixture.store
const OTHER = 'demo-project-b'

function symbol(id: string, qn: string): NodeRecord {
  return { id, project: OTHER, label: 'Function', name: qn, lines: 1, props: { startLine: 1, endLine: 1 } }
}

describe('compareGraphs', () => {
  it('reports identical=true when comparing a snapshot to itself', () => {
    const result = compareGraphs(store(), { projectA: PROJECT, projectB: PROJECT })
    expect(result.identical).toBe(true)
    expect(result.added.nodes).toEqual([])
    expect(result.added.edges).toEqual([])
    expect(result.removed.nodes).toEqual([])
    expect(result.removed.edges).toEqual([])
  })

  it('diffs node sets between two projects deterministically', () => {
    store().registerProject(OTHER)
    store().upsertNodes([symbol('s:other:fnew', `${OTHER}.fnew`)])
    const result = compareGraphs(store(), { projectA: PROJECT, projectB: OTHER })
    expect(result.identical).toBe(false)
    // B has a node A lacks → reported as removed (base-vs-head semantics).
    expect(result.removed.nodes).toEqual([{ id: 's:other:fnew', label: 'Function', name: `${OTHER}.fnew` }])
    // A has the mini-repo nodes B lacks → added.
    expect(result.added.nodes.length).toBeGreaterThan(0)
    for (const node of result.added.nodes) {
      expect(node).toMatchObject({ id: expect.any(String), label: expect.any(String), name: expect.any(String) })
    }
  })

  it('throws ProjectNotFoundError when either project is unknown', () => {
    expect(() => compareGraphs(store(), { projectA: 'ghost', projectB: PROJECT })).toThrow(ProjectNotFoundError)
    expect(() => compareGraphs(store(), { projectA: PROJECT, projectB: 'ghost' })).toThrow(ProjectNotFoundError)
  })
})