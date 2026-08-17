/**
 * MemoryTaskProgressStore port contract — verifies in-memory
 * ITaskProgressStore semantics:
 * - setSnapshot / getSnapshot
 * - deleteSnapshot (idempotent)
 * - deleteSnapshotIfOwner (CAS: only delete if lastInvocationId matches)
 * - getThreadSnapshots
 * - deleteThread
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import {
  createCatId,
  createInvocationId,
  createThreadId,
} from '@flowforge/cats-shared'
import { MemoryTaskProgressStore } from '../src/memory/task-progress-store.ts'
import type { TaskProgressSnapshot } from '../src/ports/task-progress-store.ts'

const THREAD_1 = createThreadId('thread_t1')
const THREAD_2 = createThreadId('thread_t2')
const CAT_OPUS = createCatId('opus')
const CAT_NEO = createCatId('neo')
const INV_A = createInvocationId('inv_a')
const INV_B = createInvocationId('inv_b')

function snapshot(overrides: Partial<TaskProgressSnapshot> = {}): TaskProgressSnapshot {
  return {
    threadId: THREAD_1,
    catId: CAT_OPUS,
    tasks: [],
    status: 'running',
    updatedAt: 0,
    lastInvocationId: INV_A,
    ...overrides,
  } as TaskProgressSnapshot
}

describe('MemoryTaskProgressStore — setSnapshot + getSnapshot', () => {
  it('returns null for an unknown (thread, cat)', async () => {
    const store = new MemoryTaskProgressStore()
    expect(await store.getSnapshot(THREAD_1, CAT_OPUS)).toBeNull()
  })

  it('inserts and reads back a snapshot', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot())
    const got = await store.getSnapshot(THREAD_1, CAT_OPUS)
    expect(got?.threadId).toBe(THREAD_1)
    expect(got?.catId).toBe(CAT_OPUS)
    expect(got?.lastInvocationId).toBe(INV_A)
  })

  it('replaces on overwrite (no merge)', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot({ status: 'running' }))
    await store.setSnapshot(snapshot({ status: 'completed' }))
    const got = await store.getSnapshot(THREAD_1, CAT_OPUS)
    expect(got?.status).toBe('completed')
  })
})

describe('MemoryTaskProgressStore — deleteSnapshot', () => {
  it('removes a snapshot and is idempotent', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot())
    await store.deleteSnapshot(THREAD_1, CAT_OPUS)
    expect(await store.getSnapshot(THREAD_1, CAT_OPUS)).toBeNull()
    // Second delete is a no-op
    await expect(store.deleteSnapshot(THREAD_1, CAT_OPUS)).resolves.toBeUndefined()
  })

  it('cleans up empty thread map', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot())
    await store.deleteSnapshot(THREAD_1, CAT_OPUS)
    expect(store.size).toBe(0)
  })
})

describe('MemoryTaskProgressStore — deleteSnapshotIfOwner (CAS)', () => {
  it('deletes when lastInvocationId matches', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot({ lastInvocationId: INV_A }))
    const ok = await store.deleteSnapshotIfOwner(THREAD_1, CAT_OPUS, INV_A)
    expect(ok).toBe(true)
    expect(await store.getSnapshot(THREAD_1, CAT_OPUS)).toBeNull()
  })

  it('refuses delete when lastInvocationId differs (replacement race)', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot({ lastInvocationId: INV_B }))
    const ok = await store.deleteSnapshotIfOwner(THREAD_1, CAT_OPUS, INV_A)
    expect(ok).toBe(false)
    expect(await store.getSnapshot(THREAD_1, CAT_OPUS)).not.toBeNull()
  })

  it('returns false when snapshot absent', async () => {
    const store = new MemoryTaskProgressStore()
    const ok = await store.deleteSnapshotIfOwner(THREAD_1, CAT_OPUS, INV_A)
    expect(ok).toBe(false)
  })
})

describe('MemoryTaskProgressStore — getThreadSnapshots', () => {
  it('returns all snapshots for a thread keyed by catId', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot({ catId: CAT_OPUS }))
    await store.setSnapshot(snapshot({ catId: CAT_NEO }))
    const all = await store.getThreadSnapshots(THREAD_1)
    expect(Object.keys(all)).toHaveLength(2)
    expect(all[CAT_OPUS as string]?.catId).toBe(CAT_OPUS)
    expect(all[CAT_NEO as string]?.catId).toBe(CAT_NEO)
  })

  it('returns empty object for unknown thread', async () => {
    const store = new MemoryTaskProgressStore()
    const all = await store.getThreadSnapshots(THREAD_2)
    expect(all).toEqual({})
  })
})

describe('MemoryTaskProgressStore — deleteThread', () => {
  it('removes all snapshots for a thread and is idempotent', async () => {
    const store = new MemoryTaskProgressStore()
    await store.setSnapshot(snapshot({ catId: CAT_OPUS }))
    await store.setSnapshot(snapshot({ catId: CAT_NEO }))
    await store.deleteThread(THREAD_1)
    expect(await store.getThreadSnapshots(THREAD_1)).toEqual({})
    expect(store.size).toBe(0)
    await expect(store.deleteThread(THREAD_1)).resolves.toBeUndefined()
  })
})
