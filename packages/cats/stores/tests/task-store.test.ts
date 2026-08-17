/**
 * MemoryTaskStore port contract — verifies in-memory ITaskStore semantics:
 * create / list by thread / list by cat / list by user / update / delete.
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import { MemoryTaskStore } from '../src/memory/task-store.ts'
import type { CreateTaskInput } from '../src/ports/task-store.ts'

const CAT_OPUS = createCatId('opus')
const USER_ALICE = createUserId('alice')

function taskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    threadId: 't1',
    userId: USER_ALICE,
    catId: CAT_OPUS,
    title: 'task',
    status: 'todo',
    kind: 'work',
    ...overrides,
  } as CreateTaskInput
}

describe('MemoryTaskStore — create + get', () => {
  it('assigns id + timestamps when omitted', () => {
    const store = new MemoryTaskStore()
    const t = store.create(taskInput())
    expect(t.id).toMatch(/^task_/)
    expect(t.createdAt).toBe(t.updatedAt)
  })

  it('rejects duplicate ids', () => {
    const store = new MemoryTaskStore()
    store.create(taskInput({ id: 'dup' }))
    expect(() => store.create(taskInput({ id: 'dup' }))).toThrow(/already exists/)
  })

  it('getById returns null for unknown ids', () => {
    const store = new MemoryTaskStore()
    expect(store.getById('nope')).toBeNull()
  })
})

describe('MemoryTaskStore — listForThread', () => {
  it('filters by thread + status + kind', () => {
    const store = new MemoryTaskStore()
    store.create(taskInput({ id: 't1-a', threadId: 't1', status: 'todo', kind: 'work' }))
    store.create(taskInput({ id: 't1-b', threadId: 't1', status: 'doing', kind: 'work' }))
    store.create(taskInput({ id: 't1-c', threadId: 't1', status: 'todo', kind: 'pr_tracking' }))
    store.create(taskInput({ id: 't2-a', threadId: 't2' }))

    expect(store.listForThread('t1').map((t) => t.id)).toEqual(['t1-a', 't1-b', 't1-c'])
    expect(store.listForThread('t1', { status: 'todo' }).map((t) => t.id)).toEqual(['t1-a', 't1-c'])
    expect(store.listForThread('t1', { kind: 'pr_tracking' }).map((t) => t.id)).toEqual(['t1-c'])
  })
})

describe('MemoryTaskStore — listForCat', () => {
  it('filters by catId', () => {
    const store = new MemoryTaskStore()
    const catB = createCatId('codex')
    store.create(taskInput({ id: 'a', catId: CAT_OPUS }))
    store.create(taskInput({ id: 'b', catId: catB }))
    expect(store.listForCat(CAT_OPUS).map((t) => t.id)).toEqual(['a'])
    expect(store.listForCat(catB).map((t) => t.id)).toEqual(['b'])
  })
})

describe('MemoryTaskStore — listForUser', () => {
  it('filters by user and orders by updatedAt desc', async () => {
    const store = new MemoryTaskStore()
    store.create(taskInput({ id: 'a', userId: USER_ALICE, title: 'older' }))
    // wait a tick so updatedAt differs
    await new Promise((r) => setTimeout(r, 2))
    store.create(taskInput({ id: 'b', userId: USER_ALICE, title: 'newer' }))
    store.create(taskInput({ id: 'c', userId: createUserId('bob') }))
    const list = store.listForUser(USER_ALICE)
    expect(list.map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('MemoryTaskStore — update + delete', () => {
  it('update applies patch + bumps updatedAt; preserves id/createdAt', () => {
    const store = new MemoryTaskStore()
    const t = store.create(taskInput({ id: 'fixed', title: 'orig' }))
    const updated = store.update(t.id, { status: 'doing', title: 'renamed' })
    expect(updated?.status).toBe('doing')
    expect(updated?.title).toBe('renamed')
    expect(updated?.id).toBe('fixed')
    expect(updated?.createdAt).toBe(t.createdAt)
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.updatedAt)
  })

  it('update returns null for unknown id', () => {
    const store = new MemoryTaskStore()
    expect(store.update('nope', { title: 'x' })).toBeNull()
  })

  it('delete returns true/false appropriately', () => {
    const store = new MemoryTaskStore()
    store.create(taskInput({ id: 'gone' }))
    expect(store.delete('gone')).toBe(true)
    expect(store.delete('gone')).toBe(false)
  })
})
