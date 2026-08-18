/**
 * InvocationQueueService — per-thread × per-user FIFO queue Cordis service.
 *
 * The "who is waiting" half of the invocation model. Complements
 * {@link InvocationTrackerService} (the "who is running" half).
 *
 * 对齐 dsh `@flowforge/jobs` 范式：抽象 `InvocationQueueService extends Service`
 * 挂载到 `ctx.catsInvocation.queue`，具体实现（Memory / Redis）继承本类。
 *
 * @module @flowforge/cats-invocation/queue
 */

import { Context, Service } from '@flowforge/cordis'
import {
  MAX_QUEUE_DEPTH,
  generateQueueEntryId,
  type CatId,
  type EnqueueResult,
  type InvocationSource,
  type InvocationSourceCategory,
  type MessageId,
  type QueueEntry,
  type QueueEntryId,
  type ThreadId,
  type UserId,
} from '@flowforge/cats-shared'
import type { InvocationId } from '@flowforge/cats-shared'

/** Input for `InvocationQueueService.enqueue()`. */
export interface EnqueueInput {
  readonly threadId: ThreadId
  readonly userId: UserId
  readonly targetCatIds: readonly CatId[]
  readonly source: InvocationSource
  readonly sourceCategory?: InvocationSourceCategory | undefined
  readonly userMessageId?: MessageId | undefined
  readonly mergedMessageIds?: readonly MessageId[] | undefined
  readonly idempotencyKey?: string | undefined
  readonly parentInvocationId?: InvocationId | undefined
  readonly callerCatId?: CatId | undefined
  readonly continuationKey?: string | undefined
  readonly freshnessClosureId?: string | undefined
  readonly freshnessSupplementId?: string | undefined
  readonly suggestedSkill?: string | undefined
}

/**
 * Abstract per-thread × per-user FIFO queue service.
 *
 * Subclass and implement the abstract methods, then load the subclass as a
 * plugin — it registers as `ctx.catsInvocation.queue`.
 */
export abstract class InvocationQueueService extends Service {
  constructor(ctx: Context) {
    if (new.target === InvocationQueueService) {
      throw new Error(
        '@flowforge/cats-invocation/queue is the abstract invocation queue seam; ' +
        'load a concrete implementation (e.g. MemoryInvocationQueueService) instead',
      )
    }
    super(ctx, 'catsInvocationQueue')
  }

  /** Enqueue a new entry or dedupe by idempotency key. */
  abstract enqueue(input: EnqueueInput): EnqueueResult

  /** Dequeue the next entry for a (threadId, userId) scope. */
  abstract dequeue(threadId: ThreadId, userId: UserId): QueueEntry | undefined

  /** Peek at all queued entries for a scope without removing. */
  abstract peek(threadId: ThreadId, userId: UserId): readonly QueueEntry[]

  /** Number of queued entries for a scope. */
  abstract size(threadId: ThreadId, userId: UserId): number

  /** Remove a specific entry by id. Returns true if removed. */
  abstract remove(entryId: QueueEntryId): boolean

  /** Mark an entry as processing. Returns true if transition succeeded. */
  abstract markProcessing(entryId: QueueEntryId): boolean

  /** Mark an entry as processed (terminal). Returns true if transition succeeded. */
  abstract markProcessed(entryId: QueueEntryId): boolean
}

declare module '@flowforge/cordis' {
  interface Context {
    catsInvocationQueue: InvocationQueueService
  }
}

// ---------------------------------------------------------------------------
// Memory implementation
// ---------------------------------------------------------------------------

/**
 * In-memory InvocationQueueService implementation.
 *
 * Keeps per-scope FIFO queues in Maps. Idempotency dedupe is per active entry.
 * Capacity is enforced per `MAX_QUEUE_DEPTH` for user-source entries.
 */
export class MemoryInvocationQueueService extends InvocationQueueService {
  /** scopeKey → entries (FIFO order) */
  private readonly queues = new Map<string, QueueEntry[]>()
  /** entryId → scopeKey (reverse index for O(1) remove/markProcessing/markProcessed) */
  private readonly entryIndex = new Map<QueueEntryId, string>()

  private scopeKey(threadId: ThreadId, userId: UserId): string {
    return `${threadId}:${userId}`
  }

  override enqueue(input: EnqueueInput): EnqueueResult {
    const key = this.scopeKey(input.threadId, input.userId)
    let queue = this.queues.get(key)
    if (!queue) {
      queue = []
      this.queues.set(key, queue)
    }

    // Idempotency dedupe: return existing active entry if same key
    if (input.idempotencyKey) {
      const existing = queue.find(
        (e) => e.idempotencyKey === input.idempotencyKey && e.processedAt === undefined,
      )
      if (existing) {
        return { outcome: 'deduped', dedupedEntryId: existing.id }
      }
    }

    // Capacity check — only user messages are depth-limited
    if (input.source === 'user') {
      const userQueuedCount = queue.filter((e) => e.processedAt === undefined && e.source === 'user').length
      if (userQueuedCount >= MAX_QUEUE_DEPTH) {
        return { outcome: 'full' }
      }
    }

    const entry: QueueEntry = {
      id: generateQueueEntryId(),
      threadId: input.threadId,
      userId: input.userId,
      targetCatIds: [...input.targetCatIds],
      source: input.source,
      ...(input.sourceCategory !== undefined ? { sourceCategory: input.sourceCategory } : {}),
      ...(input.userMessageId !== undefined ? { userMessageId: input.userMessageId } : {}),
      ...(input.mergedMessageIds !== undefined ? { mergedMessageIds: [...input.mergedMessageIds] } : {}),
      ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.parentInvocationId !== undefined ? { parentInvocationId: input.parentInvocationId } : {}),
      ...(input.callerCatId !== undefined ? { callerCatId: input.callerCatId } : {}),
      ...(input.continuationKey !== undefined ? { continuationKey: input.continuationKey } : {}),
      ...(input.freshnessClosureId !== undefined ? { freshnessClosureId: input.freshnessClosureId } : {}),
      ...(input.freshnessSupplementId !== undefined ? { freshnessSupplementId: input.freshnessSupplementId } : {}),
      ...(input.suggestedSkill !== undefined ? { suggestedSkill: input.suggestedSkill } : {}),
      position: queue.length,
      enqueuedAt: Date.now(),
    }

    queue.push(entry)
    this.entryIndex.set(entry.id, key)
    return { outcome: 'created', entry }
  }

  override dequeue(threadId: ThreadId, userId: UserId): QueueEntry | undefined {
    const key = this.scopeKey(threadId, userId)
    const queue = this.queues.get(key)
    if (!queue) return undefined
    const entry = queue.find((e) => e.processedAt === undefined && e.processingStartedAt === undefined)
    if (!entry) return undefined
    // Mark as processing
    ;(entry as unknown as Record<string, unknown>).processingStartedAt = Date.now()
    return entry
  }

  override peek(threadId: ThreadId, userId: UserId): readonly QueueEntry[] {
    const key = this.scopeKey(threadId, userId)
    const queue = this.queues.get(key)
    if (!queue) return []
    return queue.filter((e) => e.processedAt === undefined)
  }

  override size(threadId: ThreadId, userId: UserId): number {
    const key = this.scopeKey(threadId, userId)
    const queue = this.queues.get(key)
    if (!queue) return 0
    return queue.filter((e) => e.processedAt === undefined).length
  }

  override remove(entryId: QueueEntryId): boolean {
    const key = this.entryIndex.get(entryId)
    if (!key) return false
    const queue = this.queues.get(key)
    if (!queue) return false
    const idx = queue.findIndex((e) => e.id === entryId)
    if (idx === -1) return false
    queue.splice(idx, 1)
    this.entryIndex.delete(entryId)
    // Reindex positions
    for (let i = 0; i < queue.length; i++) {
      ;(queue[i]! as unknown as Record<string, unknown>).position = i
    }
    if (queue.length === 0) this.queues.delete(key)
    return true
  }

  override markProcessing(entryId: QueueEntryId): boolean {
    const key = this.entryIndex.get(entryId)
    if (!key) return false
    const queue = this.queues.get(key)
    if (!queue) return false
    const entry = queue.find((e) => e.id === entryId)
    if (!entry || entry.processingStartedAt !== undefined || entry.processedAt !== undefined) return false
    ;(entry as unknown as Record<string, unknown>).processingStartedAt = Date.now()
    return true
  }

  override markProcessed(entryId: QueueEntryId): boolean {
    const key = this.entryIndex.get(entryId)
    if (!key) return false
    const queue = this.queues.get(key)
    if (!queue) return false
    const entry = queue.find((e) => e.id === entryId)
    if (!entry || entry.processedAt !== undefined) return false
    ;(entry as unknown as Record<string, unknown>).processedAt = Date.now()
    return true
  }
}
