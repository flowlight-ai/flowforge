/**
 * SessionHooksService — F24/F33 session hooks 服务契约验证（阶段5 批次6，T5.4.3）。
 *
 * 覆盖（对齐 clowder-ai `routes/session-hooks.ts` 语义）：
 * - sealByCliSessionId：PreCompact 触发 strategy-aware seal（handoff 直 seal /
 *   compress 只记压缩 / hybrid 达上限后 seal）
 * - latestDigest：active 压缩历史 → continuity；否则最近 sealed session 摘要
 * - setSopBookmark / getSopBookmark：F073 P4 in-process bookmark
 * - 错误面：SessionHooksError 404/409 语义
 *
 * @module @flowforge/chat-session-chain/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createThreadId } from '@flowforge/cats-shared'
import type { SessionRecord } from '@flowforge/cats-shared'
import { SessionHooksError, SessionHooksService } from '../src/index.ts'

const CAT_A = createCatId('cat_a')
const T1 = createThreadId('t1')

interface Harness {
  ctx: Context
  hooks: SessionHooksService
}

function harness(
  sessions: SessionRecord[],
  opts: {
    getStrategy?: (catId: string) => { strategy: 'handoff' | 'compress' | 'hybrid'; hybrid?: { maxCompressions: number } }
  } = {},
): Harness {
  const ctx = new Context()
  const hooks = new SessionHooksService(ctx, {
    store: {
      getByCliSessionId: (id) => sessions.find((s) => s.cliSessionId === id) ?? null,
      getChain: (_catId, _threadId) => sessions.filter((s) => s.threadId === _threadId),
      get: (id) => sessions.find((s) => s.id === id) ?? null,
      incrementCompressionCount: (id) => {
        const s = sessions.find((x) => x.id === id)
        if (!s || s.status !== 'active') return null
        s.compressionCount = (s.compressionCount ?? 0) + 1
        return s.compressionCount
      },
    },
    sealer: {
      requestSeal: async (sessionId: string, reason: string) => {
        const s = sessions.find((x) => x.id === sessionId)
        if (!s || s.status !== 'active') return { accepted: false }
        s.status = 'sealing'
        s.sealReason = reason as NonNullable<SessionRecord['sealReason']>
        return { accepted: true }
      },
    },
  })
  // strategy 经 ctx.chatSessionStrategy 解析；测试直接注入 fake。
  ctx.provide('chatSessionStrategy', { get: (catId: string) => opts.getStrategy?.(catId) ?? { strategy: 'handoff' } })
  return { ctx, hooks }
}

function activeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    cliSessionId: 'cli-1',
    threadId: T1,
    catId: CAT_A,
    userId: 'alice',
    seq: 0,
    status: 'active',
    messageCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('SessionHooksService — sealByCliSessionId (strategy-aware)', () => {
  it('seals immediately for the default handoff strategy', async () => {
    const sessions = [activeSession()]
    const h = harness(sessions)
    const result = await h.hooks.sealByCliSessionId('cli-1', 'threshold')
    expect(result.action).toBe('sealed')
    if (result.action !== 'sealed') return
    expect(result.sessionId).toBe('s1')
    expect(result.status).toBe('sealing')
    expect(sessions[0]?.status).toBe('sealing')
    expect(sessions[0]?.sealReason).toBe('threshold')
  })

  it('never seals for the compress strategy — only records compression', async () => {
    const sessions = [activeSession()]
    const h = harness(sessions, { getStrategy: () => ({ strategy: 'compress' }) })
    const result = await h.hooks.sealByCliSessionId('cli-1', 'threshold')
    expect(result.action).toBe('compress_allowed')
    if (result.action !== 'compress_allowed') return
    expect(result.strategy).toBe('compress')
    expect(result.compressionCount).toBe(1)
    expect(sessions[0]?.status).toBe('active')
  })

  it('hybrid allows compression until max, then seals with max_compressions reason', async () => {
    const sessions = [activeSession()]
    const h = harness(sessions, {
      getStrategy: () => ({ strategy: 'hybrid', hybrid: { maxCompressions: 2 } }),
    })
    const first = await h.hooks.sealByCliSessionId('cli-1', 'threshold')
    expect(first.action).toBe('compress_allowed')
    if (first.action !== 'compress_allowed') return
    expect(first.maxCompressions).toBe(2)
    expect(first.compressionCount).toBe(1)

    const second = await h.hooks.sealByCliSessionId('cli-1', 'threshold')
    expect(second.action).toBe('compress_allowed')
    if (second.action !== 'compress_allowed') return
    expect(second.compressionCount).toBe(2)

    const third = await h.hooks.sealByCliSessionId('cli-1', 'threshold')
    expect(third.action).toBe('sealed')
    if (third.action !== 'sealed') return
    expect(sessions[0]?.sealReason).toBe('max_compressions')
  })

  it('throws 404 when no session matches the CLI session id', async () => {
    const h = harness([activeSession()])
    await expect(h.hooks.sealByCliSessionId('nope', 'threshold')).rejects.toMatchObject({ status: 404 })
  })

  it('throws 409 when the session is not active', async () => {
    const h = harness([activeSession({ status: 'sealed' })])
    await expect(h.hooks.sealByCliSessionId('cli-1', 'threshold')).rejects.toMatchObject({ status: 409 })
  })
})

describe('SessionHooksService — latestDigest', () => {
  it('returns active continuity when the active session has compression history', async () => {
    const sessions = [activeSession({ compressionCount: 2 })]
    const h = harness(sessions)
    const result = await h.hooks.latestDigest('cli-1')
    expect(result.sessionId).toBe('s1')
    expect(result.status).toBe('active')
    expect(result.seq).toBe(0)
  })

  it('returns the most recent sealed session digest as fallback', async () => {
    const sessions = [
      activeSession({ id: 's_old', cliSessionId: 'cli-old', status: 'sealed', seq: 0, sealedAt: 100 }),
      activeSession({ id: 's_new', cliSessionId: 'cli-1', status: 'sealed', seq: 1, sealedAt: 200 }),
    ]
    const h = harness(sessions)
    const result = await h.hooks.latestDigest('cli-1')
    expect(result.sessionId).toBe('s_new')
    expect(result.status).toBe('sealed')
  })

  it('throws 404 when no sealed session exists', async () => {
    const h = harness([activeSession()])
    await expect(h.hooks.latestDigest('cli-1')).rejects.toMatchObject({ status: 404 })
  })
})

describe('SessionHooksService — SOP bookmarks (F073 P4)', () => {
  it('sets and reads a bookmark for the CLI session', () => {
    const h = harness([activeSession()])
    const set = h.hooks.setSopBookmark('cli-1', 'skill-1', 'stage-2')
    expect(set).toEqual({ ok: true })
    const got = h.hooks.getSopBookmark('cli-1')
    expect(got.skill).toBe('skill-1')
    expect(got.sopStage).toBe('stage-2')
  })

  it('throws 404 when no bookmark exists', () => {
    const h = harness([activeSession()])
    expect(() => h.hooks.getSopBookmark('cli-1')).toThrow(SessionHooksError)
    try {
      h.hooks.getSopBookmark('cli-1')
    } catch (err) {
      expect((err as SessionHooksError).status).toBe(404)
    }
  })
})
