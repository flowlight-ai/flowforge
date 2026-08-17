/**
 * MemoryTaskManagedWorkRegistrationStore — in-memory ITaskManagedWorkRegistrationStore.
 *
 * Ported from clowder-ai `TaskManagedWorkRegistrationStore.ts`
 * (api/src/domains/cats/services/stores/ports/), decoupled from the host
 * TaskStore (clowder-ai's class takes a host object exposing
 * getBySubject / getById / upsertBySubject). In flowforge the port is a
 * standalone binding index: the orchestration layer (cats-invocation plugin)
 * composes ITaskStore + this port explicitly, so the Memory backend is a
 * pure `Map<taskId, ManagedWorkBinding>` plus a reverse-lookup index.
 *
 * `upsert` is atomic: synchronous Map ops in Node.js single-threaded runtime
 * provide the same CAS guarantee as Redis Lua scripts. Conflict detection
 * (different workId or attemptId on the same taskId) is synchronous.
 *
 * @module @flowforge/cats-stores/memory
 */

import type { ManagedWorkBinding } from '@flowforge/cats-shared'
import type {
  ITaskManagedWorkRegistrationStore,
  ManagedWorkBindingConflict,
  UpsertManagedWorkBindingOutcome,
} from '../ports/task-managed-work-registration-store.ts'

/** Reverse-lookup key: `${workId}:${attemptId}` → taskId. */
function workAttemptKey(workId: string, attemptId: string): string {
  return `${workId}:${attemptId}`
}

function bindingsEqual(a: ManagedWorkBinding, b: ManagedWorkBinding): boolean {
  return a.workId === b.workId && a.attemptId === b.attemptId
}

export class MemoryTaskManagedWorkRegistrationStore implements ITaskManagedWorkRegistrationStore {
  /** Forward index: taskId → binding. */
  private readonly byTask = new Map<string, ManagedWorkBinding>()
  /** Reverse index: workAttemptKey → taskId (for duplicate-attempt detection). */
  private readonly byWorkAttempt = new Map<string, string>()

  upsert(taskId: string, binding: ManagedWorkBinding): UpsertManagedWorkBindingOutcome {
    const existing = this.byTask.get(taskId)
    if (existing) {
      // Idempotent if same binding.
      if (bindingsEqual(existing, binding)) {
        return { outcome: 'bound', taskId, binding: existing }
      }
      const conflict: ManagedWorkBindingConflict = {
        kind: 'managed_work_binding_conflict',
        taskId,
        existing,
        incoming: binding,
      }
      return { outcome: 'conflict', conflict }
    }

    // No prior binding on this task — install it and update reverse index.
    this.byTask.set(taskId, binding)
    this.byWorkAttempt.set(workAttemptKey(binding.workId, binding.attemptId), taskId)
    return { outcome: 'bound', taskId, binding }
  }

  bind(taskId: string, binding: ManagedWorkBinding): ManagedWorkBinding {
    const existing = this.byTask.get(taskId)
    if (existing) {
      // Remove old reverse-index entry before overwriting.
      this.byWorkAttempt.delete(workAttemptKey(existing.workId, existing.attemptId))
    }
    this.byTask.set(taskId, binding)
    this.byWorkAttempt.set(workAttemptKey(binding.workId, binding.attemptId), taskId)
    return binding
  }

  get(taskId: string): ManagedWorkBinding | null {
    return this.byTask.get(taskId) ?? null
  }

  getByWorkAttempt(workId: string, attemptId: string): string | null {
    return this.byWorkAttempt.get(workAttemptKey(workId, attemptId)) ?? null
  }

  delete(taskId: string): boolean {
    const existing = this.byTask.get(taskId)
    if (!existing) return false
    this.byTask.delete(taskId)
    this.byWorkAttempt.delete(workAttemptKey(existing.workId, existing.attemptId))
    return true
  }

  /** Test helper: count of registered bindings. */
  get size(): number {
    return this.byTask.size
  }
}
