/**
 * trace_path contract suite (EP-CB2, T3.1a).
 *
 * Real mini-repo fixture, real store. Pins the mcp.c trace_path port:
 * caller/callee direction over symbol-only adjacency (CALLS/USAGE/INHERITS/
 * IMPLEMENTS), depth bound, cycle safety, and the missing-symbol usage error.
 * Also locks the fix where edges are keyed by node ID while traversal keys are
 * qualified names (id→QN index bridges the namespaces).
 */

import { describe, expect, it } from 'vitest'
import { ProjectNotFoundError, UsageError, tracePath } from '../src/index.ts'
import { PROJECT, useMiniRepoFixture } from './_fixture.ts'

const fixture = useMiniRepoFixture()
const store = () => fixture.store

// QNs confirmed from the real index (see _fixture / mini-repo).
const UPDATE_CLIENT = `${PROJECT}.src.utils.helper.updateCloudClient`
const RENDER = `${PROJECT}.symbols.demo.render`
const CIRCLE = `${PROJECT}.symbols.demo.Circle`
const HELPER_REGISTRY = `${PROJECT}.src.utils.helper.HelperRegistry`
const SHAPE = `${PROJECT}.symbols.demo.Shape`

describe('tracePath — callers', () => {
  it('resolves the callers of a symbol via the id→QN index', () => {
    const result = tracePath(store(), { project: PROJECT, qualifiedName: UPDATE_CLIENT, direction: 'callers' })
    expect(result.start).toBe(UPDATE_CLIENT)
    expect(result.direction).toBe('callers')
    // render calls updateCloudClient; the file-level CALLS edge is non-symbol and excluded.
    expect(result.path.map(row => row.qn)).toEqual([RENDER])
    expect(result.path[0]).toMatchObject({ label: 'Function', depth: 1, via: 'CALLS' })
  })

  it('returns empty when nothing reaches the symbol (boundary ancestor)', () => {
    const result = tracePath(store(), { project: PROJECT, qualifiedName: `${PROJECT}.src.main`, direction: 'callers', maxDepth: 5 })
    expect(result.path).toEqual([])
    expect(result.depth).toBe(0)
  })
})

describe('tracePath — callees', () => {
  it('traces inheritance / implements targets of a class forward', () => {
    const result = tracePath(store(), { project: PROJECT, qualifiedName: CIRCLE, direction: 'callees' })
    expect(result.start).toBe(CIRCLE)
    // Circle implements Shape and inherits HelperRegistry (sorted by qn).
    expect(result.path.map(row => row.qn)).toEqual([HELPER_REGISTRY, SHAPE])
    expect(result.path.map(row => row.via).sort()).toEqual(['IMPLEMENTS', 'INHERITS'])
  })

  it('bounded by maxDepth', () => {
    const result = tracePath(store(), { project: PROJECT, qualifiedName: CIRCLE, direction: 'callees', maxDepth: 1 })
    expect(result.depth).toBeLessThanOrEqual(1)
  })

  it('maxDepth 0 short-circuits to an empty path', () => {
    const result = tracePath(store(), { project: PROJECT, qualifiedName: CIRCLE, direction: 'callees', maxDepth: 0 })
    expect(result.path).toEqual([])
    expect(result.depth).toBe(0)
  })
})

describe('tracePath — guards', () => {
  it('throws ProjectNotFoundError for an unknown project', () => {
    expect(() => tracePath(store(), { project: 'ghost', qualifiedName: UPDATE_CLIENT })).toThrow(ProjectNotFoundError)
  })

  it('throws UsageError for a non-symbol / unknown qualified name', () => {
    expect(() => tracePath(store(), { project: PROJECT, qualifiedName: `${PROJECT}.symbols.demo.doesNotExist` })).toThrow(UsageError)
  })
})