/**
 * ITaskManagedWorkRegistrationStore — managed-work binding port for tasks.
 *
 * Ported from clowder-ai `TaskManagedWorkRegistrationStore.ts`
 * (api/src/domains/cats/services/stores/ports/), decoupled from the host
 * TaskStore. The clowder-ai original is a concrete class wired to a
 * TaskStore host (getBySubject / getById / upsertBySubject); in flowforge
 * the port is a standalone binding index so the orchestration layer
 * (cats-invocation plugin) composes ITaskStore + this port explicitly.
 *
 * The store maps `taskId → ManagedWorkBinding` and supports reverse lookup
 * by `(workId, attemptId)` so queue admission can detect duplicate
 * bindings for the same managed work attempt.
 *
 * Backends must implement `upsert` atomically: a binding conflict
 * (different workId or attemptId on the same taskId) MUST be rejected
 * synchronously — Memory achieves this via synchronous Map ops, Sqlite
 * will use a transaction.
 *
 * @module @flowforge/cats-stores/ports
 */

import type { ManagedWorkBinding } from '@flowforge/cats-shared'

/** Conflict raised when a different binding already owns the task. */
export interface ManagedWorkBindingConflict {
  readonly kind: 'managed_work_binding_conflict'
  readonly taskId: string
  readonly existing: ManagedWorkBinding
  readonly incoming: ManagedWorkBinding
}

/** Outcome of `upsert`. */
export type UpsertManagedWorkBindingOutcome =
  | { readonly outcome: 'bound'; readonly taskId: string; readonly binding: ManagedWorkBinding }
  | { readonly outcome: 'conflict'; readonly conflict: ManagedWorkBindingConflict }

/**
 * Port for the managed-work registration store.
 *
 * Methods are sync-or-async to keep the contract uniform across Memory
 * (synchronous Map) and future Sqlite / Redis backends.
 */
export interface ITaskManagedWorkRegistrationStore {
  /**
   * Atomic create-or-replace. If no binding exists for `taskId`, store
   * `binding` and return `{ outcome: 'bound' }`. If the existing binding
   * equals `binding`, treat as idempotent and return `{ outcome: 'bound' }`.
   * Otherwise return `{ outcome: 'conflict', conflict }` so the caller can
   * surface the existing binding without try/catch.
   */
  upsert(taskId: string, binding: ManagedWorkBinding): UpsertManagedWorkBindingOutcome | Promise<UpsertManagedWorkBindingOutcome>

  /**
   * Force-bind a task to a binding, replacing any prior binding. Used by
   * reconciliation / repair flows that have already validated the
   * overwrite. Returns the stored binding.
   */
  bind(taskId: string, binding: ManagedWorkBinding): ManagedWorkBinding | Promise<ManagedWorkBinding>

  /** Read the binding for a task, or null if unbound. */
  get(taskId: string): ManagedWorkBinding | null | Promise<ManagedWorkBinding | null>

  /**
   * Reverse-lookup: find the task bound to `(workId, attemptId)`, or null
   * if no task is bound to that pair. Used by queue admission to detect
   * duplicate submissions of the same managed-work attempt.
   */
  getByWorkAttempt(workId: string, attemptId: string): string | null | Promise<string | null>

  /** Remove the binding for a task. Idempotent. Returns true if a binding was removed. */
  delete(taskId: string): boolean | Promise<boolean>
}
