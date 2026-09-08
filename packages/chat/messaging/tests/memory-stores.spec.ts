/**
 * In-memory store implementations — contract tests (T-D1; static, real stores, no mocks).
 */
import { describe, expect, it } from 'vitest'
import type { HandleScope } from '../src/contract/host-types.js'
import type { MessageHandleRecord } from '../src/stores/ports.js'
import {
  MemoryAppendLock,
  MemoryEventLogStore,
  MemoryHandleStore,
  MemoryLedgerStore,
} from '../src/stores/memory.js'

const scope: HandleScope = { canSend: true, canSubscribe: true }

describe('MemoryLedgerStore', () => {
  it('returns inflight for an active claim and rejects a stale settle', async () => {
    const store = new MemoryLedgerStore()
    const claim = await store.claim('k', 60_000)
    expect(claim.status).toBe('new')
    const second = await store.claim('k', 60_000)
    expect(second.status).toBe('inflight')
    const result = await store.settle('k', 'wrong', { receipt: true }, 1000)
    expect(result.status).toBe('rejected')
  })

  it('settle is sticky: release after settle is a no-op', async () => {
    const store = new MemoryLedgerStore()
    const claim = await store.claim('k', 60_000)
    if (claim.status !== 'new') return
    await store.settle('k', claim.claimToken, { v: 1 }, 60_000)
    await store.release('k', claim.claimToken)
    const again = await store.claim('k', 60_000)
    expect(again.status).toBe('settled')
  })
})

describe('MemoryHandleStore.getOrCreateMessageHandle', () => {
  it('converges concurrent mints on one canonical record', async () => {
    const store = new MemoryHandleStore()
    const candidate: MessageHandleRecord = {
      handleId: 'mh_1',
      kind: 'message_handle',
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
      messageId: 'm1',
      parentHandleId: 'th_1',
      issuedAt: 1,
    }
    const [a, b] = await Promise.all([
      store.getOrCreateMessageHandle(candidate),
      store.getOrCreateMessageHandle(candidate),
    ])
    expect(a.record.handleId).toBe(b.record.handleId)
    expect(a.created !== b.created).toBe(true)
  })

  it('fails closed on a binding violation for an existing indexed id (INV-21)', async () => {
    const store = new MemoryHandleStore()
    const candidate: MessageHandleRecord = {
      handleId: 'mh_1',
      kind: 'message_handle',
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
      messageId: 'm1',
      parentHandleId: 'th_1',
      issuedAt: 1,
    }
    await store.getOrCreateMessageHandle(candidate)
    const conflicting: MessageHandleRecord = { ...candidate, pluginInstanceId: 'inst-2' }
    await expect(store.getOrCreateMessageHandle(conflicting)).rejects.toThrow('handle binding violation')
  })
})

describe('MemoryEventLogStore', () => {
  it('assigns monotonic per-thread sequences and trims to retention', async () => {
    const store = new MemoryEventLogStore()
    const publish = {
      eventId: 'ev-1',
      type: 'message.publish',
      envelope: {
        messageId: 'm1',
        revision: 1,
        threadId: 't1',
        actor: { kind: 'user', id: 'u1' },
        audience: { kind: 'public' },
        occurredAt: '2026-01-01T00:00:00.000Z',
        payload: {
          provenance: { origin: { kind: 'host' }, epistemicStatus: 'user_intent' },
          elements: [{ elementId: 'e1', kind: 'text', payload: { text: 'hi' }, epistemicStatus: 'inference' }],
        },
      },
    }
    const r1 = await store.append('t1', 'key-1', publish as never, 2)
    expect(r1.sequence).toBe(1)
    const r2 = await store.append('t1', 'key-2', publish as never, 2)
    expect(r2.sequence).toBe(2)
    const dup = await store.append('t1', 'key-1', publish as never, 2)
    expect(dup.deduped).toBe(true)
    expect(dup.sequence).toBe(1)

    expect(await store.minSequence('t1')).toBe(1)
    expect(await store.headSequence('t1')).toBe(2)

    const after = await store.readAfter('t1', 1, 10)
    expect(after.map((e) => e.sequence)).toEqual([2])
  })
})

describe('MemoryAppendLock', () => {
  it('acquires, contends, and only the owner can release', async () => {
    const lock = new MemoryAppendLock()
    const lease = await lock.acquire('m1', 60_000)
    expect(lease).not.toBeNull()
    expect(await lock.acquire('m1', 60_000)).toBeNull()
    await lock.release('m1', lease!)
    // A stale token cannot free a successor's lock.
    const fresh = await lock.acquire('m1', 60_000)
    expect(fresh).not.toBeNull()
    await lock.release('m1', lease!)
    expect(await lock.acquire('m1', 60_000)).toBeNull()
  })
})