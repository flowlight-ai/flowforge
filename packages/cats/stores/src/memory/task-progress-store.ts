/**
 * MemoryTaskProgressStore — in-memory ITaskProgressStore.
 *
 * Ported from clowder-ai `MemoryTaskProgressStore.ts`
 * (api/src/domains/cats/services/agents/invocation/), using branded types
 * (CatId / ThreadId / InvocationId) from `@flowforge/cats-shared`.
 *
 * Layout: `Map<ThreadId, Map<CatId, TaskProgressSnapshot>>`. The CAS delete
 * (`deleteSnapshotIfOwner`) is naturally atomic because Node.js is
 * single-threaded and the comparison + delete happen synchronously inside
 * one async method.
 *
 * Not durable across processes — load the Sqlite backend for persistence.
 *
 * @module @flowforge/cats-stores/memory
 */

import type { CatId, InvocationId, ThreadId } from '@flowforge/cats-shared'
import type {
  ITaskProgressStore,
  SetSnapshotOptions,
  TaskProgressSnapshot,
} from '../ports/task-progress-store.ts'

export class MemoryTaskProgressStore implements ITaskProgressStore {
  private readonly byThread = new Map<ThreadId, Map<CatId, TaskProgressSnapshot>>()

  async getSnapshot(threadId: ThreadId, catId: CatId): Promise<TaskProgressSnapshot | null> {
    return this.byThread.get(threadId)?.get(catId) ?? null
  }

  async setSnapshot(snapshot: TaskProgressSnapshot, _options?: SetSnapshotOptions): Promise<void> {
    let thread = this.byThread.get(snapshot.threadId)
    if (!thread) {
      thread = new Map<CatId, TaskProgressSnapshot>()
      this.byThread.set(snapshot.threadId, thread)
    }
    thread.set(snapshot.catId, snapshot)
  }

  async deleteSnapshot(threadId: ThreadId, catId: CatId): Promise<void> {
    const thread = this.byThread.get(threadId)
    if (!thread) return
    thread.delete(catId)
    if (thread.size === 0) this.byThread.delete(threadId)
  }

  async deleteSnapshotIfOwner(
    threadId: ThreadId,
    catId: CatId,
    invocationId: InvocationId,
  ): Promise<boolean> {
    const thread = this.byThread.get(threadId)
    const snapshot = thread?.get(catId)
    if (!thread || !snapshot) return false
    if (snapshot.lastInvocationId !== invocationId) return false
    thread.delete(catId)
    if (thread.size === 0) this.byThread.delete(threadId)
    return true
  }

  async getThreadSnapshots(
    threadId: ThreadId,
  ): Promise<Readonly<Record<string, TaskProgressSnapshot>>> {
    const thread = this.byThread.get(threadId)
    if (!thread) return {}
    const out: Record<string, TaskProgressSnapshot> = {}
    for (const [catId, snapshot] of thread.entries()) {
      out[catId as string] = snapshot
    }
    return out
  }

  async deleteThread(threadId: ThreadId): Promise<void> {
    this.byThread.delete(threadId)
  }

  /** Test helper: count snapshots across all threads. */
  get size(): number {
    let total = 0
    for (const thread of this.byThread.values()) total += thread.size
    return total
  }
}
