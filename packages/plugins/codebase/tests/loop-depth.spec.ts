/**
 * EP-CB4 T5.5 — interprocedural transitive_loop_depth propagation suite:
 * worst-case nested-loop depth spreads along CALLS edges to a monotone
 * fixpoint (cycles converge). Real node:sqlite in the temp dir, no mocks.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseStore, propagateLoopDepth } from '../src/index.ts'

let dir: string
let store: CodebaseStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-codebase-loop-'))
  store = new CodebaseStore(join(dir, 'codebase.db'))
  store.open()
  store.registerProject('demo')
})

afterEach(() => {
  store.dispose()
  rmSync(dir, { recursive: true, force: true })
})

function fn(id: string, loopDepth: number, transitive?: number): void {
  store.upsertNodes([
    {
      id: `fn:${id}`,
      project: 'demo',
      label: 'Function',
      name: id,
      props: { loopDepth, ...(transitive === undefined ? {} : { transitiveLoopDepth: transitive }) },
    },
  ])
}

function calls(source: string, target: string): void {
  store.insertEdges([{ project: 'demo', source: `fn:${source}`, target: `fn:${target}`, type: 'CALLS' }])
}

describe('propagateLoopDepth (T5.5)', () => {
  it('a caller takes its own max with each callee transitive depth', () => {
    fn('a', 1) // shallow caller
    fn('b', 2) // deep callee
    calls('a', 'b')
    const result = propagateLoopDepth(store, 'demo')
    // b keeps its own 2; a inherits 2 from b.
    const a = result.propagated.find(node => node.id === 'fn:a')
    const b = result.propagated.find(node => node.id === 'fn:b')
    expect(a?.props?.transitiveLoopDepth).toBe(2)
    expect(b?.props?.transitiveLoopDepth).toBe(2)
  })

  it('converges on call cycles via the monotone fixpoint', () => {
    fn('x', 1)
    fn('y', 3)
    calls('x', 'y')
    calls('y', 'x') // cycle
    const result = propagateLoopDepth(store, 'demo')
    const x = result.propagated.find(node => node.id === 'fn:x')
    const y = result.propagated.find(node => node.id === 'fn:y')
    expect(x?.props?.transitiveLoopDepth).toBe(3)
    expect(y?.props?.transitiveLoopDepth).toBe(3)
  })

  it('persists only nodes whose transitive depth actually changed', () => {
    fn('p', 2, 4) // already propagated with 4 (a deep sibling upstream)
    fn('q', 1, 4) // already correct
    calls('p', 'q')
    const result = propagateLoopDepth(store, 'demo')
    // Both already stored at 4; no change.
    expect(result.propagated).toEqual([])
    const stored = store.allNodes('demo').find(node => node.id === 'fn:p')
    expect(stored?.props?.transitiveLoopDepth).toBe(4)
  })

  it('chains transitive propagation across a multi-hop call path', () => {
    fn('leaf', 2)
    fn('mid', 1)
    fn('root', 1)
    calls('root', 'mid')
    calls('mid', 'leaf')
    const result = propagateLoopDepth(store, 'demo')
    const byId = (id: string) => result.propagated.find(node => node.id === `fn:${id}`)?.props?.transitiveLoopDepth
    expect(byId('root')).toBe(2)
    expect(byId('mid')).toBe(2)
    expect(byId('leaf')).toBe(2)
  })
})