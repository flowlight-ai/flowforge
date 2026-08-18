/**
 * MemoryInvocationRecordStore port contract — verifies in-memory
 * IInvocationRecordStore semantics:
 * - create + dedupe (idempotency key TTL)
 * - get by id / by idempotency key
 * - update state-machine + CAS guards
 * - listRunningByThread
 * - bounded eviction (MAX_RECORDS)
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import {
  createCatId,
  createThreadId,
  createUserId,
} from '@flowforge/cats-shared'
import { MemoryInvocationRecordStore } from '../src/memory/invocation-record-store.ts'
import type { CreateInvocationInput } from '@flowforge/cats-shared'
import type { StoreUpdateInvocationInput } from '../src/ports/invocation-record-store.ts'

const THREAD_1 = createThreadId('thread_t1')
const THREAD_2 = createThreadId('thread_t2')
const USER_ALICE = createUserId('alice')
const USER_BOB = createUserId('bob')
const CAT_OPUS = createCatId('opus')
const CAT_NEO = createCatId('neo')

function createInput(overrides: Partial<CreateInvocationInput> = {}): CreateInvocationInput {
  return {
    threadId: THREAD_1,
    userId: USER_ALICE,
    catIds: [CAT_OPUS],
    source: 'user',
    idempotencyKey: `k_${Math.random().toString(36).slice(2)}`,
    ...overrides,
  } as CreateInvocationInput
}

describe('MemoryInvocationRecordStore — create + dedupe', () => {
  it('creates with a fresh invocationId and queued status', () => {
    const store = new MemoryInvocationRecordStore()
    const out = store.create(createInput())
    expect(out.outcome).toBe('created')
    if (out.outcome !== 'created') throw new Error('unreachable')
    expect(out.invocationId).toMatch(/^inv_/)
    const record = store.get(out.invocationId)
    expect(record).not.toBeNull()
    if (!record) throw new Error('unreachable')
    expect(record.status).toBe('queued')
    expect(record.threadId).toBe(THREAD_1)
    expect(record.userId).toBe(USER_ALICE)
    expect(record.catIds).toEqual([CAT_OPUS])
  })

  it('deduplicates by idempotency key within TTL', () => {
    const store = new MemoryInvocationRecordStore()
    const input = createInput({ idempotencyKey: 'k1' })
    const first = store.create(input)
    const second = store.create(input)
    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('deduped')
    if (first.outcome !== 'created' || second.outcome !== 'deduped') throw new Error('unreachable')
    expect(second.invocationId).toBe(first.invocationId)
  })

  it('treats idempotency key as scoped to thread × user', () => {
    const store = new MemoryInvocationRecordStore()
    const a = store.create(createInput({ idempotencyKey: 'shared', threadId: THREAD_1, userId: USER_ALICE }))
    const b = store.create(createInput({ idempotencyKey: 'shared', threadId: THREAD_1, userId: USER_BOB }))
    const c = store.create(createInput({ idempotencyKey: 'shared', threadId: THREAD_2, userId: USER_ALICE }))
    expect(a.outcome).toBe('created')
    expect(b.outcome).toBe('created')
    expect(c.outcome).toBe('created')
  })

  it('expires idempotency index after TTL', () => {
    let clock = 0
    const store = new MemoryInvocationRecordStore({ now: () => clock })
    const input = createInput({ idempotencyKey: 'k1' })
    const first = store.create(input)
    expect(first.outcome).toBe('created')

    // Within TTL (5 min) → deduped
    clock = 4 * 60 * 1000
    const within = store.create(input)
    expect(within.outcome).toBe('deduped')

    // After TTL → new record
    clock = 6 * 60 * 1000
    const after = store.create(input)
    expect(after.outcome).toBe('created')
  })

  it('does not index when idempotencyKey is omitted', () => {
    const store = new MemoryInvocationRecordStore()
    const a = store.create(createInput({ idempotencyKey: undefined }))
    const b = store.create(createInput({ idempotencyKey: undefined }))
    expect(a.outcome).toBe('created')
    expect(b.outcome).toBe('created')
    if (a.outcome !== 'created' || b.outcome !== 'created') throw new Error('unreachable')
    expect(a.invocationId).not.toBe(b.invocationId)
  })
})

describe('MemoryInvocationRecordStore — getByIdempotencyKey', () => {
  it('returns the record while key is live', () => {
    const store = new MemoryInvocationRecordStore()
    const out = store.create(createInput({ idempotencyKey: 'k1' }))
    if (out.outcome !== 'created') throw new Error('unreachable')
    const fetched = store.getByIdempotencyKey(THREAD_1, USER_ALICE, 'k1')
    expect(fetched?.invocationId).toBe(out.invocationId)
  })

  it('returns null for unknown / expired keys', () => {
    let clock = 0
    const store = new MemoryInvocationRecordStore({ now: () => clock })
    store.create(createInput({ idempotencyKey: 'k1' }))
    expect(store.getByIdempotencyKey(THREAD_1, USER_ALICE, 'k1')).not.toBeNull()
    expect(store.getByIdempotencyKey(THREAD_1, USER_ALICE, 'unknown')).toBeNull()
    clock = 6 * 60 * 1000
    expect(store.getByIdempotencyKey(THREAD_1, USER_ALICE, 'k1')).toBeNull()
  })
})

describe('MemoryInvocationRecordStore — update state machine', () => {
  it('transitions queued → running → succeeded', () => {
    const store = new MemoryInvocationRecordStore()
    const created = store.create(createInput())
    if (created.outcome !== 'created') throw new Error('unreachable')

    const running = store.update({
      invocationId: created.invocationId,
      status: 'running',
    } as StoreUpdateInvocationInput)
    expect(running.outcome).toBe('updated')

    const succeeded = store.update({
      invocationId: created.invocationId,
      status: 'succeeded',
    } as StoreUpdateInvocationInput)
    expect(succeeded.outcome).toBe('updated')

    const record = store.get(created.invocationId)
    expect(record?.status).toBe('succeeded')
    expect(record?.settledAt).not.toBeUndefined()
  })

  it('rejects illegal transitions (queued → succeeded)', () => {
    const store = new MemoryInvocationRecordStore()
    const created = store.create(createInput())
    if (created.outcome !== 'created') throw new Error('unreachable')

    const out = store.update({
      invocationId: created.invocationId,
      status: 'succeeded',
    } as StoreUpdateInvocationInput)
    expect(out.outcome).toBe('invalid_transition')
    if (out.outcome !== 'invalid_transition') throw new Error('unreachable')
    expect(out.from).toBe('queued')
    expect(out.to).toBe('succeeded')
  })

  it('rejects CAS mismatches', () => {
    const store = new MemoryInvocationRecordStore()
    const created = store.create(createInput())
    if (created.outcome !== 'created') throw new Error('unreachable')

    const out = store.update({
      invocationId: created.invocationId,
      status: 'running',
      expectedStatus: 'succeeded', // wrong — actual is queued
    } as StoreUpdateInvocationInput)
    expect(out.outcome).toBe('cas_mismatch')
    if (out.outcome !== 'cas_mismatch') throw new Error('unreachable')
    expect(out.expected).toBe('succeeded')
    expect(out.actual).toBe('queued')
  })

  it('returns missing for unknown invocationId', () => {
    const store = new MemoryInvocationRecordStore()
    const out = store.update({
      invocationId: 'inv_unknown' as never,
      status: 'running',
    } as StoreUpdateInvocationInput)
    expect(out.outcome).toBe('missing')
  })

  it('allows idempotent same-status updates', () => {
    const store = new MemoryInvocationRecordStore()
    const created = store.create(createInput())
    if (created.outcome !== 'created') throw new Error('unreachable')
    const out = store.update({
      invocationId: created.invocationId,
      status: 'queued',
    } as StoreUpdateInvocationInput)
    expect(out.outcome).toBe('updated')
  })

  it('records executionStartedAt on first running transition', () => {
    let clock = 1000
    const store = new MemoryInvocationRecordStore({ now: () => clock })
    const created = store.create(createInput())
    if (created.outcome !== 'created') throw new Error('unreachable')
    clock = 2000
    store.update({
      invocationId: created.invocationId,
      status: 'running',
    } as StoreUpdateInvocationInput)
    let record = store.get(created.invocationId)
    expect(record?.executionStartedAt).toBe(2000)

    // Subsequent update should not overwrite executionStartedAt
    clock = 3000
    store.update({
      invocationId: created.invocationId,
      status: 'running',
    } as StoreUpdateInvocationInput)
    record = store.get(created.invocationId)
    expect(record?.executionStartedAt).toBe(2000)
  })
})

describe('MemoryInvocationRecordStore — listRunningByThread', () => {
  it('filters running records by thread × user', () => {
    const store = new MemoryInvocationRecordStore()

    const a = store.create(createInput({ threadId: THREAD_1, userId: USER_ALICE }))
    const b = store.create(createInput({ threadId: THREAD_1, userId: USER_ALICE, catIds: [CAT_NEO] }))
    store.create(createInput({ threadId: THREAD_1, userId: USER_BOB }))
    store.create(createInput({ threadId: THREAD_2, userId: USER_ALICE }))

    for (const c of [a, b]) {
      if (c.outcome !== 'created') throw new Error('unreachable')
      store.update({ invocationId: c.invocationId, status: 'running' } as StoreUpdateInvocationInput)
    }

    const running = store.listRunningByThread(THREAD_1, USER_ALICE)
    expect(running).toHaveLength(2)
    expect(running.every((r) => r.threadId === THREAD_1 && r.userId === USER_ALICE && r.status === 'running')).toBe(true)
  })
})

describe('MemoryInvocationRecordStore — bounded eviction', () => {
  it('evicts oldest record when MAX_RECORDS exceeded', () => {
    const store = new MemoryInvocationRecordStore({ maxRecords: 3 })
    const a = store.create(createInput({ idempotencyKey: 'k1' }))
    store.create(createInput({ idempotencyKey: 'k2' }))
    store.create(createInput({ idempotencyKey: 'k3' }))
    expect(store.size).toBe(3)

    // One more → evicts the oldest (a)
    store.create(createInput({ idempotencyKey: 'k4' }))
    expect(store.size).toBe(3)
    if (a.outcome !== 'created') throw new Error('unreachable')
    expect(store.get(a.invocationId)).toBeNull()
  })
})

describe('MemoryInvocationRecordStore — scanAll', () => {
  it('returns all live records', async () => {
    const store = new MemoryInvocationRecordStore()
    store.create(createInput({ idempotencyKey: 'k1' }))
    store.create(createInput({ idempotencyKey: 'k2' }))
    const all = await store.scanAll?.()
    expect(all).toHaveLength(2)
  })
})
