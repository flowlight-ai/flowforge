/**
 * SessionMutexService — per-session serialization lock Cordis service.
 *
 * Prevents concurrent `resume` of the same CLI session (F118).
 * Scope: process-level (same lifetime as InvocationTrackerService).
 * Does NOT modify InvocationTrackerService — that guards threadId:catId slots,
 * this guards cliSessionId uniqueness.
 *
 * 对齐 dsh `@flowforge/jobs` 范式：抽象 `SessionMutexService extends Service`
 * 挂载到 `ctx.catsInvocation.mutex`。
 *
 * @module @flowforge/cats-invocation/mutex
 */

import { Context, Service } from '@flowforge/cordis'
import type {
  ForceReleaseOptions,
  ForceReleaseResult,
  SessionLockOwner,
  SessionLockScope,
} from '@flowforge/cats-shared'

/**
 * Abstract per-session serialization lock service.
 *
 * Subclass and implement the abstract methods, then load the subclass as a
 * plugin — it registers as `ctx.catsInvocation.mutex`.
 */
export abstract class SessionMutexService extends Service {
  constructor(ctx: Context) {
    if (new.target === SessionMutexService) {
      throw new Error(
        '@flowforge/cats-invocation/mutex is the abstract session mutex seam; ' +
        'load a concrete implementation (e.g. MemorySessionMutexService) instead',
      )
    }
    super(ctx, 'catsInvocationMutex')
  }

  /**
   * Acquire exclusive access for a session.
   * - No contention → resolves immediately with a release function.
   * - Contention → queues until the current holder releases.
   * - If `signal` is aborted while waiting → rejects with an error.
   *
   * The returned release function is idempotent.
   */
  abstract acquire(sessionIdOrOwner: string | SessionLockOwner, signal?: AbortSignal): Promise<() => void>

  /** Force-release agent-owned locks within an authenticated scope. */
  abstract forceReleaseByScope(scope: SessionLockScope, options?: ForceReleaseOptions): ForceReleaseResult

  /** Check if a session lock is currently held. */
  abstract isHeld(sessionId: string): boolean
}

declare module '@flowforge/cordis' {
  interface Context {
    catsInvocationMutex: SessionMutexService
  }
}

// ---------------------------------------------------------------------------
// Memory implementation
// ---------------------------------------------------------------------------

interface Waiter {
  readonly owner?: SessionLockOwner | undefined
  readonly resolve: () => void
  readonly reject: (reason: unknown) => void
  readonly cleanup: () => void
}

interface HeldLock {
  readonly owner?: SessionLockOwner | undefined
  readonly token: symbol
}

/**
 * In-memory SessionMutexService implementation.
 *
 * Ported from clowder-ai `SessionMutex` — per-session Map of held locks +
 * waiter queues. Force-release by scope preserves holder executionIds.
 */
export class MemorySessionMutexService extends SessionMutexService {
  /** Currently held locks: sessionId → HeldLock */
  private readonly held = new Map<string, HeldLock>()
  /** Waiters queued behind a held lock */
  private readonly waiters = new Map<string, Waiter[]>()

  override async acquire(
    sessionIdOrOwner: string | SessionLockOwner,
    signal?: AbortSignal,
  ): Promise<() => void> {
    const owner = typeof sessionIdOrOwner === 'string' ? undefined : sessionIdOrOwner
    const sessionId = typeof sessionIdOrOwner === 'string' ? sessionIdOrOwner : sessionIdOrOwner.sessionId

    if (signal?.aborted) {
      throw new Error(`SessionMutex acquire aborted for session ${sessionId}`)
    }

    // No contention — acquire immediately
    if (!this.held.has(sessionId)) {
      return this.lock(sessionId, owner)
    }

    // Contention — queue and wait
    return new Promise<() => void>((resolve, reject) => {
      const onAbort = (): void => {
        const queue = this.waiters.get(sessionId)
        if (queue) {
          const idx = queue.indexOf(waiter)
          if (idx !== -1) queue.splice(idx, 1)
          if (queue.length === 0) this.waiters.delete(sessionId)
        }
        reject(new Error(`SessionMutex acquire aborted for session ${sessionId}`))
      }

      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort)
      }

      const waiter: Waiter = {
        owner,
        resolve: () => {
          cleanup()
          resolve(this.lock(sessionId, owner))
        },
        reject,
        cleanup,
      }

      signal?.addEventListener('abort', onAbort, { once: true })

      let queue = this.waiters.get(sessionId)
      if (!queue) {
        queue = []
        this.waiters.set(sessionId, queue)
      }
      queue.push(waiter)
    })
  }

  override forceReleaseByScope(
    scope: SessionLockScope,
    options: ForceReleaseOptions = {},
  ): ForceReleaseResult {
    let releasedHolders = 0
    let rejectedWaiters = 0
    const catIds = new Set<string>()
    const preservedHolderExecutions = new Set(options.preserveHolderExecutionIds ?? [])

    // Reject matching waiters
    for (const [sessionId, queue] of this.waiters) {
      const survivors: Waiter[] = []
      for (const waiter of queue) {
        if (this.matchesScope(waiter.owner, scope)) {
          if (waiter.owner?.catId !== undefined) catIds.add(waiter.owner.catId)
          waiter.cleanup()
          waiter.reject(new Error(`SessionMutex force released for session ${sessionId}`))
          rejectedWaiters++
        } else {
          survivors.push(waiter)
        }
      }
      if (survivors.length > 0) this.waiters.set(sessionId, survivors)
      else this.waiters.delete(sessionId)
    }

    // Release matching holders (snapshot to avoid mutation during iteration)
    for (const [sessionId, held] of [...this.held]) {
      if (!this.matchesScope(held.owner, scope)) continue
      if (held.owner?.executionId !== undefined && preservedHolderExecutions.has(held.owner.executionId)) continue
      if (held.owner?.catId !== undefined) catIds.add(held.owner.catId)
      this.held.delete(sessionId)
      releasedHolders++
      this.drainNext(sessionId)
    }

    return { releasedHolders, rejectedWaiters, catIds: [...catIds] }
  }

  override isHeld(sessionId: string): boolean {
    return this.held.has(sessionId)
  }

  /** Create a lock entry and return an idempotent release function. */
  private lock(sessionId: string, owner?: SessionLockOwner): () => void {
    let released = false
    const token = Symbol(sessionId)
    const release = (): void => {
      if (released) return
      released = true
      if (this.held.get(sessionId)?.token !== token) return
      this.held.delete(sessionId)
      this.drainNext(sessionId)
    }
    this.held.set(sessionId, { owner, token })
    return release
  }

  private matchesScope(owner: SessionLockOwner | undefined, scope: SessionLockScope): boolean {
    return (
      owner !== undefined &&
      owner.threadId === scope.threadId &&
      owner.userId === scope.userId &&
      (scope.catId === undefined || owner.catId === scope.catId)
    )
  }

  /** Wake the next waiter in queue, if any. */
  private drainNext(sessionId: string): void {
    const queue = this.waiters.get(sessionId)
    if (!queue || queue.length === 0) {
      this.waiters.delete(sessionId)
      return
    }
    const next = queue.shift()
    if (!next) {
      this.waiters.delete(sessionId)
      return
    }
    if (queue.length === 0) this.waiters.delete(sessionId)
    next.resolve()
  }
}
