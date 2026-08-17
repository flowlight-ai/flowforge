/**
 * MemoryMessageStore port contract — verifies the in-memory IMessageStore
 * implementation satisfies append / read / delete / delivery-lifecycle
 * semantics for batch 2 of stage 4 (cats-stores).
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import {
  DEFAULT_THREAD_ID,
  MemoryMessageStore,
} from '../src/memory/message-store.ts'
import type {
  AppendMessageInput,
  StoredMessage,
} from '../src/ports/message-store.ts'

const CAT_OPUS = createCatId('opus')
const USER_ALICE = createUserId('alice')

function baseInput(overrides: Partial<AppendMessageInput> = {}): AppendMessageInput {
  return {
    userId: USER_ALICE,
    catId: null,
    content: 'hello',
    mentions: [],
    timestamp: 1_000_000,
    ...overrides,
  } as AppendMessageInput
}

describe('MemoryMessageStore — append', () => {
  it('assigns id + threadId (default when omitted)', () => {
    const store = new MemoryMessageStore()
    const stored = store.append(baseInput())
    expect(stored.id).toMatch(/^\d{16}-\d{6}-[0-9a-f]{8}$/)
    expect(stored.threadId).toBe(DEFAULT_THREAD_ID)
    expect(stored.deliveryStatus).toBeUndefined()
  })

  it('honours caller-provided threadId', () => {
    const store = new MemoryMessageStore()
    const stored = store.append(baseInput({ threadId: 'thread-42' }))
    expect(stored.threadId).toBe('thread-42')
  })

  it('throws on delivery-metadata ownership violations (queued is the only allowed status)', () => {
    const store = new MemoryMessageStore()
    // deliveredAt set by caller → rejected
    expect(() =>
      store.append(baseInput({ deliveredAt: 1_000 } as unknown as AppendMessageInput)),
    ).toThrow(/delivery metadata is transition-owned/)
    // deliveryStatus != 'queued' → rejected
    expect(() =>
      store.append(baseInput({ deliveryStatus: 'delivered' } as unknown as AppendMessageInput)),
    ).toThrow(/delivery metadata is transition-owned/)
  })

  it('honours idempotencyKey for same user+thread', () => {
    const store = new MemoryMessageStore()
    const first = store.append(baseInput({ idempotencyKey: 'req-1' }))
    const second = store.append(baseInput({ idempotencyKey: 'req-1' }))
    expect(second.id).toBe(first.id)
    expect(store.size).toBe(1)
  })

  it('fires onAppend listener after each successful append', () => {
    const seen: StoredMessage[] = []
    const store = new MemoryMessageStore({ onAppend: (m) => void seen.push(m) })
    store.append(baseInput({ content: 'a' }))
    store.append(baseInput({ content: 'b' }))
    expect(seen.map((m) => m.content)).toEqual(['a', 'b'])
  })

  it('trims oldest messages once maxMessages is exceeded', () => {
    const store = new MemoryMessageStore({ maxMessages: 3 })
    for (let i = 0; i < 5; i++) {
      store.append(baseInput({ content: `m${i}`, timestamp: 1_000_000 + i }))
    }
    expect(store.size).toBe(3)
    const recent = store.getRecent(10)
    expect(recent.map((m) => m.content)).toEqual(['m2', 'm3', 'm4'])
  })
})

describe('MemoryMessageStore — reads', () => {
  it('getByThread returns only delivered messages for the thread', () => {
    const store = new MemoryMessageStore()
    store.append(baseInput({ threadId: 't1', content: 'a' }))
    store.append(baseInput({ threadId: 't1', content: 'b', deliveryStatus: 'queued', catId: CAT_OPUS }))
    store.append(baseInput({ threadId: 't2', content: 'c' }))
    const result = store.getByThread('t1')
    expect(result.map((m) => m.content)).toEqual(['a'])
  })

  it('getByThreadAfter orders by timelineOrderAt then id', () => {
    const store = new MemoryMessageStore()
    const m1 = store.append(baseInput({ threadId: 't1', content: 'first', timestamp: 1_000 }))
    const m2 = store.append(baseInput({ threadId: 't1', content: 'second', timestamp: 2_000 }))
    store.append(baseInput({ threadId: 't1', content: 'third', timestamp: 3_000 }))
    const after = store.getByThreadAfter('t1', m1.id)
    expect(after.map((m) => m.content)).toEqual(['second', 'third'])
    expect(after.every((m) => m.id !== m2.id || m.threadId === 't1')).toBe(true)
  })

  it('getRecent filters by userId and excludes deleted', () => {
    const store = new MemoryMessageStore()
    const m1 = store.append(baseInput({ userId: USER_ALICE, content: 'a' }))
    store.append(baseInput({ userId: createUserId('bob'), content: 'b' }))
    store.softDelete(m1.id, 'tester')
    const result = store.getRecent(10, USER_ALICE)
    expect(result).toHaveLength(0)
  })
})

describe('MemoryMessageStore — deletes', () => {
  it('softDelete marks deletedAt/deletedBy without wiping content', () => {
    const store = new MemoryMessageStore()
    const m = store.append(baseInput({ content: 'secret' }))
    const deleted = store.softDelete(m.id, 'tester')
    expect(deleted?.deletedAt).toBeTypeOf('number')
    expect(deleted?.deletedBy).toBe('tester')
    expect(deleted?.content).toBe('secret')
  })

  it('hardDelete replaces content with empty + tombstone', () => {
    const store = new MemoryMessageStore()
    const m = store.append(baseInput({
      content: 'secret',
      thinking: 'internal',
      metadata: { foo: 'bar' },
    }))
    const tomb = store.hardDelete(m.id, 'tester')
    expect(tomb?._tombstone).toBe(true)
    expect(tomb?.content).toBe('')
    expect(tomb?.metadata).toBeUndefined()
    expect(tomb?.thinking).toBeUndefined()
  })

  it('restore clears deletedAt/deletedBy (no-op on tombstones)', () => {
    const store = new MemoryMessageStore()
    const m = store.append(baseInput({ content: 'a' }))
    store.softDelete(m.id, 'tester')
    const restored = store.restore(m.id)
    expect(restored?.deletedAt).toBeUndefined()
    expect(restored?.deletedBy).toBeUndefined()

    // Hard-deleted tombstones cannot be restored
    const tombstone = store.hardDelete(m.id, 'tester')
    expect(tombstone?._tombstone).toBe(true)
    expect(store.restore(m.id)).toBeNull()
  })

  it('deleteByThread removes all messages for the thread', () => {
    const store = new MemoryMessageStore()
    store.append(baseInput({ threadId: 't1', content: 'a' }))
    store.append(baseInput({ threadId: 't1', content: 'b' }))
    store.append(baseInput({ threadId: 't2', content: 'c' }))
    const removed = store.deleteByThread('t1')
    expect(removed).toBe(2)
    expect(store.getByThread('t1')).toHaveLength(0)
    expect(store.getByThread('t2')).toHaveLength(1)
  })
})

describe('MemoryMessageStore — delivery lifecycle', () => {
  it('markDelivered transitions queued → delivered (sets timelineOrderAt)', () => {
    const store = new MemoryMessageStore()
    const queued = store.append(baseInput({
      catId: CAT_OPUS,
      content: 'queued reply',
      deliveryStatus: 'queued',
      timestamp: 1_000_000,
    }))
    expect(queued.deliveryStatus).toBe('queued')
    const delivered = store.markDelivered(queued.id, 1_000_500)
    expect(delivered?.deliveryStatus).toBe('delivered')
    expect(delivered?.deliveredAt).toBe(1_000_500)
    expect(delivered?.timelineOrderAt).toBe(1_000_500)
    expect(delivered?.deliveryTransitioned).toBe(true)
  })

  it('markDelivered is idempotent on already-delivered messages', () => {
    const store = new MemoryMessageStore()
    const m = store.append(baseInput({ content: 'a' }))
    const r1 = store.markDelivered(m.id, 1_000)
    const r2 = store.markDelivered(m.id, 2_000)
    expect(r1?.deliveryTransitioned).toBe(false)
    expect(r2?.deliveryTransitioned).toBe(false)
  })

  it('markCanceled transitions queued → canceled', () => {
    const store = new MemoryMessageStore()
    const queued = store.append(baseInput({
      catId: CAT_OPUS,
      content: 'queued',
      deliveryStatus: 'queued',
    }))
    const canceled = store.markCanceled(queued.id)
    expect(canceled?.deliveryStatus).toBe('canceled')
    expect(canceled?.deliveryTransitioned).toBe(true)
  })
})

describe('MemoryMessageStore — extras', () => {
  it('updateExtra merges metadata shallowly', () => {
    const store = new MemoryMessageStore()
    const m = store.append(baseInput({ metadata: { a: 1 } }))
    const updated = store.updateExtra(m.id, { b: 2 })
    expect(updated?.metadata).toEqual({ a: 1, b: 2 })
  })

  it('revealWhispers marks whisper messages as revealed for the owner', () => {
    const store = new MemoryMessageStore()
    const m = store.append(baseInput({
      userId: USER_ALICE,
      content: 'whisper',
      visibility: 'whisper',
    }))
    const count = store.revealWhispers('default', USER_ALICE)
    expect(count).toBe(1)
    const after = store.getById(m.id)
    expect(after?.revealedAt).toBeTypeOf('number')
  })
})
