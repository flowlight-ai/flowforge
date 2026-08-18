/**
 * IMessageStore — Forgekin message store port (pure interface, no Cordis).
 *
 * Ported from clowder-ai `packages/api/src/domains/cats/services/stores/ports/MessageStore.ts`
 * but reduced to the essential contract for batch 2: append / read / delete + delivery
 * lifecycle hooks. The full F117/F254/F288 features (queued custody, visibility seq,
 * plugin message payload) are deferred to incremental batches — the architecture is
 * already shaped to accept them without breaking the port.
 *
 * @module @flowforge/cats-stores/ports
 */

import type { CatId, MessageContent, MessageId, ThreadId, UserId } from '@flowforge/cats-shared'

/** A stored tool event recorded during agent invocation. */
export interface StoredToolEvent {
  readonly id: string
  readonly type: 'tool_use' | 'tool_result'
  readonly label: string
  readonly detail?: string
  readonly timestamp: number
  readonly toolUseId?: string
  readonly status?: 'ok' | 'error' | 'unknown'
  readonly toolName?: string
}

/** A persisted message (post-append — threadId always present). */
export interface StoredMessage {
  readonly id: string
  readonly threadId: string
  readonly userId: string
  /** null = user message, CatId = cat message */
  readonly catId: CatId | null
  readonly content: string
  readonly contentBlocks?: readonly MessageContent[]
  readonly toolEvents?: readonly StoredToolEvent[]
  readonly metadata?: Record<string, unknown>
  readonly mentions: readonly CatId[]
  readonly mentionsUser?: boolean
  readonly timestamp: number
  readonly thinking?: string
  readonly origin?: 'stream' | 'callback' | 'briefing'
  readonly visibility?: 'public' | 'whisper'
  readonly whisperTo?: readonly CatId[]
  readonly revealedAt?: number
  readonly deliveredAt?: number
  readonly timelineOrderAt?: number
  readonly deliveryStatus?: 'queued' | 'delivered' | 'canceled'
  readonly replyTo?: string
  readonly deletedAt?: number
  readonly deletedBy?: string
  readonly _tombstone?: true
}

/** Append input — id/threadId/deliveryStatus are store-owned. */
export type AppendMessageInput = Omit<
  StoredMessage,
  'id' | 'threadId' | 'deliveredAt' | 'timelineOrderAt' | 'deliveryStatus'
> & {
  readonly threadId?: string
  readonly deliveryStatus?: 'queued'
  readonly idempotencyKey?: string
}

/** Result of markDelivered(). */
export type MarkDeliveredResult = StoredMessage & { readonly deliveryTransitioned: boolean }

/** Result of markCanceled(). */
export type MarkCanceledResult = StoredMessage & { readonly deliveryTransitioned: boolean }

/** Append listener — fire-and-forget after each successful append. */
export type MessageAppendListener = (message: StoredMessage) => void

/**
 * Common interface for message stores. Both Memory and Sqlite backends
 * implement this; methods that may hit durable storage are async.
 */
export interface IMessageStore {
  /**
   * Optional fire-and-forget listener invoked after every successful append.
   *
   * `| undefined` is required under `exactOptionalPropertyTypes: true` so that
   * backend implementations can explicitly initialize the field to `undefined`
   * from constructor options.
   */
  onAppend?: MessageAppendListener | undefined
  append(msg: AppendMessageInput): StoredMessage | Promise<StoredMessage>
  getById(id: string): StoredMessage | null | Promise<StoredMessage | null>
  getRecent(limit?: number, userId?: string): StoredMessage[] | Promise<StoredMessage[]>
  getByThread(
    threadId: string,
    limit?: number,
    userId?: string,
  ): StoredMessage[] | Promise<StoredMessage[]>
  getByThreadAfter(
    threadId: string,
    afterId?: string,
    limit?: number,
    userId?: string,
  ): StoredMessage[] | Promise<StoredMessage[]>
  deleteByThread(threadId: string): number | Promise<number>
  softDelete(id: string, deletedBy: string): StoredMessage | null | Promise<StoredMessage | null>
  hardDelete(id: string, deletedBy: string): StoredMessage | null | Promise<StoredMessage | null>
  restore(id: string): StoredMessage | null | Promise<StoredMessage | null>
  revealWhispers(threadId: string, userId: string): number | Promise<number>
  updateExtra(
    id: string,
    extra: Record<string, unknown>,
  ): StoredMessage | null | Promise<StoredMessage | null>
  markDelivered(id: string, deliveredAt: number): MarkDeliveredResult | null | Promise<MarkDeliveredResult | null>
  markCanceled(id: string): MarkCanceledResult | null | Promise<MarkCanceledResult | null>
}

/** Type-tagged IDs for type-safe port consumption (re-exported for ergonomic imports). */
export type { CatId, MessageId, ThreadId, UserId }
