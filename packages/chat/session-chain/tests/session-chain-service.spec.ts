/**
 * SessionChainService — F24 会话链管理服务契约验证（阶段5 批次6，T5.4.1）。
 *
 * 覆盖（对齐 clowder-ai `routes/session-chain.ts` 语义）：
 * - listSessions：thread 内按 cat 的会话血统列表（可选 catId 过滤 + 可见性过滤）
 * - getSession：单 session 记录（404/403 语义）
 * - unsealSession：#F062 手动解封（already_active / sealed 重开 / active 冲突保护 /
 *   空 active 位移）
 * - bindCliSession：#72 手动绑定 CLI session ID（active 更新 / 无则新建 / 越权）
 *
 * @module @flowforge/chat-session-chain/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { ChatSessionChainError, SessionChainService } from '../src/index.ts'

const ALICE = createUserId('alice')
const BOB = createUserId('bob')
const CAT_A = createCatId('cat_a')
const CAT_B = createCatId('cat_b')

interface Harness {
  ctx: Context
  chain: SessionChainService
  backend: MemoryStoresBackend
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const chain = new SessionChainService(ctx)
  return { ctx, chain, backend }
}

/** Seed a thread owned by `userId` and return its id. */
function seedThread(backend: MemoryStoresBackend, userId: string): string {
  return backend.threadStore.create({ userId, title: '对话' }).id
}

describe('SessionChainService — listSessions', () => {
  it('lists the session lineage for a thread when catId is given', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    h.backend.sessionChainStore.create({ cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE })
    h.backend.sessionChainStore.create({ cliSessionId: 'cli-2', threadId, catId: CAT_A, userId: ALICE })
    const sessions = await h.chain.listSessions({ threadId, userId: ALICE, catId: CAT_A })
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.seq)).toEqual([0, 1])
    expect(sessions.every((s) => s.catId === CAT_A)).toBe(true)
  })

  it('lists all cats’ sessions for a thread when catId is omitted', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    h.backend.sessionChainStore.create({ cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE })
    h.backend.sessionChainStore.create({ cliSessionId: 'cli-2', threadId, catId: CAT_B, userId: ALICE })
    const sessions = await h.chain.listSessions({ threadId, userId: ALICE })
    expect(sessions).toHaveLength(2)
  })

  it('rejects a user who cannot access the thread', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await expect(
      h.chain.listSessions({ threadId, userId: BOB }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  it('applies the filterVisible option (shared-thread semantics)', async () => {
    const ctx = new Context()
    new CatStores(ctx)
    const backend = new MemoryStoresBackend(ctx)
    const chain = new SessionChainService(ctx, {
      filterVisible: (sessions, userId) => sessions.filter((s) => s.userId === userId),
    })
    const threadId = seedThread(backend, ALICE)
    backend.sessionChainStore.create({ cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE })
    backend.sessionChainStore.create({ cliSessionId: 'cli-2', threadId, catId: CAT_A, userId: BOB })
    const sessions = await chain.listSessions({ threadId, userId: ALICE, catId: CAT_A })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.userId).toBe(ALICE)
  })
})

describe('SessionChainService — getSession', () => {
  it('returns the session record', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const session = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })
    const got = await h.chain.getSession(session.id, ALICE)
    expect(got.id).toBe(session.id)
  })

  it('throws 404 when the session does not exist', async () => {
    const h = harness()
    await expect(h.chain.getSession('nope', ALICE)).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
      status: 404,
    })
  })

  it('throws 403 for a non-owner on a private thread', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const session = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })
    await expect(h.chain.getSession(session.id, BOB)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
  })
})

describe('SessionChainService — unsealSession (#F062)', () => {
  it('returns already_active when the session is already active', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const session = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })
    const result = await h.chain.unsealSession(session.id, ALICE)
    expect(result.mode).toBe('already_active')
  })

  it('reopens a sealed session as a fresh active chain record', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const session = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })
    h.backend.sessionChainStore.update(session.id, {
      status: 'sealed', sealReason: 'manual', sealedAt: Date.now(), updatedAt: Date.now(),
    })
    const result = await h.chain.unsealSession(session.id, ALICE)
    expect(result.mode).toBe('reopened')
    expect(result.fromSessionId).toBe(session.id)
    expect(result.session?.status).toBe('active')
    expect(result.session?.cliSessionId).toBe('cli-1')
  })

  it('refuses to reopen when another non-empty active session exists', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    // 已封存 session
    const sealed = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })
    h.backend.sessionChainStore.update(sealed.id, {
      status: 'sealed', sealReason: 'manual', sealedAt: Date.now(), updatedAt: Date.now(),
    })
    // 非空 active session（真实工作，拒绝摧毁）
    const active = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-2', threadId, catId: CAT_A, userId: ALICE,
    })
    h.backend.sessionChainStore.update(active.id, { messageCount: 3, updatedAt: Date.now() })
    await expect(h.chain.unsealSession(sealed.id, ALICE)).rejects.toMatchObject({
      code: 'ACTIVE_SESSION_EXISTS',
      status: 409,
    })
  })

  it('displaces an empty active session via direct seal (no sealer mounted)', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const sealed = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })
    h.backend.sessionChainStore.update(sealed.id, {
      status: 'sealed', sealReason: 'manual', sealedAt: Date.now(), updatedAt: Date.now(),
    })
    // 空 active（messageCount 0，如 auto-seal 创建的占位）→ 允许位移
    h.backend.sessionChainStore.create({ cliSessionId: 'cli-2', threadId, catId: CAT_A, userId: ALICE })
    const result = await h.chain.unsealSession(sealed.id, ALICE)
    expect(result.mode).toBe('reopened')
    const displaced = h.backend.sessionChainStore.getActive(CAT_A, threadId)
    expect(displaced?.id).toBe(result.session?.id)
  })
})

describe('SessionChainService — bindCliSession (#72)', () => {
  it('updates the cliSessionId on an existing active session', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const session = h.backend.sessionChainStore.create({
      cliSessionId: 'cli-1', threadId, catId: CAT_A, userId: ALICE,
    })
    const result = await h.chain.bindCliSession({
      threadId, catId: CAT_A, cliSessionId: 'cli-new', userId: ALICE,
    })
    expect(result.mode).toBe('updated')
    expect(result.session.id).toBe(session.id)
    expect(result.session.cliSessionId).toBe('cli-new')
  })

  it('creates a new session when no active session exists', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    const result = await h.chain.bindCliSession({
      threadId, catId: CAT_A, cliSessionId: 'cli-new', userId: ALICE,
    })
    expect(result.mode).toBe('created')
    expect(result.session.status).toBe('active')
    expect(result.session.cliSessionId).toBe('cli-new')
  })

  it('throws 404 when the thread does not exist', async () => {
    const h = harness()
    await expect(
      h.chain.bindCliSession({ threadId: 'nope', catId: CAT_A, cliSessionId: 'x', userId: ALICE }),
    ).rejects.toMatchObject({ code: 'THREAD_NOT_FOUND', status: 404 })
  })

  it('throws 403 when the user cannot access the thread', async () => {
    const h = harness()
    const threadId = seedThread(h.backend, ALICE)
    await expect(
      h.chain.bindCliSession({ threadId, catId: CAT_A, cliSessionId: 'x', userId: BOB }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  it('is an instance of the error class for typed handling', () => {
    const err = new ChatSessionChainError('FORBIDDEN', 'test', 403)
    expect(err).toBeInstanceOf(ChatSessionChainError)
    expect(err.code).toBe('FORBIDDEN')
    expect(err.status).toBe(403)
  })
})
