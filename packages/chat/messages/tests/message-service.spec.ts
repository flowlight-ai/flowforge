/**
 * MessageService — publish / history contract tests（阶段5 批次2）：
 * - publish：线程存在性守卫（缺失/软删 THREAD_NOT_FOUND）+ lobby default 豁免；
 *   首消息自动标题（>30 截断）+ onThreadUpdated；THREAD_DELETING 守卫；
 *   幂等键去重；busy→queue 投递路由（queued 状态 + onQueued 钩子）；
 *   显式 immediate 覆盖 busy；QUEUE_FULL 零写入（无幽灵消息）
 * - replyTo（#699）：跨线程/已删/排队中/briefing 内部消息 → 静默丢弃；
 *   公开消息引用 whisper → 丢弃；whisper→whisper 收件人超集 → 丢弃；子集保留
 * - history：ts:id 复合游标分页 + hasMore；内部诊断消息过滤；
 *   非法游标 → 空页；最后页 hasMore=false
 *
 * @module @flowforge/chat-messages/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import { createCatId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import type { StoredMessage } from '@flowforge/cats-stores'
import {
  ChatMessagesError,
  MessageErrorCode,
  MessageService,
  parseHistoryCursor,
} from '../src/index.ts'
import type { MessageServiceOptions } from '../src/index.ts'

const USER_ALICE = 'alice' as UserId
const CAT_OPUS = createCatId('opus')
const CAT_NANO = createCatId('nano')

interface Harness {
  ctx: Context
  messages: MessageService
  backend: MemoryStoresBackend
}

function harness(options: MessageServiceOptions = {}): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const messages = new MessageService(ctx, options)
  return { ctx, messages, backend }
}

async function createThread(h: Harness, title = 'test thread'): Promise<string> {
  const thread = await h.ctx.catStores.threads().create({ userId: USER_ALICE, title })
  return thread.id
}

/** Append a delivered user message directly to the store with a controlled timestamp. */
function appendUser(
  h: Harness,
  threadId: string,
  content: string,
  timestamp: number,
): StoredMessage {
  return h.backend.messageStore.append({
    userId: USER_ALICE,
    catId: null,
    content,
    mentions: [],
    timestamp,
    threadId,
  })
}

describe('MessageService — publish guards', () => {
  it('rejects orphaned messages with THREAD_NOT_FOUND', async () => {
    const h = harness()
    await expect(
      h.messages.publish({ userId: USER_ALICE, content: 'hi', threadId: 'missing' }),
    ).rejects.toMatchObject({ code: MessageErrorCode.THREAD_NOT_FOUND })
  })

  it('rejects messages on soft-deleted threads', async () => {
    const h = harness()
    const threadId = await createThread(h)
    await h.ctx.catStores.threads().archive(threadId, USER_ALICE)
    await expect(
      h.messages.publish({ userId: USER_ALICE, content: 'hi', threadId }),
    ).rejects.toMatchObject({ code: MessageErrorCode.THREAD_NOT_FOUND })
  })

  it('allows the implicit default lobby thread without a thread record', async () => {
    const h = harness()
    const result = await h.messages.publish({ userId: USER_ALICE, content: 'lobby hello' })
    expect(result.message.threadId).toBe('default')
    expect(result.mode).toBe('immediate')
  })

  it('THREAD_DELETING guard fires before any write', async () => {
    const h = harness({ isThreadDeleting: () => true })
    const threadId = await createThread(h)
    await expect(
      h.messages.publish({ userId: USER_ALICE, content: 'hi', threadId }),
    ).rejects.toMatchObject({ code: MessageErrorCode.THREAD_DELETING })
  })
})

describe('MessageService — publish auto-title', () => {
  it('auto-titles untitled threads from the first message (>30 chars truncated)', async () => {
    const onThreadUpdated = vi.fn()
    const h = harness({ onThreadUpdated })
    const threadId = await createThread(h, '新对话')
    const long = 'x'.repeat(45)

    await h.messages.publish({ userId: USER_ALICE, content: long, threadId })

    const thread = await h.ctx.catStores.threads().getById(threadId)
    expect(thread?.title).toBe(`${'x'.repeat(30)}...`)
    expect(onThreadUpdated).toHaveBeenCalledWith(threadId, `${'x'.repeat(30)}...`)
  })

  it('leaves titled threads alone and bumps the message frontier', async () => {
    const onThreadUpdated = vi.fn()
    const h = harness({ onThreadUpdated })
    const threadId = await createThread(h, 'already titled')

    const result = await h.messages.publish({ userId: USER_ALICE, content: 'hello', threadId })

    const thread = await h.ctx.catStores.threads().getById(threadId)
    expect(thread?.title).toBe('already titled')
    expect(thread?.lastMessageId).toBe(result.message.id)
    expect(onThreadUpdated).not.toHaveBeenCalled()
  })
})

describe('MessageService — idempotency & delivery routing', () => {
  it('same idempotency key resolves to the same stored message', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const first = await h.messages.publish({
      userId: USER_ALICE,
      content: 'once',
      threadId,
      idempotencyKey: 'idem-1',
    })
    const retry = await h.messages.publish({
      userId: USER_ALICE,
      content: 'once',
      threadId,
      idempotencyKey: 'idem-1',
    })
    expect(retry.message.id).toBe(first.message.id)
    expect(await h.messages.getByThread(threadId)).toHaveLength(1)
  })

  it('busy thread routes to the queue path with deliveryStatus queued', async () => {
    const onQueued = vi.fn()
    const onPublished = vi.fn()
    const h = harness({
      isThreadBusy: () => true,
      enqueue: () => ({ outcome: 'admitted' }),
      onQueued,
      onPublished,
    })
    const threadId = await createThread(h)

    const result = await h.messages.publish({
      userId: USER_ALICE,
      content: 'queued work',
      threadId,
      mentions: [CAT_OPUS],
    })

    expect(result.mode).toBe('queue')
    expect(result.message.deliveryStatus).toBe('queued')
    expect(onQueued).toHaveBeenCalledWith(result.message)
    expect(onPublished).not.toHaveBeenCalled()
  })

  it('explicit immediate overrides the busy probe', async () => {
    const h = harness({ isThreadBusy: () => true, enqueue: () => ({ outcome: 'admitted' }) })
    const threadId = await createThread(h)

    const result = await h.messages.publish({
      userId: USER_ALICE,
      content: 'urgent',
      threadId,
      deliveryMode: 'immediate',
    })

    expect(result.mode).toBe('immediate')
    expect(result.message.deliveryStatus).toBeUndefined()
  })

  it('QUEUE_FULL rejects before writing any message (no ghost message)', async () => {
    const h = harness({
      isThreadBusy: () => true,
      enqueue: () => ({ outcome: 'full', queueSize: 8 }),
    })
    const threadId = await createThread(h)

    const error = await h.messages
      .publish({ userId: USER_ALICE, content: 'overflow', threadId })
      .catch((err: unknown) => err as ChatMessagesError)

    expect(error).toBeInstanceOf(ChatMessagesError)
    expect((error as ChatMessagesError).code).toBe(MessageErrorCode.QUEUE_FULL)
    expect((error as ChatMessagesError).detail).toEqual({ queueSize: 8 })
    expect(await h.messages.getByThread(threadId)).toHaveLength(0)
  })

  it('queue dedup returns the existing admission message', async () => {
    let dedupMessageId = 'unknown'
    const h = harness({
      isThreadBusy: () => true,
      enqueue: () => ({ outcome: 'deduped', messageId: dedupMessageId }),
    })
    const threadId = await createThread(h)
    const existing = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'original queued',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      deliveryStatus: 'queued',
    })
    dedupMessageId = existing.id

    const result = await h.messages.publish({
      userId: USER_ALICE,
      content: 'retry',
      threadId,
    })

    expect(result.deduped).toBe(true)
    expect(result.message.id).toBe(existing.id)
  })
})

describe('MessageService — replyTo validation (#699)', () => {
  it('drops replyTo pointing at another thread / deleted / queued / briefing parents', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const otherThread = await createThread(h, 'other')

    const crossThread = appendUser(h, otherThread, 'elsewhere', Date.now())
    const deleted = appendUser(h, threadId, 'to delete', Date.now())
    await h.ctx.catStores.messages().softDelete(deleted.id, USER_ALICE)
    const queued = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'still queued',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      deliveryStatus: 'queued',
    })
    const briefing = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'system briefing',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      origin: 'briefing',
    })

    for (const replyTo of [crossThread.id, deleted.id, queued.id, briefing.id]) {
      const result = await h.messages.publish({ userId: USER_ALICE, content: 'reply', threadId, replyTo })
      expect(result.message.replyTo).toBeUndefined()
    }
  })

  it('drops replyTo entirely when the parent does not exist', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const result = await h.messages.publish({
      userId: USER_ALICE,
      content: 'reply ghost',
      threadId,
      replyTo: 'no-such-message',
    })
    expect(result.message.replyTo).toBeUndefined()
  })

  it('keeps a valid public quote and carries whisper fields', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const parent = appendUser(h, threadId, 'quotable', Date.now())

    const result = await h.messages.publish({
      userId: USER_ALICE,
      content: 'reply',
      threadId,
      replyTo: parent.id,
      visibility: 'whisper',
      whisperTo: [CAT_OPUS],
    })

    expect(result.message.replyTo).toBe(parent.id)
    expect(result.message.visibility).toBe('whisper')
    expect(result.message.whisperTo).toEqual([CAT_OPUS])
  })

  it('a public reply never quotes a whisper (preview leak guard)', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const whisperParent = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'secret',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      visibility: 'whisper',
      whisperTo: [CAT_OPUS],
    })

    const result = await h.messages.publish({
      userId: USER_ALICE,
      content: 'public reply',
      threadId,
      replyTo: whisperParent.id,
    })

    expect(result.message.replyTo).toBeUndefined()
  })

  it('whisper→whisper requires the new recipients to be a subset of the parent', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const whisperParent = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'secret',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      visibility: 'whisper',
      whisperTo: [CAT_OPUS],
    })

    const superset = await h.messages.publish({
      userId: USER_ALICE,
      content: 'leaky whisper',
      threadId,
      replyTo: whisperParent.id,
      visibility: 'whisper',
      whisperTo: [CAT_OPUS, CAT_NANO],
    })
    expect(superset.message.replyTo).toBeUndefined()

    const subset = await h.messages.publish({
      userId: USER_ALICE,
      content: 'tight whisper',
      threadId,
      replyTo: whisperParent.id,
      visibility: 'whisper',
      whisperTo: [CAT_OPUS],
    })
    expect(subset.message.replyTo).toBe(whisperParent.id)
  })
})

describe('parseHistoryCursor', () => {
  it('parses composite "ts:id" cursors', () => {
    expect(parseHistoryCursor('1700000000123:msg-9')).toEqual({
      ts: 1700000000123,
      id: 'msg-9',
    })
  })

  it('parses legacy plain-timestamp cursors without an id', () => {
    expect(parseHistoryCursor('1700000000123')).toEqual({ ts: 1700000000123, id: undefined })
  })

  it('rejects malformed cursors with null', () => {
    expect(parseHistoryCursor('not-a-number')).toBeNull()
    expect(parseHistoryCursor(undefined)).toBeNull()
  })
})

describe('MessageService — history pagination', () => {
  it('pages oldest-first with hasMore until the tail is reached', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const base = Date.now() - 10_000
    for (let i = 0; i < 7; i++) {
      appendUser(h, threadId, `m${i}`, base + i * 100)
    }

    const page1 = await h.messages.history(threadId, { limit: 3 })
    expect(page1.messages.map((m) => m.content)).toEqual(['m4', 'm5', 'm6'])
    expect(page1.hasMore).toBe(true)

    const oldest1 = page1.messages[0]!
    const page2 = await h.messages.history(threadId, {
      limit: 3,
      before: `${oldest1.timestamp}:${oldest1.id}`,
    })
    expect(page2.messages.map((m) => m.content)).toEqual(['m1', 'm2', 'm3'])
    expect(page2.hasMore).toBe(true)

    const oldest2 = page2.messages[0]!
    const page3 = await h.messages.history(threadId, {
      limit: 3,
      before: `${oldest2.timestamp}:${oldest2.id}`,
    })
    expect(page3.messages.map((m) => m.content)).toEqual(['m0'])
    expect(page3.hasMore).toBe(false)
  })

  it('filters internal diagnostics out of the timeline', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const base = Date.now() - 5_000
    appendUser(h, threadId, 'visible-1', base)
    h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'guard failure',
      mentions: [],
      timestamp: base + 100,
      threadId,
      metadata: { 'source.connector': 'routing-guard-failure' },
    })
    appendUser(h, threadId, 'visible-2', base + 200)

    const page = await h.messages.history(threadId, { limit: 10 })
    expect(page.messages.map((m) => m.content)).toEqual(['visible-1', 'visible-2'])
    expect(page.hasMore).toBe(false)
  })

  it('returns an empty page for malformed cursors', async () => {
    const h = harness()
    const threadId = await createThread(h)
    appendUser(h, threadId, 'm0', Date.now())
    const page = await h.messages.history(threadId, { limit: 3, before: 'garbage' })
    expect(page).toEqual({ messages: [], hasMore: false })
  })

  it('excludes queued and canceled messages from the timeline', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const base = Date.now() - 5_000
    appendUser(h, threadId, 'delivered', base)
    const queued = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'queued',
      mentions: [],
      timestamp: base + 100,
      threadId,
      deliveryStatus: 'queued',
    })
    await h.messages.markCanceled(queued.id)

    const page = await h.messages.history(threadId, { limit: 10 })
    expect(page.messages.map((m) => m.content)).toEqual(['delivered'])
  })
})

describe('MessageService — delivery lifecycle passthrough', () => {
  it('markDelivered transitions a queued message', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const queued = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'queued',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      deliveryStatus: 'queued',
    })

    const delivered = await h.messages.markDelivered(queued.id, Date.now())
    expect(delivered?.deliveryStatus).toBe('delivered')
    expect(delivered?.deliveryTransitioned).toBe(true)

    const page = await h.messages.history(threadId, { limit: 10 })
    expect(page.messages.map((m) => m.content)).toEqual(['queued'])
  })

  it('revealWhispers marks whisper messages revealed', async () => {
    const h = harness()
    const threadId = await createThread(h)
    h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'secret',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      visibility: 'whisper',
      whisperTo: [CAT_OPUS],
    })
    expect(await h.messages.revealWhispers(threadId, USER_ALICE)).toBe(1)
  })
})
