/**
 * IInvocationRecordStore — invocation audit + outcome store port.
 *
 * Ported from clowder-ai `InvocationRecordStore.ts`
 * (api/src/domains/cats/services/stores/ports/), using branded types from
 * `@flowforge/cats-shared` (InvocationId / ThreadId / UserId / CatId) for
 * compile-time type safety. The Memory backend (batch 3.2) ships in
 * `../memory/invocation-record-store.ts`; the Sqlite backend will ship in
 * `@flowforge/cats-stores-sqlite` (separate batch).
 *
 * Design (preserved from clowder-ai, adapted to branded types):
 * - `create()` is atomic create-or-deduplicate: returns the existing
 *   invocationId when the idempotency key still holds (5min TTL).
 * - `update()` enforces the state machine (`isValidTransition`) and CAS
 *   guards (`expectedStatus`) — returns `cas_mismatch` / `invalid_transition`
 *   outcomes instead of throwing, so callers can classify recovery paths.
 * - `listRunningByThread()` powers zombie reconciliation (F194 canonical
 *   liveness read model): running records whose drafts have been TTL-reaped.
 *
 * @module @flowforge/cats-stores/ports
 */

import type {
  CreateInvocationInput,
  CreateInvocationOutcome,
  InvocationId,
  InvocationRecord,
  ThreadId,
  UpdateInvocationInput,
  UpdateInvocationOutcome,
  UserId,
} from '@flowforge/cats-shared'

/** Input for `IInvocationRecordStore.update()` (store-side carrier of branded id). */
export interface StoreUpdateInvocationInput extends Omit<UpdateInvocationInput, 'invocationId'> {
  readonly invocationId: InvocationId
}

/** Result of `IInvocationRecordStore.update()`. */
export type StoreUpdateInvocationOutcome = UpdateInvocationOutcome

/** Result of `IInvocationRecordStore.create()`. */
export type StoreCreateInvocationOutcome = CreateInvocationOutcome

/**
 * Port for the invocation record store.
 *
 * Implementations may be sync (Memory) or async (Sqlite / Redis replacement);
 * callers should `await` every method to remain backend-agnostic.
 */
export interface IInvocationRecordStore {
  /**
   * Atomic create-or-deduplicate. If a record with the same idempotency key
   * (scoped to threadId × userId) exists and its TTL has not expired, returns
   * `{ outcome: 'deduped', invocationId }` pointing at the existing record.
   * Otherwise creates a new record and returns `{ outcome: 'created', invocationId }`.
   */
  create(input: CreateInvocationInput): StoreCreateInvocationOutcome | Promise<StoreCreateInvocationOutcome>

  /** Get a record by its ID. Returns null if missing. */
  get(id: InvocationId): InvocationRecord | null | Promise<InvocationRecord | null>

  /**
   * Apply a state-machine-guarded, CAS-guarded update. Returns the outcome
   * rather than throwing, so callers can branch on `cas_mismatch` /
   * `invalid_transition` without try/catch (matches clowder-ai semantics).
   */
  update(input: StoreUpdateInvocationInput): StoreUpdateInvocationOutcome | Promise<StoreUpdateInvocationOutcome>

  /**
   * Look up an invocation by idempotency key (scoped to thread × user).
   * Returns null if the key has expired or was never recorded.
   */
  getByIdempotencyKey(
    threadId: ThreadId,
    userId: UserId,
    key: string,
  ): InvocationRecord | null | Promise<InvocationRecord | null>

  /**
   * Enumerate running invocations scoped to (threadId, userId). Used by
   * zombie reconciliation: a record is `running` but its drafts are gone.
   */
  listRunningByThread(
    threadId: ThreadId,
    userId: UserId,
  ): readonly InvocationRecord[] | Promise<readonly InvocationRecord[]>

  /**
   * Optional: scan all records (for backfill / diagnostics). Only the Sqlite
   * backend is expected to implement this; the Memory backend returns the
   * bounded in-process slice.
   */
  scanAll?(): Promise<readonly InvocationRecord[]>
}
