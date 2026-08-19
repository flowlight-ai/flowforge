/**
 * @flowforge/cats-session — unit tests for the batch-6.4 SessionSealerService
 * (active → sealing → sealed lifecycle Cordis service) plus the ported
 * pure-function modules (thread-memory / decision-signals / artifacts /
 * handoff digest).
 *
 * 对齐 dsh 测试风格：Cordis 服务经 `await ctx.plugin(Class, options)` 挂载到
 * `new Context()`，afterEach 逐个 dispose fiber；dataDir / auditDir 用
 * `os.tmpdir() + randomUUID()` 隔离目录。会话链状态走 `ctx.catStores`
 * （Memory 后端），审计走 `ctx.catsAudit`（EventAuditLogService）。
 *
 * @module @flowforge/cats-session/tests
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { AuditEventTypes, createCatId, type SessionRecord } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend, type ISessionChainStore } from '@flowforge/cats-stores'
import { EventAuditLogService } from '@flowforge/cats-orchestration'
import Plugin, {
  SessionSealerService,
  TranscriptReaderService,
  TranscriptWriterService,
  buildThreadMemory,
  extractDecisionSignals,
  extractRecentArtifacts,
  generateHandoffDigest,
  type ExtractiveDigestV1,
  type SessionSealerOptions,
  type ThreadMemoryV1,
  type TranscriptSessionInfo,
} from '../src/index.ts'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const CAT_SEAL = createCatId('cat_seal')
const CAT_OTHER = createCatId('cat_other')
const USER = 'user_1'
const THREAD = 'thread_seal'

const tmpRoot = mkdtempSync(join(tmpdir(), 'flowforge-cats-sealer-'))
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

/**
 * Track plugin fibers so each test tears down cleanly. Cordis disposal is via
 * `Fiber.dispose()` returned by `ctx.plugin()`, not `ctx.dispose()`.
 */
const fibers: Array<{ dispose: () => Promise<void> | void }> = []
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!
    await fiber.dispose()
  }
})

interface SealerHarness {
  ctx: Context
  sealer: SessionSealerService
  writer: TranscriptWriterService
  reader: TranscriptReaderService
  store: ISessionChainStore
  audit: EventAuditLogService
}

/** Mount stores + audit + writer + reader + sealer sharing isolated dirs. */
async function mountSealer(options?: SessionSealerOptions): Promise<SealerHarness> {
  const ctx = new Context()
  new CatStores(ctx)
  new MemoryStoresBackend(ctx)
  const audit = new EventAuditLogService(ctx, { auditDir: join(tmpRoot, `audit-${randomUUID()}`) })
  const dataDir = join(tmpRoot, randomUUID())
  fibers.push((await ctx.plugin(TranscriptWriterService, { dataDir })) as unknown as { dispose: () => Promise<void> | void })
  fibers.push((await ctx.plugin(TranscriptReaderService, { dataDir })) as unknown as { dispose: () => Promise<void> | void })
  fibers.push(
    (await ctx.plugin(SessionSealerService, options ?? {})) as unknown as { dispose: () => Promise<void> | void },
  )
  return {
    ctx,
    sealer: ctx.catsSessionSealer,
    writer: ctx.catsTranscriptWriter,
    reader: ctx.catsTranscriptReader,
    store: ctx.catStores.sessionChains(),
    audit,
  }
}

/** Mount stores + audit + sealer ONLY (no transcript writer/reader). */
async function mountBareSealer(): Promise<{ ctx: Context; sealer: SessionSealerService; store: ISessionChainStore }> {
  const ctx = new Context()
  new CatStores(ctx)
  new MemoryStoresBackend(ctx)
  new EventAuditLogService(ctx, { auditDir: join(tmpRoot, `audit-${randomUUID()}`) })
  fibers.push((await ctx.plugin(SessionSealerService)) as unknown as { dispose: () => Promise<void> | void })
  return { ctx, sealer: ctx.catsSessionSealer, store: ctx.catStores.sessionChains() }
}

function createSession(h: { store: ISessionChainStore }, catId = CAT_SEAL, threadId = THREAD): SessionRecord {
  const suffix = randomUUID().slice(0, 8)
  const record = h.store.create({
    cliSessionId: `cli_${suffix}`,
    threadId,
    catId,
    userId: USER,
  })
  // Memory backend is synchronous; narrow the sync-or-async union (see
  // orchestration.spec.ts seedMessage for the same convention).
  return record as SessionRecord
}

function sessionInfo(record: SessionRecord): TranscriptSessionInfo {
  return {
    sessionId: record.id,
    threadId: record.threadId,
    catId: record.catId,
    cliSessionId: record.cliSessionId,
    seq: record.seq,
  }
}

/** The sealer appends audit events fire-and-forget; let them drain before reading. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Thread-memory capability patch target (flowforge IThreadStore lacks the contract). */
interface ThreadMemoryCapable {
  getThreadMemory(threadId: string): ThreadMemoryV1 | null
  updateThreadMemory(threadId: string, memory: ThreadMemoryV1): void
}

// ---------------------------------------------------------------------------
// requestSeal — CAS 快路径（active → sealing）
// ---------------------------------------------------------------------------

describe('SessionSealerService.requestSeal', () => {
  it('transitions an active session to sealing and returns the accepted result', async () => {
    const h = await mountSealer()
    const record = createSession(h)

    const result = await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    expect(result).toEqual({ accepted: true, status: 'sealing', sessionId: record.id })

    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealing')
    expect(after?.sealReason).toBe('threshold')
  })

  it('rejects an unknown session id without throwing', async () => {
    const h = await mountSealer()
    const result = await h.sealer.requestSeal({ sessionId: 'sess_missing', reason: 'manual' })
    expect(result).toEqual({ accepted: false, status: 'sealed' })
  })

  it('is idempotent: a second request on a sealing session is rejected with the live status', async () => {
    const h = await mountSealer()
    const record = createSession(h)

    const first = await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    expect(first.accepted).toBe(true)

    const second = await h.sealer.requestSeal({ sessionId: record.id, reason: 'manual' })
    expect(second).toEqual({ accepted: false, status: 'sealing' })
    // the second attempt must not overwrite the first reason
    const after = await h.store.get(record.id)
    expect(after?.sealReason).toBe('threshold')
  })

  it('rejects an already sealed session', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    const result = await h.sealer.requestSeal({ sessionId: record.id, reason: 'manual' })
    expect(result).toEqual({ accepted: false, status: 'sealed' })
  })

  it('emits a SEAL_REQUESTED audit event with the session payload', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await sleep(100)

    const events = await h.audit.readByType(AuditEventTypes.SEAL_REQUESTED)
    const hit = events.find((e) => (e.data as { sessionId?: string }).sessionId === record.id)
    expect(hit).toBeDefined()
    expect(hit?.threadId).toBe(THREAD)
    expect((hit?.data as { catId?: string; reason?: string; seq?: number })).toMatchObject({
      catId: CAT_SEAL,
      reason: 'threshold',
      seq: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// finalize — 慢路径（transcript flush + 终态 sealed）
// ---------------------------------------------------------------------------

describe('SessionSealerService.finalize', () => {
  it('flushes the transcript artifacts and transitions sealing → sealed', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: 'sealer flush message' }, 'inv_seal')

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealed')
    expect(after?.sealedAt).toBeGreaterThan(0)
    expect(after?.updatedAt).toBe(after?.sealedAt)

    const dir = h.reader.getSessionDir(record.threadId, record.catId, record.id)
    expect(existsSync(join(dir, 'events.jsonl'))).toBe(true)
    expect(existsSync(join(dir, 'digest.extractive.json'))).toBe(true)
    const digest = JSON.parse(readFileSync(join(dir, 'digest.extractive.json'), 'utf-8')) as ExtractiveDigestV1
    expect(digest.sessionId).toBe(record.id)
    expect(digest.sealReason).toBe('threshold')
  })

  it('emits SEAL_FINALIZED (clean) audit events after a successful seal', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: 'audit me' })

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })
    await sleep(100)

    const events = await h.audit.readByType(AuditEventTypes.SEAL_FINALIZED)
    const hit = events.find((e) => (e.data as { sessionId?: string }).sessionId === record.id)
    expect(hit).toBeDefined()
    expect((hit?.data as { catId?: string; reason?: string }).reason).toBe('threshold')
  })

  it('is a no-op for a session that is still active', async () => {
    const h = await mountSealer()
    const record = createSession(h)

    await h.sealer.finalize({ sessionId: record.id })
    const after = await h.store.get(record.id)
    expect(after?.status).toBe('active')
  })

  it('is a no-op for an unknown session id without throwing', async () => {
    const h = await mountSealer()
    await expect(h.sealer.finalize({ sessionId: 'sess_missing' })).resolves.toBeUndefined()
  })

  it('still reaches the sealed terminal state when the transcript flush fails', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: 'doomed buffer' })

    // Fault injection: make flush throw (best-effort contract — seal anyway).
    const writer = h.writer as unknown as { flush: () => Promise<void> }
    writer.flush = async () => {
      throw new Error('disk full')
    }

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'error' })
    await h.sealer.finalize({ sessionId: record.id })

    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealed')
    expect(after?.sealReason).toBe('error')

    await sleep(100)
    // clowder parity: an internal flush error is caught inside doFinalize
    // (partial seal) — it does NOT throw, so no SEAL_FINALIZE_FAILED audit
    // event is emitted, and partial seals skip SEAL_FINALIZED as well.
    const failed = await h.audit.readByType(AuditEventTypes.SEAL_FINALIZE_FAILED)
    expect(failed.some((e) => (e.data as { sessionId?: string }).sessionId === record.id)).toBe(false)
    const finalized = await h.audit.readByType(AuditEventTypes.SEAL_FINALIZED)
    expect(finalized.some((e) => (e.data as { sessionId?: string }).sessionId === record.id)).toBe(false)
  })

  it('fires post-seal hooks after the terminal write with the full event payload', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    const seen: Array<{ sessionId: string; catId: string; threadId: string; ownerUserId: string; sealReason: string }> = []
    h.sealer.registerPostSealHook(async (event) => {
      seen.push(event)
    })

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      sessionId: record.id,
      catId: CAT_SEAL,
      threadId: THREAD,
      ownerUserId: USER,
      sealReason: 'threshold',
    })
  })

  it('a failing post-seal hook is best-effort: the seal completes and later hooks still run', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    const calls: string[] = []
    h.sealer.registerPostSealHook(async () => {
      calls.push('boom')
      throw new Error('hook exploded')
    })
    h.sealer.registerPostSealHook(async () => {
      calls.push('ok')
    })

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'manual' })
    await h.sealer.finalize({ sessionId: record.id })

    expect(calls).toEqual(['boom', 'ok'])
    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealed')
  })

  it('updates thread memory when the thread store exposes the capability', async () => {
    const h = await mountSealer()
    const threads = h.ctx.catStores.threads() as unknown as ThreadMemoryCapable
    const memories = new Map<string, ThreadMemoryV1>()
    threads.getThreadMemory = (threadId: string) => memories.get(threadId) ?? null
    threads.updateThreadMemory = (threadId: string, memory: ThreadMemoryV1) => {
      memories.set(threadId, memory)
    }

    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: '决定采用 zod v4 统一校验方案' }, 'inv_mem')

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    const memory = memories.get(record.threadId)
    expect(memory).toBeDefined()
    expect(memory!.v).toBe(1)
    expect(memory!.sessionsIncorporated).toBe(1)
    expect(memory!.summary).toContain('Session #1')
    // VG-3: decision signal extracted from the transcript text
    expect(memory!.decisions?.some((d) => d.includes('决定采用 zod v4'))).toBe(true)
  })

  it('skips thread memory silently when the backend lacks the capability', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: 'plain message' })

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    // MemoryThreadStore has no getThreadMemory — seal still completes.
    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealed')
  })
})

// ---------------------------------------------------------------------------
// F065 Phase C — handoff digest（注入 fetchFn 的 generative 分支）
// ---------------------------------------------------------------------------

describe('SessionSealerService handoff digest', () => {
  const HANDOFF_BODY = '## Session Summary\n- decided the thing'

  function mockFetch(log: Array<{ url: string; body: string }>): typeof fetch {
    return ((_input: unknown, init?: { body?: unknown }) => {
      log.push({ url: String(_input), body: String(init?.body ?? '') })
      return Promise.resolve(
        new Response(JSON.stringify({ content: [{ type: 'text', text: HANDOFF_BODY }] }), { status: 200 }),
      )
    }) as unknown as typeof fetch
  }

  it('generative depth calls the profile LLM and persists digest.handoff.md', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const h = await mountSealer({
      handoffConfig: {
        getBootstrapDepth: () => 'generative',
        resolveProfile: async () => ({ apiKey: 'test-key', baseUrl: 'http://mock.internal' }),
        fetchFn: mockFetch(calls),
      },
    })
    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: 'handoff relevant message' }, 'inv_h')

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://mock.internal/v1/messages')
    const payload = JSON.parse(calls[0]!.body) as { system: string; messages: Array<{ role: string; content: string }> }
    expect(payload.system).toContain('session scribe')
    expect(payload.messages[0]!.content).toContain('handoff relevant message')

    const dir = h.reader.getSessionDir(record.threadId, record.catId, record.id)
    const handoff = readFileSync(join(dir, 'digest.handoff.md'), 'utf-8')
    expect(handoff).toContain('---\nv: 1\n')
    expect(handoff).toContain(HANDOFF_BODY)
  })

  it('extractive depth skips the LLM call entirely', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const h = await mountSealer({
      handoffConfig: {
        getBootstrapDepth: () => 'extractive',
        resolveProfile: async () => ({ apiKey: 'test-key', baseUrl: 'http://mock.internal' }),
        fetchFn: mockFetch(calls),
      },
    })
    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: 'no llm needed' })

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    expect(calls).toHaveLength(0)
    const dir = h.reader.getSessionDir(record.threadId, record.catId, record.id)
    expect(existsSync(join(dir, 'digest.handoff.md'))).toBe(false)
  })

  it('skips the LLM when no profile resolves (fail-open)', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const h = await mountSealer({
      handoffConfig: {
        getBootstrapDepth: () => 'generative',
        resolveProfile: async () => null,
        fetchFn: mockFetch(calls),
      },
    })
    const record = createSession(h)
    h.writer.appendEvent(sessionInfo(record), { type: 'text', content: 'profileless' })

    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    expect(calls).toHaveLength(0)
    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealed')
  })
})

// ---------------------------------------------------------------------------
// F118 — stuck sealing reconciliation（卡死回收）
// ---------------------------------------------------------------------------

describe('SessionSealerService.reconcileStuck / reconcileAllStuck', () => {
  it('force-seals sessions stuck in sealing beyond maxAgeMs', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    // Backdate the sealing transition to simulate a crashed finalize.
    await h.store.update(record.id, { updatedAt: Date.now() - 10 * 60_000 })

    const count = await h.sealer.reconcileStuck(CAT_SEAL, THREAD, 5 * 60_000)
    expect(count).toBe(1)

    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealed')
    expect(after?.sealReason).toBe('reconcile_stuck')
    expect(after?.sealedAt).toBeGreaterThan(0)
  })

  it('leaves fresh sealing sessions alone', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })

    const count = await h.sealer.reconcileStuck(CAT_SEAL, THREAD, 5 * 60_000)
    expect(count).toBe(0)

    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealing')
  })

  it('reconcileAllStuck sweeps stuck sessions across cats and threads', async () => {
    const h = await mountSealer()
    const stuckA = createSession(h, CAT_SEAL, THREAD)
    const stuckB = createSession(h, CAT_OTHER, 'thread_other')
    const active = createSession(h, CAT_SEAL, 'thread_third')
    for (const record of [stuckA, stuckB]) {
      await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
      await h.store.update(record.id, { updatedAt: Date.now() - 10 * 60_000 })
    }

    const count = await h.sealer.reconcileAllStuck(5 * 60_000)
    expect(count).toBe(2)

    expect((await h.store.get(stuckA.id))?.status).toBe('sealed')
    expect((await h.store.get(stuckB.id))?.sealReason).toBe('global_reaper')
    // active sessions are never touched by the reaper
    expect((await h.store.get(active.id))?.status).toBe('active')
  })

  it('reconcileAllStuck returns 0 when nothing is sealing', async () => {
    const h = await mountSealer()
    const record = createSession(h)
    await h.sealer.requestSeal({ sessionId: record.id, reason: 'threshold' })
    await h.sealer.finalize({ sessionId: record.id })

    expect(await h.sealer.reconcileAllStuck(5 * 60_000)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 挂载形态 — 单独挂载 + 默认 Plugin
// ---------------------------------------------------------------------------

describe('SessionSealerService mounting', () => {
  it('seals gracefully without the transcript writer/reader mounted', async () => {
    const h = await mountBareSealer()
    const record = createSession(h)

    const seal = await h.sealer.requestSeal({ sessionId: record.id, reason: 'manual' })
    expect(seal.accepted).toBe(true)
    await h.sealer.finalize({ sessionId: record.id })

    const after = await h.store.get(record.id)
    expect(after?.status).toBe('sealed')
  })

  it('default plugin mounts writer + reader + sealer on one context', async () => {
    const envDir = join(tmpRoot, `env-${randomUUID()}`)
    process.env.CATS_TRANSCRIPT_DIR = envDir
    try {
      const ctx = new Context()
      new CatStores(ctx)
      new MemoryStoresBackend(ctx)
      new EventAuditLogService(ctx, { auditDir: join(tmpRoot, `audit-${randomUUID()}`) })
      fibers.push((await ctx.plugin(Plugin)) as unknown as { dispose: () => Promise<void> | void })

      expect(ctx.catsTranscriptWriter).toBeInstanceOf(TranscriptWriterService)
      expect(ctx.catsTranscriptReader).toBeInstanceOf(TranscriptReaderService)
      expect(ctx.catsSessionSealer).toBeInstanceOf(SessionSealerService)
    } finally {
      delete process.env.CATS_TRANSCRIPT_DIR
    }
  })
})

// ---------------------------------------------------------------------------
// 纯函数移植 — buildThreadMemory / extractDecisionSignals / extractRecentArtifacts
// ---------------------------------------------------------------------------

function makeDigest(overrides?: { seq?: number; summaryLine?: string }): ExtractiveDigestV1 {
  return {
    v: 1,
    sessionId: 'sess_pure',
    threadId: THREAD,
    catId: CAT_SEAL,
    seq: overrides?.seq ?? 0,
    time: { createdAt: 1_000, sealedAt: 61_000 },
    invocations: [{ invocationId: 'inv_p', toolNames: ['Write'] }],
    filesTouched: [{ path: 'src/a.ts', ops: ['create'] }],
    errors: [],
  }
}

describe('buildThreadMemory (pure)', () => {
  it('prepends the new session line and increments sessionsIncorporated', () => {
    const memory = buildThreadMemory(null, makeDigest(), 3000, undefined, undefined)
    expect(memory.v).toBe(1)
    expect(memory.sessionsIncorporated).toBe(1)
    expect(memory.summary).toContain('Session #1')
    expect(memory.summary).toContain('Created: src/a.ts')
  })

  it('merges signals and carries forward caps across seals', () => {
    const first = buildThreadMemory(null, makeDigest(), 3000, {
      decisions: ['决定采用方案 A'],
      openQuestions: ['是否需要灰度？'],
      artifacts: ['F065'],
    }, undefined)
    expect(first.decisions).toEqual(['决定采用方案 A'])
    expect(first.openQuestions).toEqual(['是否需要灰度？'])
    expect(first.artifacts).toEqual(['F065'])

    // Second seal: existing signals survive when extraction yields nothing.
    const second = buildThreadMemory(first, { ...makeDigest(), seq: 1 }, 3000, undefined, undefined)
    expect(second.sessionsIncorporated).toBe(2)
    expect(second.decisions).toEqual(['决定采用方案 A'])
    expect(second.summary.split('\n')).toHaveLength(2)
  })

  it('trims oldest session lines when the token budget is exceeded', () => {
    let memory: ThreadMemoryV1 | null = null
    for (let i = 0; i < 6; i++) {
      memory = buildThreadMemory(memory, { ...makeDigest(), seq: i }, 100, undefined, undefined)
    }
    // Each session line is ~78 chars ≈ 20 tokens: 6 lines ≈ 119 tokens exceed
    // the 100-token budget, so the oldest line is trimmed (~5 lines ≈ 99 tokens).
    expect(memory!.summary.split('\n').length).toBeLessThan(6)
    expect(memory!.sessionsIncorporated).toBe(6)
  })
})

describe('extractDecisionSignals (pure)', () => {
  it('extracts decisions, questions and artifact ids from transcript + summary', () => {
    const signals = extractDecisionSignals({
      transcriptText: '我们决定采用 zod v4。这个阈值还需要确认。\n后续要补 ADR-12 文档。',
      transcriptEntries: [],
      summaryConclusions: ['拍板了数据库选 sqlite'],
      summaryOpenQuestions: ['缓存策略待定'],
    })
    expect(signals.decisions.length).toBeGreaterThan(0)
    expect(signals.decisions[0]).toContain('sqlite')
    expect(signals.openQuestions.length).toBeGreaterThan(0)
    expect(signals.artifacts).toEqual(['ADR-12'])
  })
})

describe('extractRecentArtifacts (pure)', () => {
  it('keeps write-op files, classifies paths, sorts by recency and caps at 5', () => {
    const files = Array.from({ length: 7 }, (_, i) => ({ path: `src/file_${i}.ts`, ops: ['edit'] }))
    const artifacts = extractRecentArtifacts({
      filesTouched: [...files, { path: 'src/read_only.ts', ops: ['read'] }],
      prTasks: [],
      catId: CAT_SEAL,
    })
    expect(artifacts).toHaveLength(5)
    expect(artifacts.every((a) => a.type === 'file' && a.updatedBy === CAT_SEAL)).toBe(true)
    expect(artifacts.some((a) => a.ref === 'src/read_only.ts')).toBe(false)
  })

  it('maps open pr_tracking tasks to PR artifacts', () => {
    const artifacts = extractRecentArtifacts({
      filesTouched: [],
      prTasks: [
        {
          id: 'task_1',
          kind: 'pr_tracking',
          subjectKey: 'pr:#1234',
          title: 'Merge main',
          ownerCatId: CAT_SEAL,
          status: 'in_progress',
          updatedAt: 200,
        },
      ],
      catId: CAT_SEAL,
    })
    expect(artifacts).toEqual([
      { type: 'pr', ref: '#1234', label: 'PR #1234', updatedAt: 200, updatedBy: CAT_SEAL },
    ])
  })
})

describe('generateHandoffDigest (pure)', () => {
  it('returns null on a non-ok response without throwing', async () => {
    const result = await generateHandoffDigest({
      handoffSummaries: [],
      extractiveDigest: {},
      recentMessages: [],
      apiKey: 'k',
      baseUrl: 'http://mock.internal',
      fetchFn: (() => Promise.resolve(new Response('nope', { status: 500 }))) as unknown as typeof fetch,
    })
    expect(result).toBeNull()
  })
})
