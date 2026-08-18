/**
 * InvocationTrackerService — per-thread × per-cat execution slot tracker Cordis service.
 *
 * The "who is running" half of the invocation model. Complements
 * {@link InvocationQueueService} (the "who is waiting" half).
 *
 * Ported from clowder-ai `InvocationTracker.ts`
 * (api/src/domains/cats/services/agents/invocation/), adapted to:
 * - Extend Cordis `Service` (mounted at `ctx.catsInvocationTracker`)
 * - Use branded types (`ThreadId` / `CatId` / `UserId`) from `@flowforge/cats-shared`
 * - Preserve all F108 / F118 / F-parallel-cancel semantics from clowder-ai
 *
 * Key semantics preserved:
 * - F108: ExecutionSlot(threadId, catId) is the basic concurrency unit.
 *   Same catId in same thread keeps single-lock semantics (new start aborts old).
 *   Different catIds in same thread can run concurrently.
 * - F118 D3: TTL guard — slots exceeding maxSlotTtlMs are auto-cleaned on read.
 * - F-parallel-cancel: Each cat in a startAll batch gets its OWN independent
 *   AbortController. Canceling one cat does NOT abort the batch gate.
 *   Canceled slots become tombstones (retained for pre-invoke cancel semantics).
 *
 * @module @flowforge/cats-invocation/tracker
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, ThreadId, UserId } from '@flowforge/cats-shared'

/** Default slot TTL: 75 minutes (matches clowder-ai DEFAULT_INVOCATION_SLOT_TTL_MS). */
export const DEFAULT_INVOCATION_SLOT_TTL_MS = 75 * 60_000

/** Abort reason used when a slot exceeds its TTL. */
const INVOCATION_SLOT_TTL_ABORT_REASON = 'invocation_slot_ttl_expired'

// ---------------------------------------------------------------------------
// Public types (ported from clowder-ai InvocationTracker.ts)
// ---------------------------------------------------------------------------

/** F-parallel-cancel: observable slot lifecycle state. */
export type SlotState = 'active' | 'canceled' | 'absent'

/** Active slot info for recovery (F5). */
export interface ActiveSlotInfo {
  readonly catId: CatId
  readonly startedAt: number
}

/** Result of canceling a single slot. */
export interface CancelResult {
  readonly cancelled: boolean
  readonly catIds: readonly CatId[]
  /** Exact runner(s) aborted by this action; safe witness for holder preservation. */
  readonly executionIds?: readonly string[]
}

/** Result of canceling all slots in a thread. */
export interface CancelAllResult {
  readonly catIds: readonly CatId[]
  /** Deduplicated InvocationRecord identities aborted by this action. */
  readonly executionIds: readonly string[]
  /** Exact active execution owner for each canceled slot. */
  readonly executionIdByCatId: Readonly<Record<string, string>>
}

/** Delete guard for atomic thread deletion. */
export interface DeleteGuard {
  /** Whether the guard was acquired (no active invocation at acquire time) */
  readonly acquired: boolean
  /** Release the guard after delete completes (success or failure) */
  readonly release: () => void
}

/** Result of comparing a terminal execution with the current slot owner. */
export type ExactExecutionOwnerState = 'released' | 'absent' | 'replacement'

/** Non-destructive projection used to fence async terminal side effects. */
export type ExecutionOwnerMatch = 'matching' | 'absent' | 'replacement'

/** Batch gate status for resolveFinalStatus(). */
export interface BatchGateStatus {
  readonly aborted: boolean
  readonly reason?: string
}

/** Final invocation status resolved from slot states. */
export type FinalInvocationStatus = 'succeeded' | 'canceled' | 'canceled_by_user'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ActiveInvocation {
  readonly controller: AbortController
  /** Parent execution identity for exact terminal ownership / mutex recovery. */
  executionId?: string | undefined
  readonly userId: UserId
  readonly catId: CatId
  /** Cat(s) being invoked — used for cancel feedback broadcast */
  readonly catIds: readonly CatId[]
  /** Server-side wall-clock start time (ms since epoch) */
  readonly startedAt: number
  /** For startAll slots: reference to the INDEPENDENT batch gate controller. */
  batchController?: AbortController | undefined
  /**
   * F-parallel-cancel tombstone: 'active' = running; 'canceled' = single-cat
   * cancelled but the slot is RETAINED so getController() still returns the
   * aborted controller. Purged at the next start/complete family call.
   */
  state: 'active' | 'canceled'
  /** Abort reason recorded at cancel time. */
  cancelReason?: string | undefined
}

// ---------------------------------------------------------------------------
// Abstract service
// ---------------------------------------------------------------------------

/**
 * Abstract per-slot execution tracker service.
 *
 * Subclass and implement the abstract methods, then load the subclass as a
 * plugin — it registers as `ctx.catsInvocationTracker`.
 */
export abstract class InvocationTrackerService extends Service {
  constructor(ctx: Context) {
    if (new.target === InvocationTrackerService) {
      throw new Error(
        '@flowforge/cats-invocation/tracker is the abstract invocation tracker seam; ' +
        'load a concrete implementation (e.g. MemoryInvocationTrackerService) instead',
      )
    }
    super(ctx, 'catsInvocationTracker')
  }

  /** Start a new invocation for a slot. Aborts existing invocation for the SAME slot. */
  abstract start(
    threadId: ThreadId,
    catId: CatId,
    userId?: UserId,
    catIds?: readonly CatId[],
    executionId?: string,
  ): AbortController

  /** Non-preemptive thread-level start. Returns null if thread is busy. */
  abstract tryStartThread(
    threadId: ThreadId,
    catId: CatId,
    userId?: UserId,
    catIds?: readonly CatId[],
    executionId?: string,
  ): AbortController | null

  /** Atomically check-and-guard for thread deletion. */
  abstract guardDelete(threadId: ThreadId): DeleteGuard

  /** Cancel an active invocation for a specific slot. */
  abstract cancel(
    threadId: ThreadId,
    catId: CatId,
    requestUserId?: UserId,
    abortReason?: string,
  ): CancelResult

  /** Cancel ALL active slots for a thread. */
  abstract cancelAll(
    threadId: ThreadId,
    requestUserId?: UserId,
    abortReason?: string,
  ): CancelAllResult

  /** Scoped preempt — cancel only the invocation(s) the given anchor cats belong to. */
  abstract cancelInvocation(
    threadId: ThreadId,
    anchorCats: readonly CatId[],
    requestUserId?: UserId,
    abortReason?: string,
  ): readonly CatId[]

  /** Get the userId who started the invocation for a specific slot. */
  abstract getUserId(threadId: ThreadId, catId: CatId): UserId | null

  /** Exact execution fence for non-interrupting per-target reminder attempts. */
  abstract getExecutionId(threadId: ThreadId, catId: CatId): string | undefined

  /** Get target cat IDs of the active invocation for a specific slot. */
  abstract getCatIds(threadId: ThreadId, catId: CatId): readonly CatId[]

  /** Get the AbortController for a specific slot. */
  abstract getController(threadId: ThreadId, catId: CatId): AbortController | undefined

  /** Observable slot lifecycle state. */
  abstract getSlotState(threadId: ThreadId, catId: CatId): SlotState

  /** Aggregate final status of a (possibly multi-cat) invocation. */
  abstract resolveFinalStatus(
    threadId: ThreadId,
    targetCats: readonly CatId[],
    batch: BatchGateStatus,
  ): FinalInvocationStatus

  /** Mark an invocation as complete (cleanup). Only removes if controller matches. */
  abstract complete(threadId: ThreadId, catId: CatId, controller?: AbortController): void

  /** Classify whether an execution still matches the current slot. */
  abstract classifyExecutionId(
    threadId: ThreadId,
    catId: CatId,
    executionId: string,
  ): ExecutionOwnerMatch

  /** Retire a terminal slot only when the caller still owns its exact execution. */
  abstract completeByExecutionId(
    threadId: ThreadId,
    catId: CatId,
    executionId: string,
  ): ExactExecutionOwnerState

  /** Mark a SINGLE slot from a batch invocation as complete. */
  abstract completeSlot(threadId: ThreadId, catId: CatId, controller?: AbortController): void

  /** Whether a thread/slot has an active invocation. */
  abstract has(threadId: ThreadId, catId?: CatId): boolean

  /** Start tracking ALL target cats for a unified multi-cat dispatch. */
  abstract startAll(
    threadId: ThreadId,
    catIds: readonly CatId[],
    userId?: UserId,
    executionId?: string,
  ): AbortController

  /** Track an additional slot executed by an already-running route. */
  abstract trackExternalSlot(
    threadId: ThreadId,
    catId: CatId,
    controller: AbortController,
    userId?: UserId,
    catIds?: readonly CatId[],
    executionId?: string,
  ): boolean

  /** Non-preemptive thread-level start for ALL target cats. */
  abstract tryStartThreadAll(
    threadId: ThreadId,
    catIds: readonly CatId[],
    userId?: UserId,
    executionId?: string,
  ): AbortController | null

  /** Bind an InvocationRecord created after an atomic tracker reservation. */
  abstract bindExecutionId(
    threadId: ThreadId,
    catIds: readonly CatId[],
    controller: AbortController,
    executionId: string,
  ): void

  /** Complete ALL slots for the given cats. */
  abstract completeAll(
    threadId: ThreadId,
    catIds: readonly CatId[],
    controller?: AbortController,
  ): void

  /** Get all active slot info for a thread. */
  abstract getActiveSlots(threadId: ThreadId): readonly ActiveSlotInfo[]

  /** Whether a thread is currently being deleted (delete guard active). */
  abstract isDeleting(threadId: ThreadId): boolean
}

declare module '@flowforge/cordis' {
  interface Context {
    catsInvocationTracker: InvocationTrackerService
  }
}

// ---------------------------------------------------------------------------
// Memory implementation
// ---------------------------------------------------------------------------

/**
 * In-memory InvocationTrackerService implementation.
 *
 * Ported from clowder-ai `InvocationTracker` — per-slot Map of active
 * invocations + per-thread delete guard set. TTL auto-cleanup on read.
 */
export class MemoryInvocationTrackerService extends InvocationTrackerService {
  /** Key: `${threadId}:${catId}` (slotKey) → ActiveInvocation */
  private readonly active = new Map<string, ActiveInvocation>()
  /** Threads currently being deleted (delete guard) */
  private readonly deleting = new Set<string>()
  /** F118 D3: max age before a slot is considered stale; 0 disables cleanup. */
  private readonly maxSlotTtlMs: number

  constructor(ctx: Context, opts?: { maxSlotTtlMs?: number }) {
    super(ctx)
    this.maxSlotTtlMs = opts?.maxSlotTtlMs ?? DEFAULT_INVOCATION_SLOT_TTL_MS
  }

  private slotKey(threadId: ThreadId, catId: CatId): string {
    return `${threadId}:${catId}`
  }

  /** F118 D3: Check if an invocation has exceeded the TTL. Aborts and removes if expired. */
  private isExpired(key: string, inv: ActiveInvocation): boolean {
    // 0 means manual-cancel-only (CLI_TIMEOUT_MS=0 sentinel).
    if (this.maxSlotTtlMs <= 0) return false
    const ageMs = Date.now() - inv.startedAt
    if (ageMs > this.maxSlotTtlMs) {
      // The slot is the only live path to the provider's AbortSignal.
      // Deleting without aborting leaves the runner alive while upper layers
      // incorrectly admit a replacement invocation.
      inv.controller.abort(INVOCATION_SLOT_TTL_ABORT_REASON)
      // Abort listeners may install a replacement; only retire the exact invocation.
      if (this.active.get(key) === inv) this.active.delete(key)
      return true
    }
    return false
  }

  override start(
    threadId: ThreadId,
    catId: CatId,
    userId: UserId = 'unknown' as UserId,
    catIds: readonly CatId[] = [],
    executionId?: string,
  ): AbortController {
    if (this.deleting.has(threadId)) {
      const controller = new AbortController()
      controller.abort()
      return controller
    }
    const key = this.slotKey(threadId, catId)
    // Abort existing invocation for this SAME slot only
    this.active.get(key)?.controller.abort('preempted')
    const controller = new AbortController()
    this.active.set(key, {
      controller,
      userId,
      catId,
      catIds,
      startedAt: Date.now(),
      state: 'active',
      executionId,
    })
    return controller
  }

  override tryStartThread(
    threadId: ThreadId,
    catId: CatId,
    userId: UserId = 'unknown' as UserId,
    catIds: readonly CatId[] = [],
    executionId?: string,
  ): AbortController | null {
    if (this.deleting.has(threadId)) return null
    if (this.has(threadId)) return null
    const controller = new AbortController()
    const key = this.slotKey(threadId, catId)
    this.active.set(key, {
      controller,
      userId,
      catId,
      catIds,
      startedAt: Date.now(),
      state: 'active',
      executionId,
    })
    return controller
  }

  override guardDelete(threadId: ThreadId): DeleteGuard {
    if (this.deleting.has(threadId)) {
      return { acquired: false, release: (): void => {} }
    }
    if (this.has(threadId)) {
      return { acquired: false, release: (): void => {} }
    }
    this.deleting.add(threadId)
    return {
      acquired: true,
      release: (): void => {
        this.deleting.delete(threadId)
      },
    }
  }

  override cancel(
    threadId: ThreadId,
    catId: CatId,
    requestUserId?: UserId,
    abortReason?: string,
  ): CancelResult {
    const key = this.slotKey(threadId, catId)
    const inv = this.active.get(key)
    if (!inv) return { cancelled: false, catIds: [], executionIds: [] }
    if (requestUserId && inv.userId !== requestUserId) {
      return { cancelled: false, catIds: [], executionIds: [] }
    }
    const { catIds } = inv
    inv.controller.abort(abortReason)
    // F-parallel-cancel: tombstone — do NOT delete the slot. Keep it as a
    // 'canceled' tombstone so getController() still returns the aborted
    // controller for a cat cancelled BEFORE the route layer grabbed its signal.
    // Purged at the next start/complete family call for this slot.
    inv.state = 'canceled'
    inv.cancelReason = abortReason
    return {
      cancelled: true,
      catIds,
      executionIds: inv.executionId ? [inv.executionId] : [],
    }
  }

  override cancelAll(
    threadId: ThreadId,
    requestUserId?: UserId,
    abortReason?: string,
  ): CancelAllResult {
    const prefix = `${threadId}:`
    const cancelledCatIds: CatId[] = []
    const cancelledExecutionIds = new Set<string>()
    const cancelledExecutionIdByCatId = new Map<string, string>()
    // F-parallel-cancel: collect batch controllers of the slots we cancel.
    const batchControllers = new Set<AbortController>()
    for (const [key, inv] of this.active) {
      if (key.startsWith(prefix)) {
        if (requestUserId && inv.userId !== requestUserId) continue
        cancelledCatIds.push(inv.catId)
        if (inv.executionId) {
          cancelledExecutionIds.add(inv.executionId)
          cancelledExecutionIdByCatId.set(inv.catId as string, inv.executionId)
        }
        inv.controller.abort(abortReason)
        if (inv.batchController) batchControllers.add(inv.batchController)
        this.active.delete(key)
      }
    }
    for (const bc of batchControllers) bc.abort(abortReason)
    return {
      catIds: cancelledCatIds,
      executionIds: [...cancelledExecutionIds],
      executionIdByCatId: Object.fromEntries(cancelledExecutionIdByCatId),
    }
  }

  override cancelInvocation(
    threadId: ThreadId,
    anchorCats: readonly CatId[],
    requestUserId?: UserId,
    abortReason?: string,
  ): readonly CatId[] {
    const prefix = `${threadId}:`
    const anchorSet = new Set(anchorCats)
    // 1. Resolve the batch gate(s) the anchor cats belong to.
    const targetBatches = new Set<AbortController>()
    for (const catId of anchorCats) {
      const inv = this.active.get(this.slotKey(threadId, catId))
      if (!inv) continue
      if (requestUserId && inv.userId !== requestUserId) continue
      if (inv.batchController) targetBatches.add(inv.batchController)
    }
    // 2. Cancel the anchors + any slot sharing a target batch gate.
    const cancelledCatIds: CatId[] = []
    for (const [key, inv] of this.active) {
      if (!key.startsWith(prefix)) continue
      if (requestUserId && inv.userId !== requestUserId) continue
      const isAnchor = anchorSet.has(inv.catId)
      const sharesBatch =
        inv.batchController !== undefined && targetBatches.has(inv.batchController)
      if (!isAnchor && !sharesBatch) continue
      cancelledCatIds.push(inv.catId)
      inv.controller.abort(abortReason)
      this.active.delete(key)
    }
    for (const bc of targetBatches) bc.abort(abortReason)
    return cancelledCatIds
  }

  override getUserId(threadId: ThreadId, catId: CatId): UserId | null {
    const key = this.slotKey(threadId, catId)
    return this.active.get(key)?.userId ?? null
  }

  override getExecutionId(threadId: ThreadId, catId: CatId): string | undefined {
    const key = this.slotKey(threadId, catId)
    const inv = this.active.get(key)
    if (!inv || this.isExpired(key, inv) || inv.state !== 'active') return undefined
    return inv.executionId
  }

  override getCatIds(threadId: ThreadId, catId: CatId): readonly CatId[] {
    const key = this.slotKey(threadId, catId)
    return this.active.get(key)?.catIds ?? []
  }

  override getController(threadId: ThreadId, catId: CatId): AbortController | undefined {
    const key = this.slotKey(threadId, catId)
    const inv = this.active.get(key)
    if (!inv) return undefined
    if (this.isExpired(key, inv)) return undefined
    // NOTE: a 'canceled' tombstone intentionally still returns its (now aborted)
    // controller — that is the whole point of the tombstone (pre-invoke cancel).
    return inv.controller
  }

  override getSlotState(threadId: ThreadId, catId: CatId): SlotState {
    const key = this.slotKey(threadId, catId)
    const inv = this.active.get(key)
    if (!inv) return 'absent'
    if (this.isExpired(key, inv)) return 'absent'
    return inv.state
  }

  override resolveFinalStatus(
    threadId: ThreadId,
    targetCats: readonly CatId[],
    batch: BatchGateStatus,
  ): FinalInvocationStatus {
    if (batch.aborted) {
      return batch.reason === 'user_cancel' || batch.reason === 'cancel_all'
        ? 'canceled_by_user'
        : 'canceled'
    }
    if (targetCats.length === 0) return 'succeeded'
    const allCanceled = targetCats.every((c) => this.getSlotState(threadId, c) === 'canceled')
    return allCanceled ? 'canceled_by_user' : 'succeeded'
  }

  override complete(threadId: ThreadId, catId: CatId, controller?: AbortController): void {
    const key = this.slotKey(threadId, catId)
    const inv = this.active.get(key)
    if (!inv) return
    if (controller && inv.controller !== controller) return
    // F-parallel-cancel: keep a CANCELED tombstone so aggregate resolveFinalStatus()
    // still sees this cat was cancelled. Canceled tombstones are purged on the
    // next start/tryStart for the slot (re-occupation).
    if (inv.state === 'canceled') return
    this.active.delete(key)
  }

  override classifyExecutionId(
    threadId: ThreadId,
    catId: CatId,
    executionId: string,
  ): ExecutionOwnerMatch {
    const inv = this.active.get(this.slotKey(threadId, catId))
    if (!inv) return 'absent'
    return inv.executionId === executionId ? 'matching' : 'replacement'
  }

  override completeByExecutionId(
    threadId: ThreadId,
    catId: CatId,
    executionId: string,
  ): ExactExecutionOwnerState {
    const key = this.slotKey(threadId, catId)
    const ownerMatch = this.classifyExecutionId(threadId, catId, executionId)
    if (ownerMatch === 'absent') return 'absent'
    if (ownerMatch === 'replacement') return 'replacement'
    this.active.delete(key)
    return 'released'
  }

  override completeSlot(threadId: ThreadId, catId: CatId, controller?: AbortController): void {
    const key = this.slotKey(threadId, catId)
    const inv = this.active.get(key)
    if (!inv) return
    if (controller && inv.controller !== controller && inv.batchController !== controller) return
    // F-parallel-cancel: keep CANCELED tombstone (see complete())
    if (inv.state === 'canceled') return
    this.active.delete(key)
  }

  override has(threadId: ThreadId, catId?: CatId): boolean {
    if (catId) {
      const key = this.slotKey(threadId, catId)
      const inv = this.active.get(key)
      if (!inv) return false
      // F-parallel-cancel: a canceled tombstone is INACTIVE.
      if (inv.state === 'canceled') return false
      return !this.isExpired(key, inv)
    }
    // Thread-level: check if ANY non-expired, non-canceled slot is active
    const prefix = `${threadId}:`
    for (const [key, inv] of this.active) {
      if (key.startsWith(prefix) && inv.state !== 'canceled' && !this.isExpired(key, inv)) {
        return true
      }
    }
    return false
  }

  override startAll(
    threadId: ThreadId,
    catIds: readonly CatId[],
    userId: UserId = 'unknown' as UserId,
    executionId?: string,
  ): AbortController {
    if (this.deleting.has(threadId)) {
      const controller = new AbortController()
      controller.abort()
      return controller
    }
    const now = Date.now()
    // F-parallel-cancel: batchController is the "whole-invocation gate" —
    // INDEPENDENT from any per-cat controller. Canceling one cat aborts only
    // that cat's own controller, NOT this batch controller.
    const batchController = new AbortController()
    for (const catId of catIds) {
      const key = this.slotKey(threadId, catId)
      this.active.get(key)?.controller.abort('preempted')
      const controller = new AbortController()
      this.active.set(key, {
        controller,
        userId,
        catId,
        catIds,
        startedAt: now,
        batchController,
        state: 'active',
        executionId,
      })
    }
    return batchController
  }

  override trackExternalSlot(
    threadId: ThreadId,
    catId: CatId,
    controller: AbortController,
    userId: UserId = 'unknown' as UserId,
    catIds: readonly CatId[] = [catId],
    executionId?: string,
  ): boolean {
    if (this.deleting.has(threadId)) return false
    const key = this.slotKey(threadId, catId)
    const existing = this.active.get(key)
    // A2A re-track must REPLACE a 'canceled' tombstone, not keep it.
    // Tombstones are purged by start/complete-family calls; trackExternalSlot
    // is the A2A re-occupation path and must do the same.
    if (existing && !this.isExpired(key, existing) && existing.state !== 'canceled') {
      // Idempotent if this slot already tracks the same batch.
      return existing.batchController === controller || existing.controller === controller
    }
    // F-parallel-cancel: the passed `controller` is route-serial's BATCH GATE.
    // Give the A2A slot its OWN controller so single-cat cancel stops only it;
    // keep the batch gate as batchController so cancelAll still cascades.
    this.active.set(key, {
      controller: new AbortController(),
      userId,
      catId,
      catIds,
      startedAt: Date.now(),
      batchController: controller,
      state: 'active',
      executionId,
    })
    return true
  }

  override tryStartThreadAll(
    threadId: ThreadId,
    catIds: readonly CatId[],
    userId: UserId = 'unknown' as UserId,
    executionId?: string,
  ): AbortController | null {
    if (this.deleting.has(threadId)) return null
    if (this.has(threadId)) return null
    const now = Date.now()
    // F-parallel-cancel: independent batch gate
    const batchController = new AbortController()
    for (const catId of catIds) {
      const key = this.slotKey(threadId, catId)
      const controller = new AbortController()
      this.active.set(key, {
        controller,
        userId,
        catId,
        catIds,
        startedAt: now,
        batchController,
        state: 'active',
        executionId,
      })
    }
    return batchController
  }

  override bindExecutionId(
    threadId: ThreadId,
    catIds: readonly CatId[],
    controller: AbortController,
    executionId: string,
  ): void {
    for (const catId of catIds) {
      const inv = this.active.get(this.slotKey(threadId, catId))
      if (!inv) continue
      if (inv.controller !== controller && inv.batchController !== controller) continue
      inv.executionId = executionId
    }
  }

  override completeAll(
    threadId: ThreadId,
    catIds: readonly CatId[],
    controller?: AbortController,
  ): void {
    for (const catId of catIds) {
      const key = this.slotKey(threadId, catId)
      const inv = this.active.get(key)
      if (!inv) continue
      if (controller) {
        if (inv.controller !== controller && inv.batchController !== controller) continue
      }
      // F-parallel-cancel: keep CANCELED tombstones (see complete())
      if (inv.state === 'canceled') continue
      this.active.delete(key)
    }
  }

  override getActiveSlots(threadId: ThreadId): readonly ActiveSlotInfo[] {
    const prefix = `${threadId}:`
    const result: ActiveSlotInfo[] = []
    for (const [key, inv] of this.active) {
      // F-parallel-cancel: a canceled tombstone is not an active slot.
      if (key.startsWith(prefix) && inv.state !== 'canceled' && !this.isExpired(key, inv)) {
        result.push({ catId: inv.catId, startedAt: inv.startedAt })
      }
    }
    return result
  }

  override isDeleting(threadId: ThreadId): boolean {
    return this.deleting.has(threadId)
  }
}
