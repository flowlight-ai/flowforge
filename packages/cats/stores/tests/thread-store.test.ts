/**
 * MemoryThreadStore port contract — verifies in-memory IThreadStore
 * semantics: create / list / archive / unarchive / touch / update / delete.
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import { MemoryThreadStore } from '../src/memory/thread-store.ts'
import type { CreateThreadInput } from '../src/ports/thread-store.ts'

const CAT_OPUS = createCatId('opus')
const USER_ALICE = createUserId('alice')

function threadInput(overrides: Partial<CreateThreadInput> = {}): CreateThreadInput {
  return {
    userId: USER_ALICE,
    title: 'test thread',
    ...overrides,
  } as CreateThreadInput
}

describe('MemoryThreadStore — create + get', () => {
  it('assigns id + timestamps when caller omits them', () => {
    const store = new MemoryThreadStore()
    const t = store.create(threadInput())
    expect(t.id).toMatch(/^thread_/)
    expect(t.createdAt).toBeTypeOf('number')
    expect(t.updatedAt).toBe(t.createdAt)
  })

  it('honours caller-provided id', () => {
    const store = new MemoryThreadStore()
    const t = store.create(threadInput({ id: 'thread-42' }))
    expect(t.id).toBe('thread-42')
  })

  it('rejects duplicate ids', () => {
    const store = new MemoryThreadStore()
    store.create(threadInput({ id: 'dup' }))
    expect(() => store.create(threadInput({ id: 'dup' }))).toThrow(/already exists/)
  })

  it('getById returns null for unknown ids', () => {
    const store = new MemoryThreadStore()
    expect(store.getById('nope')).toBeNull()
  })
})

describe('MemoryThreadStore — listForUser', () => {
  it('filters by user and excludes archived by default', () => {
    const store = new MemoryThreadStore()
    const t1 = store.create(threadInput({ userId: USER_ALICE, title: 'a' }))
    store.create(threadInput({ userId: createUserId('bob'), title: 'b' }))
    store.archive(t1.id, 'tester')
    expect(store.listForUser(USER_ALICE)).toHaveLength(0)
    expect(store.listForUser(USER_ALICE, { includeArchived: true })).toHaveLength(1)
  })

  it('orders by updatedAt desc and respects limit', async () => {
    const store = new MemoryThreadStore()
    const older = store.create(threadInput({ userId: USER_ALICE, title: 'old' }))
    // wait a tick so newer's updatedAt is observably greater than older's
    await new Promise((r) => setTimeout(r, 5))
    const newer = store.create(threadInput({ userId: USER_ALICE, title: 'new' }))
    await new Promise((r) => setTimeout(r, 5))
    store.update(newer.id, { title: 'new-bumped' })
    void older
    const list = store.listForUser(USER_ALICE, { limit: 1 })
    expect(list[0]?.title).toBe('new-bumped')
  })
})

describe('MemoryThreadStore — archive + unarchive', () => {
  it('archive sets archivedAt; unarchive strips it and bumps updatedAt', () => {
    const store = new MemoryThreadStore()
    const t = store.create(threadInput())
    const archived = store.archive(t.id, 'tester')
    expect(archived?.archivedAt).toBeTypeOf('number')

    const before = archived?.updatedAt
    const restored = store.unarchive(t.id)
    expect(restored?.archivedAt).toBeUndefined()
    expect(restored?.updatedAt).toBeGreaterThanOrEqual(before ?? 0)
  })

  it('unarchive returns null for unknown thread', () => {
    const store = new MemoryThreadStore()
    expect(store.unarchive('nope')).toBeNull()
  })
})

describe('MemoryThreadStore — update + touchLastMessage', () => {
  it('update applies patch and bumps updatedAt', () => {
    const store = new MemoryThreadStore()
    const t = store.create(threadInput())
    const updated = store.update(t.id, {
      title: 'renamed',
      assignedCatIds: [CAT_OPUS],
      labels: ['p0'],
    })
    expect(updated?.title).toBe('renamed')
    expect(updated?.assignedCatIds).toEqual([CAT_OPUS])
    expect(updated?.labels).toEqual(['p0'])
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.updatedAt)
  })

  it('update preserves id and createdAt', () => {
    const store = new MemoryThreadStore()
    const t = store.create(threadInput({ id: 'fixed-id' }))
    const updated = store.update(t.id, { title: 'renamed' })
    expect(updated?.id).toBe('fixed-id')
    expect(updated?.createdAt).toBe(t.createdAt)
  })

  it('update returns null for unknown id', () => {
    const store = new MemoryThreadStore()
    expect(store.update('nope', { title: 'x' })).toBeNull()
  })

  it('touchLastMessage sets lastMessageAt + lastMessageId', () => {
    const store = new MemoryThreadStore()
    const t = store.create(threadInput())
    const touched = store.touchLastMessage(t.id, 'msg-1', 1_000)
    expect(touched?.lastMessageId).toBe('msg-1')
    expect(touched?.lastMessageAt).toBe(1_000)
  })
})

describe('MemoryThreadStore — delete', () => {
  it('delete removes a thread and returns true; second delete returns false', () => {
    const store = new MemoryThreadStore()
    const t = store.create(threadInput({ id: 'gone' }))
    expect(store.delete(t.id)).toBe(true)
    expect(store.delete(t.id)).toBe(false)
  })
})
