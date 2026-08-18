/**
 * @flowforge/cats-invocation — unit tests for the cats invocation
 * queue / tracker / mutex / progress services and the pure zombie
 * reconciliation + startup sweep orchestrators (batch 3.6).
 *
 * 对齐 dsh 测试风格：内存实现直接挂到 `Context`，纯函数以夹具注入依赖。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import {
  classifyInvocationRecoveryStatus,
  createCatId,
  createInvocationId,
  createMessageId,
  createQueueEntryId,
  createThreadId,
  createUserId,
  isValidTransition,
  MAX_QUEUE_DEPTH,
  type InvocationId,
  type ReconcileZombieDeps,
  type ZombieRecord,
} from '@flowforge/cats-shared'
import { MemoryTaskProgressStore } from '@flowforge/cats-stores'
import type { TaskProgressSnapshot } from '@flowforge/cats-stores'
import {
  MemoryInvocationQueueService,
  MemoryInvocationTrackerService,
  MemorySessionMutexService,
  MemoryTaskProgressService,
  convergeZombieQueueEntry,
  makeConvergeQueueEntry,
  reconcileZombies,
  runStartupSweep,
  type QueueEntry,
  type EnqueueInput,
  type ZombieQueueConverger,
} from '@flowforge/cats-invocation'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const threadId = createThreadId('thread_test_1')
const userId = createUserId('user_1')
const receivedUserId = createUserId('user_2')
const catA = createCatId('cat_a')
const catB = createCatId('cat_b')
const userMessageId = createMessageId('msg_trigger')

function enqueueInput(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    threadId,
    userId,
    targetCatIds: [catA],
    source: 'user',
    userMessageId,
    ...overrides,
  }
}

function seededSnapshot(catId: string): TaskProgressSnapshot {
  return {
    threadId,
    catId: createCatId(catId),
    tasks: [{ id: 't1', subject: 'review', status: 'in_progress' }],
    status: 'running',
    updatedAt: Date.now(),
    lastInvocationId: createInvocationId('inv_zombie'),
  }
}

/** Log stub capturing messages for assertions. */
function stubLog() {
  const info = vi.fn()
  const warn = vi.fn()
  return { info, warn, log: { info, warn } }
}

// ---------------------------------------------------------------------------
// InvocationQueueService (Memory)
// ---------------------------------------------------------------------------

describe('MemoryInvocationQueueService', () => {
  function harness() {
    const ctx = new Context()
    const queue = new MemoryInvocationQueueService(ctx)
    return { ctx, queue }
  }

  it('enqueues a user entry and exposes it via peek/size/dequeue', () => {
    const { queue } = harness()
    const result = queue.enqueue(enqueueInput())

    expect(result.outcome).toBe('created')
    expect(result.entry).toBeDefined()

    expect(queue.size(threadId, userId)).toBe(1)
    expect(queue.peek(threadId, userId).map((e) => e.id)).toEqual([result.entry!.id])

    const dequeued = queue.dequeue(threadId, userId)
    expect(dequeued?.id).toBe(result.entry!.id)
    expect(dequeued?.processingStartedAt).toBeDefined()
  })

  it('dedupes by idempotency key and returns the existing entry', () => {
    const { queue } = harness()
    const first = queue.enqueue(enqueueInput({ idempotencyKey: 'k1' }))
    expect(first.outcome).toBe('created')

    const second = queue.enqueue(enqueueInput({ idempotencyKey: 'k1' }))
    expect(second.outcome).toBe('deduped')
    expect(second.dedupedEntryId).toBe(first.entry!.id)
    expect(queue.size(threadId, userId)).toBe(1)
  })

  it('dedupes only active entries — re-enqueues after the original is processed', () => {
    const { queue } = harness()
    const first = queue.enqueue(enqueueInput({ idempotencyKey: 'k-repost' }))
    queue.markProcessed(first.entry!.id)
    expect(queue.size(threadId, userId)).toBe(0)

    const again = queue.enqueue(enqueueInput({ idempotencyKey: 'k-repost' }))
    expect(again.outcome).toBe('created')
  })

  it('enforces MAX_QUEUE_DEPTH for user-source entries only', () => {
    const { queue } = harness()
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      expect(queue.enqueue(enqueueInput({ userMessageId: createMessageId(`msg_${i}`) })).outcome).toBe('created')
    }
    const overflow = queue.enqueue(enqueueInput({ userMessageId: createMessageId('msg_overflow') }))
    expect(overflow.outcome).toBe('full')
    expect(queue.size(threadId, userId)).toBe(MAX_QUEUE_DEPTH)

    // Non-user sources are not depth-limited.
    const connector = queue.enqueue(enqueueInput({ source: 'connector' }))
    expect(connector.outcome).toBe('created')
  })

  it('dequeue only yields unprocessed entries and advances FIFO', () => {
    const { queue } = harness()
    const e1 = queue.enqueue(enqueueInput({ userMessageId: createMessageId('a') })).entry!
    queue.enqueue(enqueueInput({ userMessageId: createMessageId('b') }))

    const first = queue.dequeue(threadId, userId)!
    expect(first.id).toBe(e1.id)
    queue.markProcessed(first.id)

    const second = queue.dequeue(threadId, userId)!
    expect(second.userMessageId).toBe(createMessageId('b'))
  })

  it('remove deletes an entry and reindexes positions', () => {
    const { queue } = harness()
    const e1 = queue.enqueue(enqueueInput({ userMessageId: createMessageId('a') })).entry!
    queue.enqueue(enqueueInput({ userMessageId: createMessageId('b') }))

    expect(queue.remove(e1.id)).toBe(true)
    expect(queue.remove(e1.id)).toBe(false)
    expect(queue.size(threadId, userId)).toBe(1)
    const rest = queue.peek(threadId, userId)
    expect(rest[0]!.position).toBe(0)
  })

  it('markProcessing fails if already processing or processed', () => {
    const { queue } = harness()
    const entry = queue.enqueue(enqueueInput()).entry!
    expect(queue.markProcessing(entry.id)).toBe(true)
    expect(queue.markProcessing(entry.id)).toBe(false)
    queue.markProcessed(entry.id)
    expect(queue.markProcessed(entry.id)).toBe(false)
    expect(queue.markProcessing(entry.id)).toBe(false)
  })

  it('markProcessed is terminal-only and idempotent-false', () => {
    const { queue } = harness()
    const entry = queue.enqueue(enqueueInput()).entry!
    expect(queue.markProcessed(entry.id)).toBe(true)
    expect(queue.markProcessed(entry.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// InvocationTrackerService (Memory)
// ---------------------------------------------------------------------------

describe('MemoryInvocationTrackerService', () => {
  function harness(opts?: { maxSlotTtlMs?: number }) {
    const ctx = new Context()
    const tracker = new MemoryInvocationTrackerService(ctx, opts)
    return { ctx, tracker }
  }

  it('tracks unique executionIds after start', () => {
    const { tracker } = harness()
    const controller = tracker.start(threadId, catA, userId, [catA], 'exec-run-1')
    expect(controller.signal.aborted).toBe(false)
    expect(tracker.has(threadId, catA)).toBe(true)
    expect(tracker.getExecutionId(threadId, catA)).toBe('exec-run-1')
    expect(tracker.getUserId(threadId, catA)).toBe(userId)
  })

  it('start aborts the previous controller for the SAME slot', () => {
    const { tracker } = harness()
    const first = tracker.start(threadId, catA, userId, [catA], 'exec-1')
    const second = tracker.start(threadId, catA, userId, [catA], 'exec-2')
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
    expect(tracker.getExecutionId(threadId, catA)).toBe('exec-2')
  })

  it('does not abort a different catId in the same thread (concurrent slots)', () => {
    const { tracker } = harness()
    const a = tracker.start(threadId, catA, userId, [catA])
    const b = tracker.start(threadId, catB, userId, [catB])
    expect(a.signal.aborted).toBe(false)
    expect(b.signal.aborted).toBe(false)
    expect(tracker.has(threadId)).toBe(true)
  })

  it('tryStartThread returns null when the thread is busy', () => {
    const { tracker } = harness()
    tracker.start(threadId, catA, userId, [catA])
    expect(tracker.tryStartThread(threadId, catB, userId, [catB])).toBeNull()
  })

  it('cancel returns the aborted controller as a retainable tombstone', () => {
    const { tracker } = harness()
    const before = tracker.start(threadId, catA, userId, [catA], 'exec-c')
    const result = tracker.cancel(threadId, catA, userId)
    expect(result.cancelled).toBe(true)
    expect(result.catIds).toEqual([catA])
    expect(before.signal.aborted).toBe(true)
    // Tombstone retained: controller still reachable, slot observable as canceled.
    expect(tracker.getController(threadId, catA)).toBe(before)
    expect(tracker.getSlotState(threadId, catA)).toBe('canceled')
  })

  it('cancel respects the requestUserId holder check', () => {
    const { tracker } = harness()
    tracker.start(threadId, catA, userId, [catA])
    const result = tracker.cancel(threadId, catA, receivedUserId)
    expect(result.cancelled).toBe(false)
    expect(tracker.has(threadId, catA)).toBe(true)
  })

  it('cancelAll aborts every active slot and cascades batch gates', () => {
    const { tracker } = harness()
    tracker.startAll(threadId, [catA, catB], userId, 'exec-batch')
    expect(tracker.has(threadId)).toBe(true)

    const result = tracker.cancelAll(threadId, userId)
    expect([...result.catIds].sort()).toEqual([catA, catB].sort())
    expect(result.executionIds).toEqual(['exec-batch'])
    expect(result.executionIdByCatId['cat_a']).toBe('exec-batch')
    expect(tracker.has(threadId)).toBe(false)
  })

  it('cancelInvocation only cancels anchors + slots sharing their batch', () => {
    const { tracker } = harness()
    // Two independent single-slot invocations.
    const outsideA = tracker.start(threadId, catA, userId, [catA], 'single-a')
    const outsideB = tracker.start(threadId, catB, userId, [catB], 'single-b')
    // A batch covering catC + catD sharing one gate.
    const catC = createCatId('cat_c')
    const catD = createCatId('cat_d')
    const batchGate = tracker.startAll(threadId, [catC, catD], userId, 'batch-cd')

    const cancelled = tracker.cancelInvocation(threadId, [catC], userId)
    expect([...cancelled].sort()).toEqual([catC, catD].sort())
    // Anchors/batch members aborted; unrelated single slots untouched.
    expect(batchGate.signal.aborted).toBe(true)
    expect(outsideA.signal.aborted).toBe(false)
    expect(outsideB.signal.aborted).toBe(false)
    expect(tracker.has(threadId, catC)).toBe(false)
    expect(tracker.has(threadId, catA)).toBe(true)
  })

  it('complete retires a slot only when its controller matches, preserving canceled tombstones', () => {
    const { tracker } = harness()
    const stale = new AbortController()
    tracker.start(threadId, catA, userId, [catA], 'exec-complete')

    // Wrong controller → no-op.
    tracker.complete(threadId, catA, stale)
    expect(tracker.has(threadId, catA)).toBe(true)

    const current = tracker.getController(threadId, catA)!
    tracker.complete(threadId, catA, current)
    expect(tracker.has(threadId, catA)).toBe(false)

    // A canceled tombstone is NOT purged by complete.
    tracker.start(threadId, catA, userId, [catA], 'exec-c2')
    tracker.cancel(threadId, catA, userId)
    tracker.complete(threadId, catA, tracker.getController(threadId, catA)!)
    expect(tracker.getSlotState(threadId, catA)).toBe('canceled')
  })

  it('completeByExecutionId retires only the exact execution owner', () => {
    const { tracker } = harness()
    tracker.start(threadId, catA, userId, [catA], 'exec-owner')
    expect(tracker.classifyExecutionId(threadId, catA, 'exec-owner')).toBe('matching')
    // A different executionId is a replacement — slot stays.
    expect(tracker.classifyExecutionId(threadId, catA, 'exec-other')).toBe('replacement')
    expect(tracker.completeByExecutionId(threadId, catA, 'exec-other')).toBe('replacement')
    expect(tracker.has(threadId, catA)).toBe(true)

    expect(tracker.completeByExecutionId(threadId, catA, 'exec-owner')).toBe('released')
    expect(tracker.has(threadId, catA)).toBe(false)
    expect(tracker.completeByExecutionId(threadId, catA, 'exec-owner')).toBe('absent')
  })

  it('trackExternalSlot replaces a canceled tombstone (A2A re-occupation)', () => {
    const { tracker } = harness()
    const routeGate = new AbortController()
    tracker.start(threadId, catA, userId, [catA], 'exec-single')
    tracker.cancel(threadId, catA, userId)
    expect(tracker.getSlotState(threadId, catA)).toBe('canceled')

    // Re-track — gives the slot its OWN controller, keeping the route gate as batch.
    const ok = tracker.trackExternalSlot(threadId, catA, routeGate, userId, [catA], 'exec-retrack')
    expect(ok).toBe(true)
    expect(tracker.getSlotState(threadId, catA)).toBe('active')
    expect(tracker.getController(threadId, catA)).not.toBe(routeGate)
    // Idempotent re-track of same route gate.
    expect(tracker.trackExternalSlot(threadId, catA, routeGate, userId, [catA])).toBe(true)
  })

  it('startAll gives each cat its own controller with an independent batch gate', () => {
    const { tracker } = harness()
    const batchGate = tracker.startAll(threadId, [catA, catB], userId, 'exec-multi')
    const a = tracker.getController(threadId, catA)!
    const b = tracker.getController(threadId, catB)!
    expect(a).not.toBe(b)
    expect(a).not.toBe(batchGate)
    expect(batchGate.signal.aborted).toBe(false)

    // Canceling ONE cat does NOT abort the batch gate.
    tracker.cancel(threadId, catB, userId)
    expect(a.signal.aborted).toBe(false)
    expect(batchGate.signal.aborted).toBe(false)
    expect(tracker.getSlotState(threadId, catB)).toBe('canceled')
  })

  it('tryStartThreadAll is non-preemptive (null when thread busy) and batches independently', () => {
    const { tracker } = harness()
    // Thread currently free.
    const gate = tracker.tryStartThreadAll(threadId, [catA, catB], userId, 'exec-ta')
    expect(gate).not.toBeNull()
    // Now busy → another try rejects.
    expect(tracker.tryStartThreadAll(threadId, [catB], userId)).toBeNull()
    expect(tracker.has(threadId)).toBe(true)
  })

  it('guardDelete is refused while a slot is active; else fences the thread', () => {
    const { tracker } = harness()
    tracker.start(threadId, catA, userId, [catA])
    const refused = tracker.guardDelete(threadId)
    expect(refused.acquired).toBe(false)

    tracker.completeAll(threadId, [catA])
    const guard = tracker.guardDelete(threadId)
    expect(guard.acquired).toBe(true)
    expect(tracker.isDeleting(threadId)).toBe(true)
    // While deleting, start is a no-op aborted controller.
    const during = tracker.start(threadId, catB, userId, [catB])
    expect(during.signal.aborted).toBe(true)
    guard.release()
    expect(tracker.isDeleting(threadId)).toBe(false)
  })

  it('getActiveSlots excludes canceled tombstones', () => {
    const { tracker } = harness()
    tracker.start(threadId, catA, userId, [catA], 'exec-a')
    tracker.start(threadId, catB, userId, [catB], 'exec-b')
    tracker.cancel(threadId, catB, userId)

    const slots = tracker.getActiveSlots(threadId)
    expect(slots.map((s) => s.catId as string)).toEqual(['cat_a'])
  })

  it('resolveFinalStatus reports user-cancel vs plain cancel', () => {
    const { tracker } = harness()
    expect(tracker.resolveFinalStatus(threadId, [catA], { aborted: false })).toBe('succeeded')
    expect(tracker.resolveFinalStatus(threadId, [catA], { aborted: true, reason: 'user_cancel' })).toBe('canceled_by_user')
    expect(tracker.resolveFinalStatus(threadId, [catA], { aborted: true, reason: 'timeout' })).toBe('canceled')
    expect(tracker.resolveFinalStatus(threadId, [], { aborted: false })).toBe('succeeded')
  })

  it('TTL expiry aborts and retires an over-age slot (F118 D3)', () => {
    vi.useFakeTimers()
    try {
      const { tracker } = harness({ maxSlotTtlMs: 1_000 })
      const controller = tracker.start(threadId, catA, userId, [catA])
      expect(tracker.has(threadId, catA)).toBe(true)

      vi.setSystemTime(Date.now() + 2_000)
      // F118 D3 is lazy: a read triggers the TTL expiration before we assert.
      expect(tracker.getSlotState(threadId, catA)).toBe('absent')
      expect(controller.signal.aborted).toBe(true)
      expect(tracker.has(threadId, catA)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---------------------------------------------------------------------------
// SessionMutexService (Memory)
// ---------------------------------------------------------------------------

describe('MemorySessionMutexService', () => {
  function harness() {
    const ctx = new Context()
    const mutex = new MemorySessionMutexService(ctx)
    return { ctx, mutex }
  }

  const owner = (sessionId: string, se?: object) => ({
    sessionId,
    threadId,
    userId,
    acquiredAt: Date.now(),
    ...(se ?? {}),
  })

  it('acquire resolves immediately without contention and is idempotent on release', async () => {
    const { mutex } = harness()
    const release = await mutex.acquire('sess-1')
    expect(mutex.isHeld('sess-1')).toBe(true)
    release()
    release() // idempotent
    expect(mutex.isHeld('sess-1')).toBe(false)
  })

  it('queues a contending acquire until the holder releases (FIFO)', async () => {
    const { mutex } = harness()
    const release1 = await mutex.acquire('sess-2')

    const order: string[] = []
    const p2 = mutex.acquire(owner('sess-2', { executionId: 'e2' })).then((r) => {
      order.push('second')
      return r
    })
    await Promise.resolve() // let the waiter register
    expect(mutex.isHeld('sess-2')).toBe(true)

    release1()
    const release2 = await p2
    expect(order).toEqual(['second'])
    expect(mutex.isHeld('sess-2')).toBe(true)
    release2()
    expect(mutex.isHeld('sess-2')).toBe(false)
  })

  it('rejects a waiting acquire when its AbortSignal fires', async () => {
    const { mutex } = harness()
    const release1 = await mutex.acquire('sess-abort')
    const ac = new AbortController()

    const waiting = mutex.acquire('sess-abort', ac.signal)
    await Promise.resolve()
    ac.abort()

    await expect(waiting).rejects.toThrow(/aborted/i)
    release1()
    expect(mutex.isHeld('sess-abort')).toBe(false)
  })

  it('rejects immediately if the signal is already aborted', async () => {
    const { mutex } = harness()
    const ac = new AbortController()
    ac.abort()
    await expect(mutex.acquire('sess-pre', ac.signal)).rejects.toThrow(/aborted/i)
  })

  it('forceReleaseByScope releases matching holders and rejects matching waiters', async () => {
    const { mutex } = harness()
    // Held by a matching agent owner.
    const matchingRelease = await mutex.acquire(owner('sess-m', { catId: catA, executionId: 'e-m' }))
    // A different thread (no match).
    const otherThread = await mutex.acquire(owner('sess-other', { threadId: createThreadId('thread_other'), catId: catA }))
    // A matching waiter queued behind the matching holder.
    const waitingM = mutex.acquire(owner('sess-m', { catId: catA, executionId: 'e-m2' }))
    await Promise.resolve()

    const result = mutex.forceReleaseByScope({ threadId, userId, catId: catA })
    expect(result.releasedHolders).toBe(1)
    expect(result.rejectedWaiters).toBe(1)
    expect(result.catIds).toContain('cat_a')
    await expect(waitingM).rejects.toThrow(/force released/i)

    // otherThread untouched.
    expect(mutex.isHeld('sess-other')).toBe(true)
    matchingRelease() // idempotent no-op
    otherThread()
  })

  it('forceReleaseByScope preserves holders with exempt executionIds', async () => {
    const { mutex } = harness()
    const release = await mutex.acquire(owner('sess-preserve', { catId: catA, executionId: 'keep-me' }))
    const result = mutex.forceReleaseByScope(
      { threadId, userId, catId: catA },
      { preserveHolderExecutionIds: ['keep-me'] },
    )
    expect(result.releasedHolders).toBe(0)
    expect(mutex.isHeld('sess-preserve')).toBe(true)
    release()
  })

  it('forceReleaseByScope preserves a same-thread lock on a different cat', async () => {
    const { mutex } = harness()
    const releaseB = await mutex.acquire(owner('sess-b', { catId: catB }))
    const result = mutex.forceReleaseByScope({ threadId, userId, catId: catA })
    expect(result.releasedHolders).toBe(0)
    expect(mutex.isHeld('sess-b')).toBe(true)
    releaseB()
  })
})

// ---------------------------------------------------------------------------
// TaskProgressService (Memory, wrapping the store)
// ---------------------------------------------------------------------------

describe('MemoryTaskProgressService', () => {
  function harness() {
    const store = new MemoryTaskProgressStore()
    const ctx = new Context()
    const service = new MemoryTaskProgressService(ctx, store)
    return { ctx, service, store }
  }

  it('reads/writes/clears snapshots through the store', async () => {
    const { service, store } = harness()
    const snap = seededSnapshot('cat_a')
    await service.setSnapshot(snap)
    expect(await service.getSnapshot(threadId, catA)).toEqual(snap)

    await service.deleteSnapshot(threadId, catA)
    expect(await service.getSnapshot(threadId, catA)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('deleteSnapshotIfOwner is a CAS (owner-scoped) delete', async () => {
    const { service, store } = harness()
    await service.setSnapshot(seededSnapshot('cat_a'))

    // Wrong owner id → no-op.
    expect(await service.deleteSnapshotIfOwner(threadId, catA, createInvocationId('inv_wrong'))).toBe(false)
    expect(store.size).toBe(1)
    // Correct owner → removed.
    expect(await service.deleteSnapshotIfOwner(threadId, catA, createInvocationId('inv_zombie'))).toBe(true)
    expect(store.size).toBe(0)
  })

  it('getThreadSnapshots returns all cat snapshots for the thread', async () => {
    const { service } = harness()
    await service.setSnapshot(seededSnapshot('cat_a'))
    await service.setSnapshot(seededSnapshot('cat_b'))

    const all = await service.getThreadSnapshots(threadId)
    expect(Object.keys(all).sort()).toEqual(['cat_a', 'cat_b'])
  })

  it('deleteThread removes every snapshot for the thread', async () => {
    const { service } = harness()
    await service.setSnapshot(seededSnapshot('cat_a'))
    await service.setSnapshot(seededSnapshot('cat_b'))
    await service.deleteThread(threadId)
    expect(Object.keys(await service.getThreadSnapshots(threadId))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// reconcileZombies (pure orchestrator)
// ---------------------------------------------------------------------------

describe('reconcileZombies', () => {
  function zombie(overrides: Partial<ZombieRecord> = {}): ZombieRecord {
    return {
      invocationId: createInvocationId('inv_zombie'),
      threadId,
      catIds: [catA],
      status: 'running',
      reason: 'process_restart',
      detectedAt: Date.now(),
      ...overrides,
    }
  }

  function deps(overrides: Partial<ReconcileZombieDeps> = {}): ReconcileZombieDeps {
    return {
      updateInvocation: vi.fn(async () => ({ outcome: 'updated' as const })),
      clearTaskProgress: vi.fn(async () => true),
      convergeQueueEntry: vi.fn(async () => ({ converged: 1, errors: 0 })),
      log: stubLog().log,
      ...overrides,
    }
  }

  it('marks a running zombie failed and clears task progress + queue', async () => {
    const updateInvocation = vi.fn(async () => ({ outcome: 'updated' as const }))
    const clearTaskProgress = vi.fn(async () => true)
    const convergeQueueEntry = vi.fn(async () => ({ converged: 1, errors: 0 }))
    const onReconciledZombie = vi.fn()
    const d = deps({ updateInvocation, clearTaskProgress, convergeQueueEntry, onReconciledZombie })

    const result = await reconcileZombies([zombie()], d)

    expect(result.reconciled).toBe(1)
    expect(result.taskProgressCleared).toBe(1)
    expect(result.queueConverged).toBe(1)
    expect(result.errors).toBe(0)
    expect(updateInvocation).toHaveBeenCalledWith(createInvocationId('inv_zombie'), {
      status: 'failed',
      expectedStatus: 'running',
      error: 'zombie_record_detected',
    })
    expect(clearTaskProgress).toHaveBeenCalledWith(threadId, catA)
    expect(convergeQueueEntry).toHaveBeenCalledWith(createInvocationId('inv_zombie'))
    expect(onReconciledZombie).toHaveBeenCalledWith(
      expect.objectContaining({ invocationId: createInvocationId('inv_zombie'), to: 'failed' }),
    )
  })

  it('a queued zombie expects queued prior state and uses stale_queued error', async () => {
    const updateInvocation = vi.fn(async () => ({ outcome: 'updated' as const }))
    await reconcileZombies([zombie({ status: 'queued', reason: 'stale_queued' })], deps({ updateInvocation }))
    expect(updateInvocation).toHaveBeenCalledWith(createInvocationId('inv_zombie'), {
      status: 'failed',
      expectedStatus: 'queued',
      error: 'stale_queued',
    })
  })

  it('treats a cas_mismatch as already-terminal but still clears task progress', async () => {
    const clearTaskProgress = vi.fn(async () => true)
    const d = deps({
      updateInvocation: vi.fn(async () => ({ outcome: 'cas_mismatch' as const })),
      clearTaskProgress,

    })
    const result = await reconcileZombies([zombie()], d)
    expect(result.alreadyTerminal).toBe(1)
    expect(result.reconciled).toBe(0)
    expect(result.taskProgressCleared).toBe(1)
    expect(clearTaskProgress).toHaveBeenCalled()
  })

  it('counts invalid_transition as already-terminal without clearing', async () => {
    const clearTaskProgress = vi.fn(async () => true)
    const d = deps({
      updateInvocation: vi.fn(async () => ({ outcome: 'invalid_transition' as const })),
      clearTaskProgress,
    })
    const result = await reconcileZombies([zombie()], d)
    expect(result.alreadyTerminal).toBe(1)
    expect(result.taskProgressCleared).toBe(0)
  })

  it('records per-zombie errors and continues on failure', async () => {
    const d = deps({
      updateInvocation: vi.fn(async () => {
        throw new Error('store down')
      }),
    })
    const result = await reconcileZombies([zombie()], d)
    expect(result.errors).toBe(1)
    expect(result.details[0]?.outcome).toBe('error')
    expect(result.details[0]?.error).toBe('store down')
  })

  it('fails convergence errors into the aggregate error count', async () => {
    const warn = stubLog().warn
    const d = deps({
      convergeQueueEntry: vi.fn(async () => ({ converged: 0, errors: 2 })),
      log: { info: vi.fn(), warn },
    })
    const result = await reconcileZombies([zombie()], d)
    expect(result.errors).toBe(2)
    expect(result.queueConverged).toBe(0)
  })

  it('is safe with no zombies', async () => {
    const result = await reconcileZombies([], deps())
    expect(result).toEqual({
      reconciled: 0,
      alreadyTerminal: 0,
      taskProgressCleared: 0,
      queueConverged: 0,
      errors: 0,
      details: [],
    })
  })
})

// ---------------------------------------------------------------------------
// convergeZombieQueueEntry / makeConvergeQueueEntry
// ---------------------------------------------------------------------------

describe('convergeZombieQueueEntry', () => {
  const log = { info: vi.fn(), warn: vi.fn() }

  function staleEntry(id: string, msgId: string, processing = true): QueueEntry {
    return {
      id: createQueueEntryId(id),
      threadId,
      userId,
      targetCatIds: [catA],
      source: 'user' as const,
      userMessageId: createMessageId(msgId),
      position: 0,
      enqueuedAt: Date.now(),
      ...(processing ? { processingStartedAt: Date.now() } : {}),
    }
  }

  function queueOver(entries: QueueEntry[]): ZombieQueueConverger {
    return {
      list: vi.fn(() => entries),
      removeProcessed: vi.fn((_t, _u, entryId: string) => {
        const entry = entries.find((e) => (e as { id: string }).id === createQueueEntryId(entryId))
        return entry ?? null
      }),
    }
  }

  it('returns zeros when no queue or no userMessageId', () => {
    expect(convergeZombieQueueEntry(undefined, { threadId, userId, userMessageId }, { invocationId: createInvocationId('i'), reason: 'r' }, log, undefined)).toEqual({ converged: 0, errors: 0 })
    expect(convergeZombieQueueEntry(queueOver([]), { threadId, userId }, { invocationId: createInvocationId('i'), reason: 'r' }, log, undefined)).toEqual({ converged: 0, errors: 0 })
  })

  it('removes only stale processing entries matching the user message id', () => {
    const queue = queueOver([
      staleEntry('q-stale', 'msg_trigger'),
      staleEntry('q-other', 'msg_other'),
      staleEntry('q-terminal', 'msg_trigger', false),
    ])
    const onConverged = vi.fn()
    const result = convergeZombieQueueEntry(
      queue,
      { threadId, userId, userMessageId: createMessageId('msg_trigger') },
      { invocationId: createInvocationId('i1'), reason: 'process_restart' },
      log,
      onConverged,
    )
    expect(result.converged).toBe(1)
    expect(queue.removeProcessed).toHaveBeenCalledWith(threadId, userId, 'q-stale')
    expect(onConverged).toHaveBeenCalledWith({ threadId, userId, removedEntryIds: ['q-stale'] })
  })

  it('tolerates a throwing queue and reports an error', () => {
    const queue = {
      list: vi.fn(() => {
        throw new Error('boom')
      }),
      removeProcessed: vi.fn(),
    }
    const result = convergeZombieQueueEntry(
      queue,
      { threadId, userId, userMessageId: createMessageId('msg_trigger') },
      { invocationId: createInvocationId('i1'), reason: 'r' },
      log,
      undefined,
    )
    expect(result).toEqual({ converged: 0, errors: 1 })
  })

  it('makeConvergeQueueEntry returns undefined when nothing to converge', () => {
    expect(makeConvergeQueueEntry(undefined, { threadId, userId }, log)).toBeUndefined()
    expect(makeConvergeQueueEntry(queueOver([]), { threadId, userId }, log)).toBeUndefined()
  })

  it('makeConvergeQueueEntry wires a ready callback to convergeZombieQueueEntry', async () => {
    const queue = queueOver([staleEntry('q-stale', 'msg_trigger')])
    const converge = makeConvergeQueueEntry(
      queue,
      { threadId, userId, userMessageId: createMessageId('msg_trigger') },
      log,
    )
    expect(converge).toBeDefined()
    const result = await converge?.(createInvocationId('i1'), 'process_restart')
    expect(result?.converged).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// runStartupSweep
// ---------------------------------------------------------------------------

describe('runStartupSweep', () => {
  const now = Date.now()

  function record(invocationId: string, status: 'running' | 'queued', createdAt: number) {
    return {
      invocationId: createInvocationId(invocationId),
      threadId,
      userId,
      catIds: [catA],
      status,
      source: 'user' as const,
      createdAt,
    }
  }

  function sweepDeps(records: { invocationId: string; status: 'running' | 'queued'; createdAt: number }[]) {
    const byId = new Map(records.map((r) => [r.invocationId, record(r.invocationId, r.status, r.createdAt)]))
    const updateInvocation = vi.fn(async () => ({ outcome: 'updated' as const }))
    return {
      deps: {
        updateInvocation,
        scanIdsByStatus: vi.fn(async (status: 'running' | 'queued') =>
          [...byId.values()].filter((r) => r.status === status).map((r) => r.invocationId),
        ),
        getRecord: vi.fn(async (id: InvocationId) => byId.get(id as string) ?? null),
        processStartAt: now - 60_000, // records older than 60s are candidates
        staleQueuedThresholdMs: 5 * 60_000,
        log: stubLog().log,
      },
      updateInvocation,
    }
  }

  it('sweeps an old running orphan to failed', async () => {
    const { deps, updateInvocation } = sweepDeps([
      { invocationId: 'inv_old_run', status: 'running', createdAt: now - 120_000 },
    ])
    const result = await runStartupSweep(deps)
    expect(result.running).toBe(1)
    expect(result.swept).toBe(1)
    expect(updateInvocation).toHaveBeenCalledWith(createInvocationId('inv_old_run'), {
      status: 'failed',
      expectedStatus: 'running',
      error: 'zombie_record_detected',
    })
  })

  it('sweeps a stale queued orphan with stale_queued error', async () => {
    const { deps, updateInvocation } = sweepDeps([
      { invocationId: 'inv_stale_q', status: 'queued', createdAt: now - 10 * 60_000 },
    ])
    const result = await runStartupSweep(deps)
    expect(result.queued).toBe(1)
    expect(result.swept).toBe(1)
    expect(updateInvocation).toHaveBeenCalledWith(createInvocationId('inv_stale_q'), {
      status: 'failed',
      expectedStatus: 'queued',
      error: 'stale_queued',
    })
  })

  it('skips fresh queued records and records started after processStartAt', async () => {
    const { deps } = sweepDeps([
      { invocationId: 'inv_fresh_q', status: 'queued', createdAt: now - 1_000 },
      { invocationId: 'inv_after_start', status: 'running', createdAt: now - 10_000 }, // newer than processStartAt
    ])
    const result = await runStartupSweep(deps)
    expect(result.swept).toBe(0)
    expect(result.queued).toBe(0)
    expect(result.running).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Pure helpers re-exported through the package (regression guards)
// ---------------------------------------------------------------------------

describe('invocation state machine + recovery helpers', () => {
  it('isValidTransition enforces the status machine', () => {
    expect(isValidTransition('queued', 'running')).toBe(true)
    expect(isValidTransition('running', 'failed')).toBe(true)
    expect(isValidTransition('running', 'succeeded')).toBe(true)
    expect(isValidTransition('succeeded', 'running')).toBe(false) // no resurrection
    expect(isValidTransition('queued', 'succeeded')).toBe(false)
    expect(isValidTransition('failed', 'failed')).toBe(true) // idempotent
  })

  it('classifyInvocationRecoveryStatus buckets by age + status', () => {
    expect(classifyInvocationRecoveryStatus('running', 1_000)).toBe('live')
    // running TTL default = 75min; 80min exceeds it → zombie_running
    expect(classifyInvocationRecoveryStatus('running', 80 * 60_000)).toBe('zombie_running')
    expect(classifyInvocationRecoveryStatus('queued', 1_000)).toBe('live')
    expect(classifyInvocationRecoveryStatus('queued', 10 * 60_000)).toBe('zombie_queued')
    expect(classifyInvocationRecoveryStatus('succeeded', 10 * 60_000)).toBe('terminal')
  })
})
