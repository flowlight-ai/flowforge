/**
 * ProfileApprovalService — the profile-update approve/reject critical section.
 *
 * Ported from clowder-ai `approveProfileUpdate.ts`
 * (api/src/domains/cats/services/profile/), extracted as a Cordis `Service`
 * so the hard parts — per-target lock serialization, the P1-1 crash-recovery
 * commit pipeline, and the P1-2 optimistic-lock state machine — keep their
 * review-proven semantics while gaining Cordis lifecycle management
 * (`ctx.effect` tears the in-flight lock table down with the fiber).
 *
 * Critical section (ALL under a per-target lock keyed on targetPath, released
 * in `finally` — INV-9):
 *   acquire lock(targetPath)
 *     → re-read proposal (state may have drifted while we waited for the lock)
 *     → if pending: claimForApproval (CAS pending→approving — INV-3)
 *     → commit pipeline (idempotent; skips already-checkpointed steps — P1-1):
 *         !writtenPath    → writeProfilePrimer (re-reads hash, throws on mismatch —
 *                           INV-8) → checkpoint
 *         !provenancePath → writeProfileProvenance (deterministic path — INV-7) →
 *                           checkpoint
 *         → finalizeApproval (CAS approving→approved)
 *   release()  (finally)
 *
 * Error split:
 *   - primer write fails (nothing committed yet) → rollbackClaim → pending
 *     (ADV-3 / INV-8 stale)
 *   - provenance write fails (primer already written + checkpointed) → STAY
 *     `approving` so a later approve resumes via recovery; do NOT roll back
 *     (would orphan the already-changed primer).
 *
 * Lock scope: process-level (same as clowder-ai SessionMutex / F118). AC-C1
 * runs a single API process; a multi-process deployment would need a
 * distributed lock (out of AC-C1 scope). The lock table is internal to this
 * service — keys are absolute primer paths, which cannot collide with
 * session IDs on any shared mutex.
 *
 * @module @flowforge/cats-profile/approval
 */

import { Context, Service } from '@flowforge/cordis'
import type { ProfileUpdateProposal } from '@flowforge/cats-shared'
import type { IProfileUpdateProposalStore } from '@flowforge/cats-stores'
import type { ProfileRepositoryService } from './repository.ts'
import {
  StaleProfileUpdateError,
  writeProfilePrimer as defaultWritePrimer,
  writeProfileProvenance as defaultWriteProvenance,
  type WritableProfileUpdate,
  type WriteProfilePrimerOptions,
} from './write-profile-update.ts'

export type ApproveFailureReason = 'not_found' | 'rejected' | 'claim_lost' | 'stale_hash' | 'write_failed'

export type ApproveProfileUpdateResult =
  | { ok: true; proposal: ProfileUpdateProposal; recovered: boolean }
  | { ok: false; reason: ApproveFailureReason; error?: string; proposal?: ProfileUpdateProposal }

export type RejectProfileUpdateResult =
  | { ok: true; proposal: ProfileUpdateProposal }
  | { ok: false; reason: 'not_found' | 'not_pending'; proposal?: ProfileUpdateProposal }

/** Injectable writer seams (protected methods by default; tests may subclass). */
export type WritePrimerFn = (
  proposal: WritableProfileUpdate,
  profileDir: string,
  relationshipKey: string,
  options?: WriteProfilePrimerOptions,
) => { writtenPath: string }

export type WriteProvenanceFn = (proposal: WritableProfileUpdate, profileDir: string) => { provenancePath: string }

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) profile-update approval pipeline — mounted by
     * `@flowforge/cats-profile`. Owns the approve critical section
     * (per-target lock + P1-1 checkpoint pipeline + P1-2 optimistic lock)
     * and the one-shot reject edge.
     */
    catsProfileApproval: ProfileApprovalService
  }
}

/** A queued waiter behind a held per-target lock. */
interface LockWaiter {
  resolve: (release: () => void) => void
  reject: (reason: unknown) => void
  cleanup: () => void
}

/** A held per-target lock entry. */
interface HeldTargetLock {
  token: symbol
}

/**
 * Cordis service exposing the profile-update approve/reject pipeline at
 * `ctx.catsProfileApproval`.
 *
 * Dependencies are resolved through the context:
 * - store: `ctx.catStores.profileUpdateProposals()`
 * - repository: `ctx.catsProfile`
 *
 * The internal lock table is registered under `ctx.effect()` so disposing the
 * owning fiber rejects queued waiters and drops held entries (defensive —
 * the approve pipeline always releases in `finally`).
 */
export class ProfileApprovalService extends Service {
  static inject = ['catStores', 'catsProfile']

  private readonly held = new Map<string, HeldTargetLock>()
  private readonly waiters = new Map<string, LockWaiter[]>()
  private readonly writePrimer: WritePrimerFn
  private readonly writeProvenance: WriteProvenanceFn

  constructor(
    ctx: Context,
    options: { writePrimer?: WritePrimerFn; writeProvenance?: WriteProvenanceFn } = {},
  ) {
    super(ctx, 'catsProfileApproval')
    this.writePrimer = options.writePrimer ?? defaultWritePrimer
    this.writeProvenance = options.writeProvenance ?? defaultWriteProvenance

    // Lifecycle: on fiber dispose, fail any queued waiters and clear the
    // lock table so a restarted plugin cannot inherit phantom locks.
    ctx.effect(() => {
      return () => {
        for (const [key, queue] of [...this.waiters]) {
          for (const waiter of queue) {
            waiter.cleanup()
            waiter.reject(new Error(`profile-approval lock "${key}" torn down with the owning fiber`))
          }
          this.waiters.delete(key)
        }
        this.held.clear()
      }
    }, 'catsProfileApproval.locks')
  }

  /** The proposal store backing the approval state machine. */
  protected get store(): IProfileUpdateProposalStore {
    return this.ctx.catStores.profileUpdateProposals()
  }

  /** The profile repository owning scope + primer-path resolution. */
  protected get repository(): ProfileRepositoryService {
    return this.ctx.catsProfile
  }

  /**
   * Approve (or crash-recover) a profile-update proposal.
   *
   * The full pipeline runs under a per-target lock keyed on the resolved
   * primer path; every step is idempotent so a retry after a partial commit
   * resumes from the last checkpoint instead of redoing file side-effects.
   */
  async approve(proposalId: string, approvedBy: string, signal?: AbortSignal): Promise<ApproveProfileUpdateResult> {
    const store = this.store
    const repository = this.repository

    // Peek to resolve the lock key (targetPath) and fast-fail terminal states
    // before contending.
    const peek = await store.get(proposalId)
    if (!peek) return { ok: false, reason: 'not_found' }
    if (peek.status === 'approved') return { ok: true, proposal: peek, recovered: false }
    if (peek.status === 'rejected') return { ok: false, reason: 'rejected', proposal: peek }

    let scope
    let lockKey: string
    try {
      scope = repository.scopeForPinnedPrimerTarget(peek.createdBy, peek.sourceCatId as string, peek.targetPath)
      lockKey = repository.resolvePrimerTarget(scope, peek.targetPath)
    } catch (err) {
      return { ok: false, reason: 'write_failed', error: errMessage(err), proposal: peek }
    }
    const profileDir = repository.profileDir(scope.userId)
    const release = await this.acquire(lockKey, signal)
    try {
      // Re-read inside the lock — another holder may have settled it while
      // we waited.
      let proposal = await store.get(proposalId)
      if (!proposal) return { ok: false, reason: 'not_found' }
      if (proposal.status === 'approved') return { ok: true, proposal, recovered: false }
      if (proposal.status === 'rejected') return { ok: false, reason: 'rejected', proposal }

      // Normal path: pending → approving (CAS). If already `approving`, it's
      // crash recovery — resume from checkpoints without re-claiming.
      let recovered = false
      if (proposal.status === 'pending') {
        const claimed = await store.claimForApproval(proposalId, approvedBy)
        if (!claimed) return { ok: false, reason: 'claim_lost' }
        proposal = claimed
      } else {
        recovered = true // status === 'approving' → resuming a prior partial commit
      }

      // ── Commit pipeline (idempotent; skips already-checkpointed steps — P1-1) ──
      if (!proposal.writtenPath) {
        let writtenPath: string
        try {
          ({ writtenPath } = this.writePrimer(proposal, profileDir, scope.relationshipKey, {
            allowAlreadyApplied: recovered,
          }))
        } catch (err) {
          // Primer not committed → safe to roll back to pending (ADV-3 / INV-8 stale).
          await store.rollbackClaim(proposalId)
          if (err instanceof StaleProfileUpdateError) {
            return { ok: false, reason: 'stale_hash', error: err.message }
          }
          return { ok: false, reason: 'write_failed', error: errMessage(err) }
        }
        try {
          proposal = (await store.recordCheckpoint(proposalId, { writtenPath })) ?? { ...proposal, writtenPath }
        } catch (err) {
          // Primer is already committed on disk. Return the committed path so
          // the caller can clear L0 cache, and leave the store in `approving`
          // for exact-content recovery on retry.
          return { ok: false, reason: 'write_failed', error: errMessage(err), proposal: { ...proposal, writtenPath } }
        }
      }

      if (!proposal.provenancePath) {
        let provenancePath: string
        try {
          ({ provenancePath } = this.writeProvenance(proposal, profileDir))
        } catch (err) {
          // Primer already written + checkpointed. Do NOT roll back (would
          // orphan the changed primer); stay `approving` so a later approve
          // resumes provenance via recovery.
          return { ok: false, reason: 'write_failed', error: errMessage(err), proposal }
        }
        try {
          proposal =
            (await store.recordCheckpoint(proposalId, { provenancePath })) ?? { ...proposal, provenancePath }
        } catch (err) {
          return { ok: false, reason: 'write_failed', error: errMessage(err), proposal: { ...proposal, provenancePath } }
        }
      }

      let finalized: ProfileUpdateProposal | null
      try {
        finalized = await store.finalizeApproval(proposalId)
      } catch (err) {
        return { ok: false, reason: 'write_failed', error: errMessage(err), proposal }
      }
      if (!finalized) return { ok: false, reason: 'claim_lost', proposal }
      return { ok: true, proposal: finalized, recovered }
    } finally {
      release()
    }
  }

  /**
   * Reject a pending proposal (one-shot pending → rejected).
   * Proposals already claimed (`approving`) cannot be rejected — the approve
   * critical section owns them until finalize or rollback.
   */
  async reject(proposalId: string, rejectedBy: string, rejectionReason?: string): Promise<RejectProfileUpdateResult> {
    const store = this.store
    const peek = await store.get(proposalId)
    if (!peek) return { ok: false, reason: 'not_found' }
    if (peek.status !== 'pending') return { ok: false, reason: 'not_pending', proposal: peek }
    const rejected = await store.markRejected(proposalId, rejectedBy, rejectionReason)
    if (!rejected) return { ok: false, reason: 'not_pending', proposal: peek }
    return { ok: true, proposal: rejected }
  }

  /**
   * Acquire the per-target lock. No contention → immediate; contention →
   * FIFO queue; abort while waiting → reject. The returned release is
   * idempotent.
   */
  private acquire(lockKey: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new Error(`profile-approval lock acquire aborted for ${lockKey}`))
    }
    if (!this.held.has(lockKey)) {
      return Promise.resolve(this.lock(lockKey))
    }
    return new Promise<() => void>((resolve, reject) => {
      const onAbort = (): void => {
        const queue = this.waiters.get(lockKey)
        if (queue) {
          const idx = queue.indexOf(waiter)
          if (idx !== -1) queue.splice(idx, 1)
          if (queue.length === 0) this.waiters.delete(lockKey)
        }
        reject(new Error(`profile-approval lock acquire aborted for ${lockKey}`))
      }
      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort)
      }
      const waiter: LockWaiter = {
        resolve: (release) => {
          cleanup()
          resolve(release)
        },
        reject,
        cleanup,
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      let queue = this.waiters.get(lockKey)
      if (!queue) {
        queue = []
        this.waiters.set(lockKey, queue)
      }
      queue.push(waiter)
    })
  }

  /** Create a lock entry and return an idempotent release function. */
  private lock(lockKey: string): () => void {
    let released = false
    const token = Symbol(lockKey)
    const release = (): void => {
      if (released) return
      released = true
      if (this.held.get(lockKey)?.token !== token) return
      this.held.delete(lockKey)
      this.drainNext(lockKey)
    }
    this.held.set(lockKey, { token })
    return release
  }

  /** Wake the next waiter in queue, if any. */
  private drainNext(lockKey: string): void {
    const queue = this.waiters.get(lockKey)
    if (!queue || queue.length === 0) {
      this.waiters.delete(lockKey)
      return
    }
    const next = queue.shift()
    if (!next) {
      this.waiters.delete(lockKey)
      return
    }
    if (queue.length === 0) this.waiters.delete(lockKey)
    next.resolve(this.lock(lockKey))
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
