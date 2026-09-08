/**
 * Memory cursor store + frozen snapshot lifecycle — contract tests (T-D1).
 */
import { describe, expect, it } from 'vitest'
import type { MessageEnvelope } from '@flowforge/plugin-contract'
import { MemoryCursorStore } from '../src/stores/memory-cursor.js'

function envelope(id: string): MessageEnvelope {
  return {
    messageId: id,
    revision: 1,
    threadId: 't1',
    actor: { kind: 'user', id: 'u1' },
    audience: { kind: 'public' },
    occurredAt: '2026-01-01T00:00:00.000Z',
    payload: {
      provenance: { origin: { kind: 'host' }, epistemicStatus: 'user_intent' },
      elements: [{ elementId: 'e1', kind: 'text', payload: { text: id }, epistemicStatus: 'inference' }],
    },
  }
}

function subRow() {
  return {
    subscriptionId: 'sub-1',
    pluginInstanceId: 'inst-1',
    handleId: 'th_1',
    threadId: 't1',
    ackedSequence: 0,
    lastDeliveredSequence: 0,
    replayFloorSequence: 0,
  }
}

describe('MemoryCursorStore basics', () => {
  it('createOrGet is idempotent per (instance, handle) and indexes by handle', async () => {
    const store = new MemoryCursorStore()
    const first = await store.createOrGet(subRow())
    const second = await store.createOrGet(subRow())
    expect(first.subscriptionId).toBe(second.subscriptionId)
    const found = await store.findByHandle('inst-1', 'th_1')
    expect(found?.subscriptionId).toBe('sub-1')
  })

  it('advanceAck is monotonic max', async () => {
    const store = new MemoryCursorStore()
    await store.createOrGet(subRow())
    await store.advanceAck('inst-1', 'sub-1', 5)
    await store.advanceAck('inst-1', 'sub-1', 3)
    const record = await store.get('inst-1', 'sub-1')
    expect(record?.ackedSequence).toBe(5)
  })
})

describe('MemoryCursorStore snapshot lifecycle', () => {
  it('captures, freezes, pages, consumes, and acks a snapshot', async () => {
    const store = new MemoryCursorStore()
    await store.createOrGet(subRow())
    const future = Date.now() + 10_000

    const start = await store.beginSnapshotCapture('inst-1', 'sub-1', {
      snapshotId: 'snap-1',
      headSequence: 5,
      createdAt: Date.now(),
      expiresAt: future,
    })
    expect(start?.status).toBe('started')

    expect(await store.appendSnapshotCapture('inst-1', 'sub-1', 'snap-1', 0, [envelope('m1')])).toBe(true)
    const frozen = await store.commitSnapshotCapture('inst-1', 'sub-1', {
      snapshotId: 'snap-1',
      expectedItemCount: 1,
      nextOffset: 1,
      traversalComplete: true,
    })
    expect(frozen?.itemCount).toBe(1)

    const page = await store.readSnapshotPage('inst-1', 'sub-1', 'snap-1', 0, 10)
    expect(page?.[0]?.messageId).toBe('m1')

    expect(
      await store.ackSnapshot('inst-1', 'sub-1', 'snap-1', 5),
    ).toBe('applied')
    const record = await store.get('inst-1', 'sub-1')
    expect(record?.ackedSequence).toBe(5)
  })

  it('reads the final snapshot ack attempt as replayed (idempotent)', async () => {
    const store = new MemoryCursorStore()
    await store.createOrGet(subRow())
    const future = Date.now() + 10_000
    await store.beginSnapshotCapture('inst-1', 'sub-1', {
      snapshotId: 'snap-1',
      headSequence: 5,
      createdAt: Date.now(),
      expiresAt: future,
    })
    await store.appendSnapshotCapture('inst-1', 'sub-1', 'snap-1', 0, [envelope('m1')])
    await store.commitSnapshotCapture('inst-1', 'sub-1', {
      snapshotId: 'snap-1',
      expectedItemCount: 1,
      nextOffset: 1,
      traversalComplete: true,
    })
    await store.ackSnapshot('inst-1', 'sub-1', 'snap-1', 5)
    expect(await store.ackSnapshot('inst-1', 'sub-1', 'snap-1', 5)).toBe('replayed')
  })
})

describe('MemoryCursorStore.revokeByHandle', () => {
  it('revokes every live subscription bound to a handle', async () => {
    const store = new MemoryCursorStore()
    // createOrGet is idempotent per (instance, handle), so seed two
    // subscriptions sharing the handle directly via put.
    await store.put(subRow())
    await store.put({ ...subRow(), subscriptionId: 'sub-2' })
    const count = await store.revokeByHandle('th_1', Date.now())
    expect(count).toBe(2)
    expect(await store.findByHandle('inst-1', 'th_1')).toBeNull()
    expect(await store.get('inst-1', 'sub-1')).toMatchObject({ revokedAt: expect.any(Number) })
    expect(await store.get('inst-1', 'sub-2')).toMatchObject({ revokedAt: expect.any(Number) })
  })
})