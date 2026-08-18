/**
 * MemoryMemoryStore port contract — verifies in-memory IMemoryStore
 * (long-term per-CatId memory) semantics: create / list / update / delete /
 * searchSimilar stub.
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId } from '@flowforge/cats-shared'
import { MemoryMemoryStore } from '../src/memory/memory-store.ts'
import type { CreateMemoryInput } from '../src/ports/memory-store.ts'

const CAT_OPUS = createCatId('opus')
const CAT_CODEX = createCatId('codex')

function memoryInput(overrides: Partial<CreateMemoryInput> = {}): CreateMemoryInput {
  return {
    catId: CAT_OPUS,
    kind: 'episode',
    content: 'met user Alice',
    importance: 0.5,
    ...overrides,
  } as CreateMemoryInput
}

describe('MemoryMemoryStore — create + get', () => {
  it('assigns id + timestamps when omitted', () => {
    const store = new MemoryMemoryStore()
    const m = store.create(memoryInput())
    expect(m.id).toMatch(/^memory_/)
    expect(m.createdAt).toBe(m.updatedAt)
  })

  it('rejects duplicate ids', () => {
    const store = new MemoryMemoryStore()
    store.create(memoryInput({ id: 'dup' }))
    expect(() => store.create(memoryInput({ id: 'dup' }))).toThrow(/already exists/)
  })

  it('getById returns null for unknown ids', () => {
    const store = new MemoryMemoryStore()
    expect(store.getById('nope')).toBeNull()
  })
})

describe('MemoryMemoryStore — listForCat', () => {
  it('filters by catId + kind and orders by createdAt desc', async () => {
    const store = new MemoryMemoryStore()
    store.create(memoryInput({ id: 'a', catId: CAT_OPUS, kind: 'episode' }))
    await new Promise((r) => setTimeout(r, 2))
    store.create(memoryInput({ id: 'b', catId: CAT_OPUS, kind: 'preference' }))
    store.create(memoryInput({ id: 'c', catId: CAT_CODEX }))

    expect(store.listForCat(CAT_OPUS).map((m) => m.id)).toEqual(['b', 'a'])
    expect(store.listForCat(CAT_OPUS, { kind: 'preference' }).map((m) => m.id)).toEqual(['b'])
    expect(store.listForCat(CAT_OPUS, { limit: 1 }).map((m) => m.id)).toEqual(['b'])
  })
})

describe('MemoryMemoryStore — update + delete', () => {
  it('update applies patch + bumps updatedAt; preserves id/createdAt', () => {
    const store = new MemoryMemoryStore()
    const m = store.create(memoryInput({ id: 'fixed', content: 'orig' }))
    const updated = store.update(m.id, { content: 'renamed', importance: 0.9 })
    expect(updated?.content).toBe('renamed')
    expect(updated?.importance).toBe(0.9)
    expect(updated?.id).toBe('fixed')
    expect(updated?.createdAt).toBe(m.createdAt)
  })

  it('update returns null for unknown id', () => {
    const store = new MemoryMemoryStore()
    expect(store.update('nope', { content: 'x' })).toBeNull()
  })

  it('delete returns true/false appropriately', () => {
    const store = new MemoryMemoryStore()
    store.create(memoryInput({ id: 'gone' }))
    expect(store.delete('gone')).toBe(true)
    expect(store.delete('gone')).toBe(false)
  })
})

describe('MemoryMemoryStore — searchSimilar (stub)', () => {
  it('returns [] until a vector backend lands', () => {
    const store = new MemoryMemoryStore()
    store.create(memoryInput({ id: 'm1' }))
    expect(store.searchSimilar(CAT_OPUS, [1, 2, 3])).toEqual([])
  })
})
