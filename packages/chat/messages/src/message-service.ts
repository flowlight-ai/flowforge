/**
 * MessageService — 消息域 Cordis 服务（阶段5 批次2，ctx.chatMessages）。
 *
 * 移植自 clowder-ai `routes/messages.ts`（R13 一切皆插件改造）：Fastify 路由
 * 内联业务提取为服务层——
 * - publish（#21/Phase D 线程存在性守卫；首消息自动标题；#579 删除中守卫；
 *   #699 replyTo 引用合法性 + whisper 泄露防护；幂等 idempotencyKey 去重；
 *   F39 投递模式路由 immediate/queue/force）
 * - history（"ts:id" 复合游标分页 + 循环扫描过滤内部消息 + hasMore 探测）
 * - get / getByThread / getByThreadAfter / markDelivered / markCanceled /
 *   revealWhispers 读与投递生命周期透传
 * 存储经 `ctx.catStores.messages()/threads()` 解析（static inject=['catStores']）。
 * 实时广播（thread:message 等）经 options 钩子注入，批次3 realtime 接线。
 *
 * @module @flowforge/chat-messages/service
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@flowforge/cordis'
import type { CatId, MessageContent, UserId } from '@flowforge/cats-shared'
import type { MarkCanceledResult, MarkDeliveredResult, StoredMessage } from '@flowforge/cats-stores'
import { AUTO_TITLE_MAX_LENGTH, DEFAULT_THREAD_ID, MessageErrorCode, UNTITLED_THREAD_TITLES } from './invariant.ts'
import type { MessageWorkDisposition } from './disposition.ts'

/** Business error with a stable machine-readable code (mirrors clowder-ai route codes). */
export class ChatMessagesError extends Error {
  readonly code: (typeof MessageErrorCode)[keyof typeof MessageErrorCode]
  /** Structured context for the route layer (e.g. QUEUE_FULL → queueSize). */
  readonly detail?: Record<string, unknown> | undefined

  constructor(
    code: (typeof MessageErrorCode)[keyof typeof MessageErrorCode],
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ChatMessagesError'
    this.code = code
    this.detail = detail
  }
}

/** Input for publishing a user message (POST /api/messages body semantics). */
export interface PublishMessageInput {
  readonly userId: UserId
  readonly content: string
  /** Defaults to the `default` lobby thread. */
  readonly threadId?: string
  readonly contentBlocks?: readonly MessageContent[]
  /** @mentioned cats — routed targets for the invocation layer. */
  readonly mentions?: readonly CatId[]
  /** Client idempotency key; server generates one when absent. */
  readonly idempotencyKey?: string
  /** F35 whisper: visibility `whisper` requires whisperTo recipients. */
  readonly visibility?: 'public' | 'whisper'
  readonly whisperTo?: readonly CatId[]
  /** #699 quote reference — validated, dropped when ineligible. */
  readonly replyTo?: string
  /** F39 delivery mode; `undefined` → busy-probe decides queue vs immediate. */
  readonly deliveryMode?: 'immediate' | 'queue' | 'force'
  /** F264 explicit work disposition (queue-path author intent input). */
  readonly messageDisposition?: MessageWorkDisposition
}

/** Result of publish(). */
export interface PublishMessageResult {
  readonly message: StoredMessage
  readonly mode: 'immediate' | 'queue' | 'force'
  /** True when the idempotency key (or queue dedup) resolved to an existing message. */
  readonly deduped: boolean
}

/** History query options (GET /api/messages query semantics). */
export interface MessageHistoryOptions {
  /** Page size (default 50). */
  readonly limit?: number
  /** Composite cursor `"<timestamp>:<messageId>"` or legacy plain timestamp. */
  readonly before?: string
  readonly userId?: string
}

/** History page (oldest-first, clowder-ai GET /api/messages shape). */
export interface MessageHistoryPage {
  readonly messages: readonly StoredMessage[]
  readonly hasMore: boolean
}

/** Queue admission result injected by the orchestrator (invocation queue). */
export interface QueueAdmissionOutcome {
  readonly outcome: 'admitted' | 'deduped' | 'full'
  readonly messageId?: string
  readonly queueSize?: number
}

/** Constructor options — optional collaborators kept out of Cordis inject. */
export interface MessageServiceOptions {
  /**
   * #555/#35 busy probe: any active execution on the thread (or on the
   * mentioned cats) → publish defaults to the queue path. Wired by the
   * composition root (stage-4 cats tracker / stage-5 batch 5 orchestrator).
   */
  readonly isThreadBusy?: (threadId: string, targetCats?: readonly CatId[]) => boolean
  /** #579 delete guard: thread currently being purged → 409 THREAD_DELETING. */
  readonly isThreadDeleting?: (threadId: string) => boolean
  /**
   * F39 queue admission gate (capacity + dedup). Returns the admission
   * outcome; `full` rejects with QUEUE_FULL before any message is written
   * (no ghost message).
   */
  readonly enqueue?: (input: {
    threadId: string
    userId: UserId
    idempotencyKey: string
    content: string
    mentions: readonly CatId[]
    disposition: MessageWorkDisposition
  }) => QueueAdmissionOutcome
  /** Realtime wiring point (stage-5 batch 3): user message published immediately. */
  readonly onPublished?: (message: StoredMessage) => void
  /** Realtime wiring point (stage-5 batch 3): user message queued. */
  readonly onQueued?: (message: StoredMessage) => void
  /** Realtime wiring point: auto-titled thread (thread_updated event). */
  readonly onThreadUpdated?: (threadId: string, title: string) => void
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat message domain service — mounted by `@flowforge/chat-messages`. */
    chatMessages: MessageService
  }
}

/** Resolve the timeline ordering timestamp (timelineOrderAt if set, else timestamp). */
function getTimelineOrderTime(msg: StoredMessage): number {
  return msg.timelineOrderAt ?? msg.timestamp
}

/** A message is timeline-published iff cat-authored OR a non-queued/canceled user message. */
function isTimelinePublished(msg: StoredMessage): boolean {
  if (msg.catId !== null) return true
  return msg.deliveryStatus !== 'queued' && msg.deliveryStatus !== 'canceled'
}

/** #699: internal non-routable parents (system/briefing) are never quotable. */
function isInternalNonQuotableParent(msg: StoredMessage): boolean {
  return msg.origin === 'briefing' || msg.metadata?.internal === true
}

/** Internal route-guard diagnostics never reach the browser timeline. */
function isInternalDiagnostic(msg: StoredMessage): boolean {
  const source = msg.metadata?.['source.connector']
  return source === 'routing-guard-failure' || msg.metadata?.internal === true
}

/** Parse a `"<ts>:<id>"` composite or legacy plain-timestamp cursor. */
export function parseHistoryCursor(
  before: string | undefined,
): { ts: number; id: string | undefined } | null {
  if (!before) return null
  const colonIdx = before.indexOf(':')
  const ts = colonIdx > 0 ? Number.parseInt(before.slice(0, colonIdx), 10) : Number.parseInt(before, 10)
  if (!Number.isFinite(ts)) return null
  return { ts, id: colonIdx > 0 ? before.slice(colonIdx + 1) : undefined }
}

/**
 * Cordis service exposing the chat message domain at `ctx.chatMessages`.
 */
export class MessageService extends Service {
  static inject = ['catStores'] as const

  private readonly options: MessageServiceOptions

  constructor(ctx: Context, options: MessageServiceOptions = {}) {
    super(ctx, 'chatMessages')
    this.options = options
  }

  /** POST /api/messages — publish a user message (idempotent, delivery-mode aware). */
  async publish(input: PublishMessageInput): Promise<PublishMessageResult> {
    const resolvedThreadId = input.threadId ?? DEFAULT_THREAD_ID

    // #21 + Phase D: reject orphaned messages — thread must exist and not be soft-deleted.
    // The `default` lobby thread is implicit and exempt (clowder-ai parity).
    if (resolvedThreadId !== DEFAULT_THREAD_ID) {
      const thread = await Promise.resolve(this.ctx.catStores.threads().getById(resolvedThreadId))
      if (!thread || thread.archivedAt !== undefined) {
        throw new ChatMessagesError(
          MessageErrorCode.THREAD_NOT_FOUND,
          '对话不存在：请先创建对话后再发送消息',
        )
      }
      // Auto-title untitled threads on first message.
      if (UNTITLED_THREAD_TITLES.includes(thread.title)) {
        const autoTitle = input.content.length > AUTO_TITLE_MAX_LENGTH
          ? `${input.content.slice(0, AUTO_TITLE_MAX_LENGTH)}...`
          : input.content
        await Promise.resolve(this.ctx.catStores.threads().update(resolvedThreadId, { title: autoTitle }))
        this.options.onThreadUpdated?.(resolvedThreadId, autoTitle)
      }
    }

    // #579: thread currently being purged — 409 before any side effect.
    if (this.options.isThreadDeleting?.(resolvedThreadId)) {
      throw new ChatMessagesError(MessageErrorCode.THREAD_DELETING, '对话正在删除中，请稍后重试或新建对话')
    }

    // #699 P1-2: replyTo eligibility (validated, silently dropped when ineligible).
    const replyTo = await this.resolveReplyTo(input, resolvedThreadId)

    // Server-generated idempotency key when the client didn't provide one.
    const resolvedIdempotencyKey = input.idempotencyKey ?? randomUUID()
    const mentions = input.mentions ?? []

    // F39/#555: slot-aware delivery routing — busy thread defaults to queue.
    const busy = this.options.isThreadBusy?.(resolvedThreadId, mentions) ?? false
    const mode = input.deliveryMode ?? (busy ? 'queue' : 'immediate')

    const appendPayload = {
      userId: input.userId,
      catId: null,
      content: input.content,
      mentions,
      timestamp: Date.now(),
      threadId: resolvedThreadId,
      idempotencyKey: resolvedIdempotencyKey,
      ...(input.contentBlocks ? { contentBlocks: input.contentBlocks } : {}),
      ...(input.visibility === 'whisper' && input.whisperTo
        ? { visibility: 'whisper' as const, whisperTo: input.whisperTo }
        : {}),
      ...(replyTo ? { replyTo } : {}),
    }

    if (mode === 'queue' && this.options.enqueue) {
      const admission = this.options.enqueue({
        threadId: resolvedThreadId,
        userId: input.userId,
        idempotencyKey: resolvedIdempotencyKey,
        content: input.content,
        mentions,
        disposition: input.messageDisposition ?? 'next_work',
      })
      if (admission.outcome === 'full') {
        throw new ChatMessagesError(
          MessageErrorCode.QUEUE_FULL,
          '消息队列已满',
          { queueSize: admission.queueSize ?? 0 },
        )
      }
      if (admission.outcome === 'deduped' && admission.messageId) {
        const existing = await Promise.resolve(this.ctx.catStores.messages().getById(admission.messageId))
        if (existing) return { message: existing, mode, deduped: true }
      }
      const message = await Promise.resolve(
        this.ctx.catStores.messages().append({ ...appendPayload, deliveryStatus: 'queued' }),
      )
      this.options.onQueued?.(message)
      return { message, mode, deduped: false }
    }

    const message = await Promise.resolve(this.ctx.catStores.messages().append(appendPayload))
    // Best-effort thread frontier bump (lastMessageAt/lastMessageId projection).
    await Promise.resolve(
      this.ctx.catStores.threads().touchLastMessage(resolvedThreadId, message.id, message.timestamp),
    )
    this.options.onPublished?.(message)
    return { message, mode, deduped: false }
  }

  /** GET /api/messages — history cursor pagination with internal filtering. */
  async history(threadId: string, options: MessageHistoryOptions = {}): Promise<MessageHistoryPage> {
    const limit = options.limit ?? 50
    if (!Number.isInteger(limit) || limit <= 0) return { messages: [], hasMore: false }
    const cursor = parseHistoryCursor(options.before)
    if (options.before !== undefined && !cursor) return { messages: [], hasMore: false }

    const resolvedThreadId = threadId ?? DEFAULT_THREAD_ID
    const store = this.ctx.catStores.messages()
    const BATCH_SIZE = limit + 1 + 20
    const needed = limit + 1

    const allVisible: StoredMessage[] = []
    let cursorTs = cursor?.ts
    let cursorId = cursor?.id
    let storeExhausted = false

    while (allVisible.length < needed && !storeExhausted) {
      const rawBatch = await Promise.resolve(
        store.getByThreadBefore(resolvedThreadId, cursorTs, BATCH_SIZE, cursorId, options.userId),
      )
      if (rawBatch.length < BATCH_SIZE) storeExhausted = true

      allVisible.unshift(...rawBatch.filter((m) => !isInternalDiagnostic(m)))

      if (rawBatch.length > 0) {
        const oldest = rawBatch[0]!
        const nextTs = getTimelineOrderTime(oldest)
        const nextId = oldest.id
        if (nextTs === cursorTs && nextId === cursorId) break // cursor stuck — store bug backstop
        cursorTs = nextTs
        cursorId = nextId
      }
    }

    const hasMore = allVisible.length > limit || !storeExhausted
    const page = allVisible.length > limit ? allVisible.slice(allVisible.length - limit) : allVisible
    return { messages: page, hasMore }
  }

  /** GET /api/messages/:id — single message fetch. */
  async get(id: string): Promise<StoredMessage> {
    const message = await Promise.resolve(this.ctx.catStores.messages().getById(id))
    if (!message) throw new ChatMessagesError(MessageErrorCode.MESSAGE_NOT_FOUND, '消息不存在')
    return message
  }

  /** Thread timeline read (delivered projection) — passthrough to the store. */
  async getByThread(threadId: string, limit?: number, userId?: string): Promise<readonly StoredMessage[]> {
    return Promise.resolve(this.ctx.catStores.messages().getByThread(threadId, limit, userId))
  }

  /** Incremental tail read (after cursor) — passthrough to the store. */
  async getByThreadAfter(
    threadId: string,
    afterId?: string,
    limit?: number,
    userId?: string,
  ): Promise<readonly StoredMessage[]> {
    return Promise.resolve(this.ctx.catStores.messages().getByThreadAfter(threadId, afterId, limit, userId))
  }

  /** Delivery lifecycle: queued → delivered (dequeue path). */
  async markDelivered(id: string, deliveredAt: number): Promise<MarkDeliveredResult | null> {
    return Promise.resolve(this.ctx.catStores.messages().markDelivered(id, deliveredAt))
  }

  /** Delivery lifecycle: queued → canceled (queue purge path). */
  async markCanceled(id: string): Promise<MarkCanceledResult | null> {
    return Promise.resolve(this.ctx.catStores.messages().markCanceled(id))
  }

  /** F35: reveal whisper content to a user (moderation / reveal window). */
  async revealWhispers(threadId: string, userId: string): Promise<number> {
    return Promise.resolve(this.ctx.catStores.messages().revealWhispers(threadId, userId))
  }

  /**
   * #699 P1-2: replyTo eligibility. Returns the validated replyTo or undefined.
   * Rules (clowder-ai parity):
   * - parent must exist, be undeleted, belong to the same thread, and be
   *   timeline-published (queued/canceled are not yet addressable)
   * - internal non-routable parents (system/briefing) are not quotable
   * - a public message may never quote a whisper (preview leak)
   * - a whisper quoting a whisper requires recipient subset (new ⊆ parent)
   */
  private async resolveReplyTo(input: PublishMessageInput, resolvedThreadId: string): Promise<string | undefined> {
    if (!input.replyTo) return undefined
    const target = await Promise.resolve(this.ctx.catStores.messages().getById(input.replyTo))
    if (
      !target
      || target.deletedAt
      || target.threadId !== resolvedThreadId
      || !isTimelinePublished(target)
      || isInternalNonQuotableParent(target)
    ) {
      return undefined
    }
    if (target.visibility === 'whisper') {
      if (input.visibility !== 'whisper') return undefined
      const parentRecipients = new Set(target.whisperTo ?? [])
      const newRecipients = input.whisperTo ?? []
      if (newRecipients.some((catId) => !parentRecipients.has(catId))) return undefined
    }
    return input.replyTo
  }
}
