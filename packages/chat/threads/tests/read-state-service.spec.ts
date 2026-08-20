/**
 * ReadStateService — 读状态服务移植契约验证（阶段5 批次1，T5.1.6）：
 * - ack：单调 CAS 推进 + #1304 caughtUp 语义（推进/过期/幂等）
 * - P1-3：upToMessageId 必须属于目标线程（跨线程/未知消息/未知线程拒绝）
 * - v2 防回退：存量 v2 游标不因 raw id ack 而回退（lex 序 v2 > v1）
 * - ackLatest：服务端原子 ack 最新可见消息（F069-R5）/ 空线程 reason
 * - markAllRead：F072 全部已读（跳过软删线程 / 幂等）
 * - getUnreadSummaries：游标后计数 + mentionsUser 标记 + 显式 threadIds
 *
 * @module @flowforge/chat-threads/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import type { StoredMessage } from '@flowforge/cats-stores'
import { ReadStateService, ThreadErrorCode, ThreadService } from '../src/index.ts'

const USER_ALICE = 'alice' as UserId

interface Harness {
  ctx: Context
  readState: ReadStateService
  backend: MemoryStoresBackend
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  // softDelete/archive path of ReadStateService tests touches threads only
  // via catStores; ThreadService is mounted for create/softDelete semantics.
  new ThreadService(ctx)
  const readState = new ReadStateService(ctx)
  return { ctx, readState, backend }
}

interface SeedResult {
  readonly threadId: string
  readonly messages: readonly StoredMessage[]
}

/** Create a thread + `count` visible messages (all authored by alice). */
async function seedThread(
  h: Harness,
  count: number,
  title = 't',
): Promise<SeedResult> {
  const created = await h.ctx.catStores.threads().create({
    userId: USER_ALICE,
    title,
  })
  const messages: StoredMessage[] = []
  for (let i = 0; i < count; i++) {
    messages.push(
      h.backend.messageStore.append({
        userId: USER_ALICE,
        catId: null,
        content: `m${i}`,
        mentions: [],
        timestamp: Date.now(),
        threadId: created.id,
      }),
    )
  }
  return { threadId: created.id, messages }
}

describe('ReadStateService — ack', () => {
  it('advances the cursor monotonically with caughtUp semantics', async () => {
    const h = harness()
    const { threadId, messages } = await seedThread(h, 3)
    const [m1, m2, m3] = messages as [StoredMessage, StoredMessage, StoredMessage]

    // First ack advances.
    const first = await h.readState.ack(USER_ALICE, threadId, m2.id)
    expect(first).toEqual({ advanced: true, caughtUp: true })

    // Older message: rejected by the monotonic CAS → stale + not caught up.
    const stale = await h.readState.ack(USER_ALICE, threadId, m1.id)
    expect(stale).toEqual({ advanced: false, caughtUp: false })

    // Same message: idempotent no-op but still caught up (#1304).
    const again = await h.readState.ack(USER_ALICE, threadId, m2.id)
    expect(again).toEqual({ advanced: false, caughtUp: true })

    // Newer message advances again.
    const latest = await h.readState.ack(USER_ALICE, threadId, m3.id)
    expect(latest).toEqual({ advanced: true, caughtUp: true })
  })

  it('validates thread membership (P1-3)', async () => {
    const h = harness()
    const a = await seedThread(h, 1)
    const b = await seedThread(h, 1)

    // Message from another thread.
    await expect(
      h.readState.ack(USER_ALICE, a.threadId, b.messages[0]!.id),
    ).rejects.toMatchObject({ code: ThreadErrorCode.INVALID_INPUT })

    // Unknown message.
    await expect(
      h.readState.ack(USER_ALICE, a.threadId, 'msg_missing'),
    ).rejects.toMatchObject({ code: ThreadErrorCode.INVALID_INPUT })

    // Unknown thread.
    await expect(
      h.readState.ack(USER_ALICE, 'th_missing', a.messages[0]!.id),
    ).rejects.toMatchObject({ code: ThreadErrorCode.THREAD_NOT_FOUND })
  })

  it('never regresses a stored v2 cursor to a raw v1 id', async () => {
    const h = harness()
    const { threadId, messages } = await seedThread(h, 2)
    // Seed a v2-format slot directly (as if written while the gate was on).
    h.backend.threadReadStateStore.ack(
      USER_ALICE,
      threadId,
      'v2:0000000000000001:legacy',
    )

    const res = await h.readState.ack(USER_ALICE, threadId, messages[1]!.id)
    // 'v2:…' sorts above any timestamp-prefixed raw id → CAS fails closed.
    expect(res.advanced).toBe(false)
    expect(h.backend.threadReadStateStore.get(USER_ALICE, threadId)?.lastReadMessageId)
      .toBe('v2:0000000000000001:legacy')
  })
})

describe('ReadStateService — ackLatest', () => {
  it('acks the latest visible message server-side (F069-R5)', async () => {
    const h = harness()
    const { threadId, messages } = await seedThread(h, 2)

    const res = await h.readState.ackLatest(USER_ALICE, threadId)
    expect(res.advanced).toBe(true)
    expect(res.caughtUp).toBe(true)
    expect(h.backend.threadReadStateStore.get(USER_ALICE, threadId)?.lastReadMessageId)
      .toBe(messages[1]!.id)
  })

  it('reports a no-op reason for empty threads', async () => {
    const h = harness()
    const created = await h.ctx.catStores.threads().create({
      userId: USER_ALICE,
      title: 'empty',
    })
    const res = await h.readState.ackLatest(USER_ALICE, created.id)
    expect(res).toEqual({ advanced: false, caughtUp: true, reason: 'no messages' })
  })

  it('throws for unknown threads', async () => {
    const h = harness()
    await expect(h.readState.ackLatest(USER_ALICE, 'th_missing')).rejects.toMatchObject({
      code: ThreadErrorCode.THREAD_NOT_FOUND,
    })
  })
})

describe('ReadStateService — markAllRead', () => {
  it('marks every active thread read and stays idempotent', async () => {
    const h = harness()
    const t1 = await seedThread(h, 2, 'one')
    const t2 = await seedThread(h, 1, 'two')
    // An archived thread is listed but skipped (F095 trash view).
    const archived = await h.ctx.catStores.threads().create({
      userId: USER_ALICE,
      title: 'archived',
    })
    h.backend.threadStore.archive(archived.id, USER_ALICE)

    const first = await h.readState.markAllRead(USER_ALICE)
    expect(first).toEqual({ advancedCount: 2, totalThreads: 3 })

    expect(
      h.backend.threadReadStateStore.get(USER_ALICE, t1.threadId)?.lastReadMessageId,
    ).toBe(t1.messages[1]!.id)
    expect(
      h.backend.threadReadStateStore.get(USER_ALICE, t2.threadId)?.lastReadMessageId,
    ).toBe(t2.messages[0]!.id)

    // Second pass: cursors are already at the latest → nothing advances.
    const second = await h.readState.markAllRead(USER_ALICE)
    expect(second.advancedCount).toBe(0)
  })
})

describe('ReadStateService — getUnreadSummaries', () => {
  it('counts unread messages after the cursor and flags user mentions', async () => {
    const h = harness()
    const t1 = await seedThread(h, 2, 'one')
    const t2 = await seedThread(h, 1, 'two')

    // No cursors yet → everything unread (summaries ordered by recency).
    let summaries = await h.readState.getUnreadSummaries(USER_ALICE)
    let byId = new Map(summaries.map((s) => [s.threadId, s]))
    expect(byId.get(t1.threadId)).toEqual({
      threadId: t1.threadId, unreadCount: 2, hasUserMention: false,
    })
    expect(byId.get(t2.threadId)).toEqual({
      threadId: t2.threadId, unreadCount: 1, hasUserMention: false,
    })

    // Ack the first message of t1 → one unread remains.
    await h.readState.ack(USER_ALICE, t1.threadId, t1.messages[0]!.id)
    summaries = await h.readState.getUnreadSummaries(USER_ALICE)
    byId = new Map(summaries.map((s) => [s.threadId, s]))
    expect(byId.get(t1.threadId)).toEqual({
      threadId: t1.threadId, unreadCount: 1, hasUserMention: false,
    })

    // An unread message mentioning the user flips the badge flag.
    h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'ping @alice',
      mentions: [],
      mentionsUser: true,
      timestamp: Date.now(),
      threadId: t1.threadId,
    })
    summaries = await h.readState.getUnreadSummaries(USER_ALICE)
    byId = new Map(summaries.map((s) => [s.threadId, s]))
    expect(byId.get(t1.threadId)).toEqual({
      threadId: t1.threadId, unreadCount: 2, hasUserMention: true,
    })

    // Explicit threadIds scope the query.
    const scoped = await h.readState.getUnreadSummaries(USER_ALICE, [t2.threadId])
    expect(scoped).toEqual([
      { threadId: t2.threadId, unreadCount: 1, hasUserMention: false },
    ])
  })
})
