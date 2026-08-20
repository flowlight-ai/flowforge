/**
 * SqliteStoresBackend 契约测试（批次 6.5，T4.2.6）：
 * - Cordis harness：CatStores 聚合 + SqliteStoresBackend（`:memory:`）
 * - 9 个 store 各覆盖主路径（写→读回、按 thread 查询、更新、删除/CAS）
 * - invocation CAS 专门：cas_mismatch / invalid_transition / 幂等去重（5min TTL 窗口）
 * - sessionChain：create seq 自增 + getActive + active→sealing→sealed +
 *   listSealingSessions + reuseExistingCliSession + chainKey 写容忍
 * - delivery cursor：delivery 与 seen 双命名空间独立（AC-A9）
 * - 持久化往返：临时文件 db 写入 → dispose → 重新打开 → 数据仍在
 *
 * @module @flowforge/cats-stores-sqlite/tests
 */

import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { rmSync } from 'node:fs'
import { Context } from '@flowforge/cordis'
import { createCatId, createThreadId, createUserId } from '@flowforge/cats-shared'
import type { CreateInvocationInput, InvocationId } from '@flowforge/cats-shared'
import { CatStores } from '@flowforge/cats-stores'
import type { CreateSessionInput, StoreCreateInvocationOutcome } from '@flowforge/cats-stores/ports'
import { SqliteStoresBackend } from '../src/index.ts'

const CAT_OPUS = createCatId('opus')
const CAT_NEO = createCatId('neo')
const USER_ALICE = createUserId('alice')
const USER_BOB = createUserId('bob')
const THREAD_T1 = createThreadId('t1')
const THREAD_T2 = createThreadId('t2')

/**
 * Track plugin fibers so each test tears down cleanly (Cordis disposal is via
 * Fiber.dispose(), matching the cats-stores test harness convention).
 */
const fibers: Array<{ dispose: () => Promise<void> | void }> = []
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!
    await fiber.dispose()
  }
})

/** Cordis harness：CatStores 聚合 + SqliteStoresBackend（in-process db）. */
async function withBackend(path: string = ':memory:'): Promise<SqliteStoresBackend> {
  const ctx = new Context()
  fibers.push(await ctx.plugin(CatStores) as unknown as { dispose: () => Promise<void> | void })
  fibers.push(
    await ctx.plugin(SqliteStoresBackend, { path }) as unknown as { dispose: () => Promise<void> | void },
  )
  return ctx.catStoresSqlite
}

function messageInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: 'alice',
    catId: null,
    content: 'hello',
    mentions: [],
    timestamp: Date.now(),
    ...overrides,
  }
}

function invocationInput(overrides: Partial<CreateInvocationInput> = {}): CreateInvocationInput {
  return {
    threadId: THREAD_T1,
    userId: USER_ALICE,
    catIds: [CAT_OPUS],
    source: 'user',
    ...overrides,
  }
}

function sessionInput(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  return {
    cliSessionId: `cli_${randomUUID().slice(0, 8)}`,
    threadId: 't1',
    catId: CAT_OPUS,
    userId: 'alice',
    ...overrides,
  }
}

/** Narrow a create outcome to its invocationId (fail loudly on conflict). */
function unwrapCreated(outcome: StoreCreateInvocationOutcome): InvocationId {
  if (outcome.outcome === 'conflict') {
    throw new Error(`unexpected conflict outcome: ${outcome.reason}`)
  }
  return outcome.invocationId
}

describe('SqliteStoresBackend — Cordis 注册', () => {
  it('registers the sqlite backend with the CatStores aggregate and routes accessors', async () => {
    const ctx = new Context()
    fibers.push(await ctx.plugin(CatStores) as unknown as { dispose: () => Promise<void> | void })
    const fiber = await ctx.plugin(SqliteStoresBackend, { path: ':memory:' })
    fibers.push(fiber as unknown as { dispose: () => Promise<void> | void })
    const backend = ctx.catStoresSqlite
    expect(ctx.catStores.backendNames()).toContain('sqlite')
    expect(ctx.catStores.activeBackendName()).toBe('sqlite')
    expect(ctx.catStores.messages()).toBe(backend.messageStore)
    expect(ctx.catStores.invocationRecords()).toBe(backend.invocationRecordStore)
    expect(ctx.catStores.sessionChains()).toBe(backend.sessionChainStore)
    expect(ctx.catStores.deliveryCursors()).toBe(backend.deliveryCursorStore)
    expect(ctx.catStores.summaries()).toBe(backend.summaryStore)
  })

  it('rejects an invalid journalMode at construction', async () => {
    const ctx = new Context()
    fibers.push(await ctx.plugin(CatStores) as unknown as { dispose: () => Promise<void> | void })
    // Schemastery 校验层先拒绝（constructor 白名单为无 Config 规范化路径兜底）
    await expect(
      ctx.plugin(SqliteStoresBackend, { path: ':memory:', journalMode: 'off' as never }),
    ).rejects.toThrow(/journalMode/)
  })
})

describe('SqliteMessageStore', () => {
  it('appends with store-owned sortable id and reads back by id (default thread)', async () => {
    const backend = await withBackend()
    const stored = backend.messageStore.append(messageInput() as never)
    expect(stored.id).toMatch(/^\d{16}-\d{6}-/)
    expect(stored.threadId).toBe('default')
    expect(backend.messageStore.getById(stored.id)?.content).toBe('hello')
  })

  it('lists by thread with limit, newest-last ordering', async () => {
    const backend = await withBackend()
    const a = backend.messageStore.append(messageInput({ threadId: 't1', content: 'a', timestamp: 1 }) as never)
    backend.messageStore.append(messageInput({ threadId: 't1', content: 'b', timestamp: 2 }) as never)
    const others = backend.messageStore.append(messageInput({ threadId: 't2' }) as never)
    void others
    const list = backend.messageStore.getByThread('t1', 1)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).not.toBe(a.id) // newest-last window keeps b
    expect(list[0]!.content).toBe('b')
  })

  it('dedupes appends sharing an idempotency key within the same thread+user', async () => {
    const backend = await withBackend()
    const first = backend.messageStore.append(messageInput({ idempotencyKey: 'idem-1' }) as never)
    const second = backend.messageStore.append(messageInput({ idempotencyKey: 'idem-1', content: 'changed' }) as never)
    expect(second.id).toBe(first.id)
    expect(backend.messageStore.size).toBe(1)
  })

  it('soft-deletes and restores without touching other rows', async () => {
    const backend = await withBackend()
    const msg = backend.messageStore.append(messageInput() as never)
    const soft = backend.messageStore.softDelete(msg.id, 'alice')
    expect(soft?.deletedAt).toBeTypeOf('number')
    expect(backend.messageStore.getRecent()).toHaveLength(0)
    const restored = backend.messageStore.restore(msg.id)
    expect(restored?.deletedAt).toBeUndefined()
    expect(backend.messageStore.getRecent()).toHaveLength(1)
  })

  it('transitions queued delivery exactly once (markDelivered / markCanceled)', async () => {
    const backend = await withBackend()
    const queued = backend.messageStore.append(
      messageInput({ deliveryStatus: 'queued' }) as never,
    )
    const delivered = backend.messageStore.markDelivered(queued.id, Date.now())
    expect(delivered?.deliveryTransitioned).toBe(true)
    expect(delivered?.deliveryStatus).toBe('delivered')
    expect(backend.messageStore.markDelivered(queued.id, Date.now())?.deliveryTransitioned).toBe(false)
    const queued2 = backend.messageStore.append(
      messageInput({ deliveryStatus: 'queued' }) as never,
    )
    expect(backend.messageStore.markCanceled(queued2.id)?.deliveryTransitioned).toBe(true)
    expect(backend.messageStore.markCanceled(queued2.id)?.deliveryStatus).toBe('canceled')
  })
})

describe('SqliteThreadStore', () => {
  it('creates and reads back a thread', async () => {
    const backend = await withBackend()
    const thread = backend.threadStore.create({ userId: 'alice', title: 'First' })
    expect(thread.id).toMatch(/^thread_/)
    expect(backend.threadStore.getById(thread.id)?.title).toBe('First')
  })

  it('listForUser hides archived threads unless includeArchived', async () => {
    const backend = await withBackend()
    const t1 = backend.threadStore.create({ userId: 'alice', title: 'a' })
    const t2 = backend.threadStore.create({ userId: 'alice', title: 'b' })
    backend.threadStore.archive(t1.id, 'alice')
    expect(backend.threadStore.listForUser(USER_ALICE).map((t) => t.id)).toEqual([t2.id])
    expect(backend.threadStore.listForUser(USER_ALICE, { includeArchived: true })).toHaveLength(2)
  })

  it('updates mutable fields and touches lastMessage', async () => {
    const backend = await withBackend()
    const thread = backend.threadStore.create({ userId: 'alice', title: 'a' })
    const renamed = backend.threadStore.update(thread.id, { title: 'renamed' })
    expect(renamed?.title).toBe('renamed')
    const touched = backend.threadStore.touchLastMessage(thread.id, 'm1', 123)
    expect(touched?.lastMessageId).toBe('m1')
    expect(touched?.lastMessageAt).toBe(123)
  })

  it('unarchives and deletes threads', async () => {
    const backend = await withBackend()
    const thread = backend.threadStore.create({ userId: 'alice', title: 'a' })
    backend.threadStore.archive(thread.id, 'alice')
    const back = backend.threadStore.unarchive(thread.id)
    expect(back?.archivedAt).toBeUndefined()
    expect(backend.threadStore.delete(thread.id)).toBe(true)
    expect(backend.threadStore.delete(thread.id)).toBe(false)
  })
})

describe('SqliteTaskStore', () => {
  it('creates and reads back a task', async () => {
    const backend = await withBackend()
    const task = backend.taskStore.create({
      threadId: 't1',
      userId: 'alice',
      catId: CAT_OPUS,
      title: 'ship it',
      status: 'todo',
      kind: 'work',
    })
    expect(task.id).toMatch(/^task_/)
    expect(backend.taskStore.getById(task.id)?.title).toBe('ship it')
  })

  it('listForThread filters by status and kind', async () => {
    const backend = await withBackend()
    backend.taskStore.create({ threadId: 't1', userId: 'alice', catId: CAT_OPUS, title: 'a', status: 'todo', kind: 'work' })
    backend.taskStore.create({ threadId: 't1', userId: 'alice', catId: CAT_OPUS, title: 'b', status: 'done', kind: 'work' })
    backend.taskStore.create({ threadId: 't1', userId: 'alice', catId: CAT_OPUS, title: 'c', status: 'todo', kind: 'pr_tracking' })
    expect(backend.taskStore.listForThread('t1')).toHaveLength(3)
    expect(backend.taskStore.listForThread('t1', { status: 'todo' })).toHaveLength(2)
    expect(backend.taskStore.listForThread('t1', { status: 'todo', kind: 'work' })).toHaveLength(1)
  })

  it('updates status and lists by cat', async () => {
    const backend = await withBackend()
    const task = backend.taskStore.create({
      threadId: 't1', userId: 'alice', catId: CAT_OPUS, title: 'a', status: 'todo', kind: 'work',
    })
    const done = backend.taskStore.update(task.id, { status: 'done', completedAt: 42 })
    expect(done?.status).toBe('done')
    expect(backend.taskStore.listForCat(CAT_OPUS, { status: 'done' })).toHaveLength(1)
    expect(backend.taskStore.listForCat(CAT_NEO)).toHaveLength(0)
  })

  it('deletes tasks', async () => {
    const backend = await withBackend()
    const task = backend.taskStore.create({
      threadId: 't1', userId: 'alice', catId: null, title: 'x', status: 'todo', kind: 'work',
    })
    expect(backend.taskStore.delete(task.id)).toBe(true)
    expect(backend.taskStore.getById(task.id)).toBeNull()
  })
})

describe('SqliteBacklogStore', () => {
  function backlogInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      userId: 'alice',
      title: 'fix bug',
      summary: 'fix the login bug',
      priority: 'p1',
      tags: ['bug'],
      status: 'open',
      createdBy: 'user' as const,
      ...overrides,
    }
  }

  it('creates with an empty audit log and reads back', async () => {
    const backend = await withBackend()
    const item = backend.backlogStore.create(backlogInput() as never)
    expect(item.id).toMatch(/^backlog_/)
    expect(item.audit).toEqual([])
    expect(backend.backlogStore.getById(item.id)?.title).toBe('fix bug')
  })

  it('listForThread scopes by dispatchedThreadId', async () => {
    const backend = await withBackend()
    backend.backlogStore.create(backlogInput({ dispatchedThreadId: 't1' }) as never)
    backend.backlogStore.create(backlogInput({ dispatchedThreadId: 't2' }) as never)
    backend.backlogStore.create(backlogInput() as never)
    expect(backend.backlogStore.listForThread('t1')).toHaveLength(1)
  })

  it('setLease assigns and releases cat ownership (listForCat)', async () => {
    const backend = await withBackend()
    const item = backend.backlogStore.create(backlogInput() as never)
    expect(backend.backlogStore.listForCat(CAT_OPUS)).toHaveLength(0)
    const now = Date.now()
    const leased = backend.backlogStore.setLease(item.id, {
      ownerCatId: CAT_OPUS,
      state: 'active',
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: now + 60_000,
    })
    expect(leased?.lease?.ownerCatId).toBe(CAT_OPUS)
    expect(backend.backlogStore.listForCat(CAT_OPUS)).toHaveLength(1)
    const released = backend.backlogStore.setLease(item.id, null)
    expect(released?.lease).toBeUndefined()
    expect(backend.backlogStore.listForCat(CAT_OPUS)).toHaveLength(0)
  })

  it('appendAudit appends and addClaimSuggestion replaces', async () => {
    const backend = await withBackend()
    const item = backend.backlogStore.create(backlogInput() as never)
    const withAudit = backend.backlogStore.appendAudit(item.id, {
      id: 'audit-1',
      action: 'approved',
      actor: { kind: 'user', id: 'alice' },
      timestamp: Date.now(),
    })
    expect(withAudit?.audit).toHaveLength(1)
    const suggestion = {
      catId: CAT_OPUS,
      why: 'knows auth',
      plan: 'read code first',
      requestedPhase: 'coding' as const,
      status: 'pending' as const,
      suggestedAt: Date.now(),
    }
    const withSuggestion = backend.backlogStore.addClaimSuggestion(item.id, suggestion)
    expect(withSuggestion?.suggestion?.catId).toBe(CAT_OPUS)
    // Memory 语义：addClaimSuggestion 仅替换 suggestion，不追加 audit
    expect(withSuggestion?.audit).toHaveLength(1)
  })
})

describe('SqliteMemoryStore', () => {
  function memoryInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      catId: CAT_OPUS,
      kind: 'fact',
      content: 'likes fish',
      importance: 3,
      ...overrides,
    }
  }

  it('creates and reads back a memory entry', async () => {
    const backend = await withBackend()
    const memory = backend.memoryStore.create(memoryInput() as never)
    expect(memory.id).toMatch(/^memory_/)
    expect(backend.memoryStore.getById(memory.id)?.content).toBe('likes fish')
  })

  it('listForCat filters by kind and applies limit', async () => {
    const backend = await withBackend()
    backend.memoryStore.create(memoryInput({ kind: 'fact' }) as never)
    backend.memoryStore.create(memoryInput({ kind: 'preference' }) as never)
    backend.memoryStore.create(memoryInput({ kind: 'fact', catId: CAT_NEO }) as never)
    expect(backend.memoryStore.listForCat(CAT_OPUS)).toHaveLength(2)
    expect(backend.memoryStore.listForCat(CAT_OPUS, { kind: 'fact' })).toHaveLength(1)
    expect(backend.memoryStore.listForCat(CAT_OPUS, { limit: 1 })).toHaveLength(1)
  })

  it('updates, deletes, and searchSimilar returns [] (no vector backend yet)', async () => {
    const backend = await withBackend()
    const memory = backend.memoryStore.create(memoryInput() as never)
    const updated = backend.memoryStore.update(memory.id, { importance: 5 })
    expect(updated?.importance).toBe(5)
    expect(backend.memoryStore.searchSimilar(CAT_OPUS, [0.1, 0.2])).toEqual([])
    expect(backend.memoryStore.delete(memory.id)).toBe(true)
    expect(backend.memoryStore.getById(memory.id)).toBeNull()
  })
})

describe('SqliteInvocationRecordStore — CAS / 状态机 / 幂等', () => {
  it('creates a queued record and reads it back', async () => {
    const backend = await withBackend()
    const outcome = backend.invocationRecordStore.create(invocationInput())
    expect(outcome.outcome).toBe('created')
    const record = backend.invocationRecordStore.get(unwrapCreated(outcome))
    expect(record?.status).toBe('queued')
    expect(record?.catIds).toEqual([CAT_OPUS])
  })

  it('dedupes create within the idempotency TTL window', async () => {
    const backend = await withBackend()
    const first = unwrapCreated(backend.invocationRecordStore.create(invocationInput({ idempotencyKey: 'op-1' })))
    const second = backend.invocationRecordStore.create(invocationInput({ idempotencyKey: 'op-1' }))
    expect(second.outcome).toBe('deduped')
    expect(unwrapCreated(second)).toBe(first)
    const lookup = backend.invocationRecordStore.getByIdempotencyKey(THREAD_T1, USER_ALICE, 'op-1')
    expect(lookup?.invocationId).toBe(first)
    expect(
      backend.invocationRecordStore.getByIdempotencyKey(THREAD_T1, USER_ALICE, 'never-seen'),
    ).toBeNull()
  })

  it('walks the happy path queued→running→succeeded stamping executionStartedAt / settledAt', async () => {
    const backend = await withBackend()
    const invocationId = unwrapCreated(backend.invocationRecordStore.create(invocationInput()))
    const running = backend.invocationRecordStore.update({ invocationId, status: 'running' })
    expect(running.outcome).toBe('updated')
    const ok = backend.invocationRecordStore.update({ invocationId, status: 'succeeded' })
    expect(ok.outcome).toBe('updated')
    const record = backend.invocationRecordStore.get(invocationId)
    expect(record?.executionStartedAt).toBeTypeOf('number')
    expect(record?.settledAt).toBeTypeOf('number')
  })

  it('returns cas_mismatch when expectedStatus does not match current status', async () => {
    const backend = await withBackend()
    const invocationId = unwrapCreated(backend.invocationRecordStore.create(invocationInput()))
    const mismatch = backend.invocationRecordStore.update({
      invocationId,
      status: 'canceled',
      expectedStatus: 'running',
    })
    expect(mismatch).toMatchObject({
      outcome: 'cas_mismatch',
      expected: 'running',
      actual: 'queued',
    })
  })

  it('returns invalid_transition for illegal state-machine edges', async () => {
    const backend = await withBackend()
    const invocationId = unwrapCreated(backend.invocationRecordStore.create(invocationInput()))
    // queued → succeeded is not a legal edge (must pass through running)
    const skip = backend.invocationRecordStore.update({ invocationId, status: 'succeeded' })
    expect(skip).toMatchObject({ outcome: 'invalid_transition', from: 'queued', to: 'succeeded' })
    // terminal states have no outgoing transitions
    backend.invocationRecordStore.update({ invocationId, status: 'failed' })
    const resurrect = backend.invocationRecordStore.update({ invocationId, status: 'running' })
    expect(resurrect).toMatchObject({ outcome: 'invalid_transition', from: 'failed', to: 'running' })
  })

  it('returns missing for updates against unknown invocations', async () => {
    const backend = await withBackend()
    const outcome = backend.invocationRecordStore.update({
      invocationId: 'inv_missing' as never,
      status: 'running',
    })
    expect(outcome).toMatchObject({ outcome: 'missing' })
  })

  it('listRunningByThread scopes by thread × user', async () => {
    const backend = await withBackend()
    const a = unwrapCreated(backend.invocationRecordStore.create(invocationInput()))
    backend.invocationRecordStore.create(invocationInput({ userId: USER_BOB }))
    backend.invocationRecordStore.create(invocationInput({ threadId: THREAD_T2 }))
    backend.invocationRecordStore.update({ invocationId: a, status: 'running' })
    const running = backend.invocationRecordStore.listRunningByThread(THREAD_T1, USER_ALICE)
    expect(running).toHaveLength(1)
    expect(running[0]!.invocationId).toBe(a)
    const all = await backend.invocationRecordStore.scanAll!()
    expect(all).toHaveLength(3)
  })
})

describe('SqliteSessionChainStore — F24 会话链', () => {
  it('creates sessions with auto-incrementing seq and getActive routes to the newest', async () => {
    const backend = await withBackend()
    const s1 = backend.sessionChainStore.create(sessionInput())
    expect(s1.seq).toBe(0)
    expect(s1.status).toBe('active')
    const s2 = backend.sessionChainStore.create(sessionInput())
    expect(s2.seq).toBe(1)
    // activeIndex 覆盖语义：getActive 指向最新创建
    expect(backend.sessionChainStore.getActive(CAT_OPUS, 't1')?.id).toBe(s2.id)
  })

  it('reuses an existing record when reuseExistingCliSession is set', async () => {
    const backend = await withBackend()
    const cliSessionId = `cli_${randomUUID().slice(0, 8)}`
    const s1 = backend.sessionChainStore.create(sessionInput({ cliSessionId }))
    const s2 = backend.sessionChainStore.create(sessionInput({ cliSessionId, reuseExistingCliSession: true }))
    expect(s2.id).toBe(s1.id)
  })

  it('getChain sorts by seq and getChainByThread groups all cats by catId', async () => {
    const backend = await withBackend()
    backend.sessionChainStore.create(sessionInput({ catId: CAT_OPUS }))
    backend.sessionChainStore.create(sessionInput({ catId: CAT_OPUS }))
    backend.sessionChainStore.create(sessionInput({ catId: CAT_NEO }))
    const chain = backend.sessionChainStore.getChain(CAT_OPUS, 't1')
    expect(chain.map((s) => s.seq)).toEqual([0, 1])
    const byThread = backend.sessionChainStore.getChainByThread('t1')
    expect(byThread.map((s) => s.catId)).toEqual([CAT_NEO, CAT_OPUS, CAT_OPUS])
  })

  it('walks active→sealing→sealed with null-deletion semantics for sealReason/sealedAt', async () => {
    const backend = await withBackend()
    const session = backend.sessionChainStore.create(sessionInput())
    backend.sessionChainStore.update(session.id, { status: 'sealing' })
    expect(backend.sessionChainStore.listSealingSessions()).toEqual([session.id])
    expect(backend.sessionChainStore.getActive(CAT_OPUS, 't1')).toBeNull()
    const sealed = backend.sessionChainStore.update(session.id, {
      status: 'sealed',
      sealReason: 'threshold',
      sealedAt: 100,
    })
    expect(sealed?.sealReason).toBe('threshold')
    expect(backend.sessionChainStore.listSealingSessions()).toEqual([])
    const cleared = backend.sessionChainStore.update(session.id, { sealReason: null, sealedAt: null })
    expect('sealReason' in (cleared as object)).toBe(false)
    expect('sealedAt' in (cleared as object)).toBe(false)
  })

  it('getByCliSessionId and getByChainKey stay reachable after sealing (F198 write tolerance)', async () => {
    const backend = await withBackend()
    const session = backend.sessionChainStore.create(
      sessionInput({ chainKey: 'bg:t1:opus' }),
    )
    backend.sessionChainStore.update(session.id, { status: 'sealing' })
    backend.sessionChainStore.update(session.id, { status: 'sealed' })
    expect(backend.sessionChainStore.getByCliSessionId(session.cliSessionId)?.id).toBe(session.id)
    expect(backend.sessionChainStore.getByChainKey('bg:t1:opus')?.id).toBe(session.id)
    // a newer record with the same chainKey wins the index (Map覆盖语义)
    const fresh = backend.sessionChainStore.create(
      sessionInput({ chainKey: 'bg:t1:opus', cliSessionId: `cli_${randomUUID().slice(0, 8)}` }),
    )
    expect(backend.sessionChainStore.getByChainKey('bg:t1:opus')?.id).toBe(fresh.id)
  })

  it('incrementCompressionCount works only while active; a sealed session yields null', async () => {
    const backend = await withBackend()
    const session = backend.sessionChainStore.create(sessionInput())
    expect(backend.sessionChainStore.incrementCompressionCount(session.id)).toBe(1)
    expect(backend.sessionChainStore.incrementCompressionCount(session.id)).toBe(2)
    backend.sessionChainStore.update(session.id, { status: 'sealed' })
    expect(backend.sessionChainStore.incrementCompressionCount(session.id)).toBeNull()
    expect(backend.sessionChainStore.incrementCompressionCount('missing')).toBeNull()
  })
})

describe('SqliteDeliveryCursorStore — AC-A9 双命名空间独立', () => {
  it('stores and reads back delivery / seen cursors independently', async () => {
    const backend = await withBackend()
    backend.deliveryCursorStore.setDeliveryCursor(USER_ALICE, CAT_OPUS, THREAD_T1, 'm001')
    expect(backend.deliveryCursorStore.getDeliveryCursor(USER_ALICE, CAT_OPUS, THREAD_T1)).toBe('m001')
    expect(backend.deliveryCursorStore.getSeenCursor(USER_ALICE, CAT_OPUS, THREAD_T1)).toBeNull()
    // 写 seen 不影响 delivery
    backend.deliveryCursorStore.setSeenCursor(USER_ALICE, CAT_OPUS, THREAD_T1, 'm002')
    expect(backend.deliveryCursorStore.getDeliveryCursor(USER_ALICE, CAT_OPUS, THREAD_T1)).toBe('m001')
    expect(backend.deliveryCursorStore.getSeenCursor(USER_ALICE, CAT_OPUS, THREAD_T1)).toBe('m002')
    // 写 delivery 不影响 seen
    backend.deliveryCursorStore.setDeliveryCursor(USER_ALICE, CAT_OPUS, THREAD_T1, 'm003')
    expect(backend.deliveryCursorStore.getSeenCursor(USER_ALICE, CAT_OPUS, THREAD_T1)).toBe('m002')
    // 不同 (user, cat, thread) 互不串扰
    expect(backend.deliveryCursorStore.getDeliveryCursor(USER_ALICE, CAT_NEO, THREAD_T1)).toBeNull()
    expect(backend.deliveryCursorStore.getDeliveryCursor(USER_ALICE, CAT_OPUS, THREAD_T2)).toBeNull()
  })
})

describe('SqliteSummaryStore', () => {
  it('creates summaries with store-owned id and reads them back', async () => {
    const backend = await withBackend()
    const summary = backend.summaryStore.create({
      threadId: 't1',
      topic: 'auth design',
      conclusions: ['use tokens'],
      openQuestions: ['rotation?'],
      createdBy: CAT_OPUS,
    })
    expect(summary.id).toMatch(/^summary_/)
    expect(backend.summaryStore.get(summary.id)?.topic).toBe('auth design')
    expect(backend.summaryStore.get('missing')).toBeNull()
  })

  it('lists by thread in creation order (oldest first)', async () => {
    const backend = await withBackend()
    const a = backend.summaryStore.create({ threadId: 't1', topic: 'a', conclusions: [], openQuestions: [], createdBy: 'user' })
    const b = backend.summaryStore.create({ threadId: 't1', topic: 'b', conclusions: [], openQuestions: [], createdBy: 'user' })
    backend.summaryStore.create({ threadId: 't2', topic: 'other', conclusions: [], openQuestions: [], createdBy: 'user' })
    expect(backend.summaryStore.listByThread('t1').map((s) => s.id)).toEqual([a.id, b.id])
  })

  it('deletes summaries and reports whether the row existed', async () => {
    const backend = await withBackend()
    const summary = backend.summaryStore.create({
      threadId: 't1', topic: 'x', conclusions: [], openQuestions: [], createdBy: 'system',
    })
    expect(backend.summaryStore.delete(summary.id)).toBe(true)
    expect(backend.summaryStore.delete(summary.id)).toBe(false)
  })
})

describe('持久化往返 — 文件 db', () => {
  it('survives dispose → reopen with all nine stores intact', async () => {
    const dbPath = resolve(tmpdir(), `cats-stores-sqlite-test-${randomUUID()}.db`)
    const ids: Record<string, string> = {}
    try {
      // Phase 1: write through a file-backed backend, then dispose.
      {
        const backend = await withBackend(dbPath)
        const msg = backend.messageStore.append(messageInput({ threadId: 't1', content: 'durable' }) as never)
        const thread = backend.threadStore.create({ userId: 'alice', title: 'durable thread' })
        const task = backend.taskStore.create({
          threadId: 't1', userId: 'alice', catId: CAT_OPUS, title: 'durable task', status: 'todo', kind: 'work',
        })
        const backlog = backend.backlogStore.create({
          userId: 'alice', title: 'b', summary: 's', priority: 'p2', tags: [], status: 'open', createdBy: 'user',
        } as never)
        const memory = backend.memoryStore.create({ catId: CAT_OPUS, kind: 'fact', content: 'durable memory', importance: 1 } as never)
        const invocationId = unwrapCreated(
          backend.invocationRecordStore.create(invocationInput({ idempotencyKey: 'persist-1' })),
        )
        const session = backend.sessionChainStore.create(sessionInput({ chainKey: 'bg:t1:opus' }))
        backend.deliveryCursorStore.setDeliveryCursor(USER_ALICE, CAT_OPUS, THREAD_T1, 'm-durable')
        const summary = backend.summaryStore.create({
          threadId: 't1', topic: 'durable summary', conclusions: [], openQuestions: [], createdBy: 'user',
        })
        backend.invocationRecordStore.update({ invocationId, status: 'running' })
        backend.sessionChainStore.update(session.id, { status: 'sealing' })

        while (fibers.length) {
          await fibers.pop()!.dispose()
        }
        Object.assign(ids, {
          msgId: msg.id, threadId: thread.id, taskId: task.id, backlogId: backlog.id,
          memoryId: memory.id, invocationId, sessionId: session.id, summaryId: summary.id,
        })
      }

      // Phase 2: reopen the same file and verify every store round-trips.
      const backend = await withBackend(dbPath)
      expect(backend.messageStore.getById(ids.msgId!)?.content).toBe('durable')
      expect(backend.threadStore.getById(ids.threadId!)?.title).toBe('durable thread')
      expect(backend.taskStore.getById(ids.taskId!)?.title).toBe('durable task')
      expect(backend.backlogStore.getById(ids.backlogId!)).not.toBeNull()
      expect(backend.memoryStore.getById(ids.memoryId!)?.content).toBe('durable memory')
      expect(backend.invocationRecordStore.get(ids.invocationId! as never)?.status).toBe('running')
      expect(backend.sessionChainStore.get(ids.sessionId!)?.status).toBe('sealing')
      expect(backend.sessionChainStore.getByChainKey('bg:t1:opus')?.id).toBe(ids.sessionId)
      expect(backend.deliveryCursorStore.getDeliveryCursor(USER_ALICE, CAT_OPUS, THREAD_T1)).toBe('m-durable')
      expect(backend.summaryStore.get(ids.summaryId!)?.topic).toBe('durable summary')
      // 幂等索引也持久化：同 key 重新 create 仍然 dedup 指向既有记录
      const dedup = backend.invocationRecordStore.create(invocationInput({ idempotencyKey: 'persist-1' }))
      expect(dedup.outcome).toBe('deduped')
    } finally {
      // Windows: close the reopened database (dispose fibers) before deleting
      // the file, or rmSync fails with EPERM on a held handle.
      while (fibers.length) {
        await fibers.pop()!.dispose()
      }
      rmSync(dbPath, { force: true })
      rmSync(`${dbPath}-wal`, { force: true })
      rmSync(`${dbPath}-shm`, { force: true })
    }
  })
})
