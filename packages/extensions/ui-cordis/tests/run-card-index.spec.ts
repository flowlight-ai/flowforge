// The per-session run-card supersession index: every mounted Run card for one
// session observes the same store, and only a greater log sequence replaces the
// current card (pure-logic port of the dsh run-card-index.ts).

import { describe, expect, it } from 'vitest'
import { CordisRunCardRegistry, cordisToolViewKey } from '../src/run-card-index.ts'
import type { CordisRunCardPointer } from '../src/run-card-index.ts'

function pointer(over: Partial<CordisRunCardPointer> = {}): CordisRunCardPointer {
  return {
    key: cordisToolViewKey('dyn-1', 'pkg-1'),
    callId: 'call-1',
    seq: 1,
    pluginRunId: 'run-1',
    ...over,
  }
}

describe('cordisToolViewKey', () => {
  it('joins the plugin and package identities into a stable business-view key', () => {
    expect(cordisToolViewKey('dyn-1', 'pkg-1')).toBe('dyn-1.pkg-1')
  })
})

describe('CordisRunCardRegistry', () => {
  it('hands every observer of one session the same store', () => {
    const registry = new CordisRunCardRegistry()
    expect(registry.forSession('sess-1')).toBe(registry.forSession('sess-1'))
  })

  it('keeps session stores independent', () => {
    const registry = new CordisRunCardRegistry()
    const a = registry.forSession('a')
    const b = registry.forSession('b')
    a.observe(pointer({ pluginRunId: 'run-a' }))
    expect(b.getSnapshot().size).toBe(0)
    expect(a.getSnapshot().get('dyn-1.pkg-1')?.pluginRunId).toBe('run-a')
  })
})

describe('supersession', () => {
  it('publishes a new successful run only when its log sequence is greater', () => {
    const store = new CordisRunCardRegistry().forSession('sess-1')
    const key = cordisToolViewKey('dyn-1', 'pkg-1')

    store.observe(pointer({ key, seq: 1, pluginRunId: 'run-1' }))
    expect(store.getSnapshot().get(key)?.pluginRunId).toBe('run-1')

    // Equal and lower sequences never displace the current card.
    store.observe(pointer({ key, seq: 1, pluginRunId: 'run-1b' }))
    store.observe(pointer({ key, seq: 0, pluginRunId: 'run-0' }))
    expect(store.getSnapshot().get(key)?.pluginRunId).toBe('run-1')

    // A strictly greater sequence supersedes it.
    store.observe(pointer({ key, seq: 2, pluginRunId: 'run-2' }))
    expect(store.getSnapshot().get(key)?.pluginRunId).toBe('run-2')
  })

  it('notifies subscribed listeners only when the card actually supersedes', () => {
    const store = new CordisRunCardRegistry().forSession('sess-1')
    const key = cordisToolViewKey('dyn-1', 'pkg-1')
    let calls = 0
    const off = store.subscribe(() => { calls += 1 })

    store.observe(pointer({ key, seq: 1, pluginRunId: 'run-1' }))
    expect(calls).toBe(1)
    store.observe(pointer({ key, seq: 1, pluginRunId: 'run-1b' }))
    expect(calls).toBe(1)

    off()
  })
})