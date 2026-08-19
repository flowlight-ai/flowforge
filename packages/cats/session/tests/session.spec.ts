/**
 * @flowforge/cats-session — unit tests for the batch-6.3 Cordis services
 * (transcript writer / reader) + continuity capsule + text sanitizer.
 *
 * 对齐 dsh 测试风格：Cordis 服务经 `await ctx.plugin(Class, options)` 挂载
 * 到 `new Context()`，afterEach 逐个 dispose fiber；dataDir 用
 * `os.tmpdir() + randomUUID()` 隔离目录。
 *
 * @module @flowforge/cats-session/tests
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import Plugin, {
  createLeakedToolCallStreamStripper,
  extractContinuityCapsuleFromSystemInfo,
  formatContinuationPrompt,
  isCollaborationContinuityCapsuleV1,
  stripLeakedToolCallPayload,
  TranscriptReaderService,
  TranscriptWriterService,
  type CollaborationContinuityCapsuleV1,
  type TranscriptSessionInfo,
} from '../src/index.ts'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const NEEDLE = 'xyzzy-quill'

const tmpRoot = mkdtempSync(join(tmpdir(), 'flowforge-cats-session-'))
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

interface SessionPair {
  writer: TranscriptWriterService
  reader: TranscriptReaderService
}

/** Mount writer + reader services sharing one isolated dataDir. */
async function mountPair(options?: { indexStride?: number }): Promise<SessionPair> {
  const ctx = new Context()
  const dataDir = join(tmpRoot, randomUUID())
  const writerFiber = await ctx.plugin(TranscriptWriterService, {
    dataDir,
    ...(options?.indexStride !== undefined ? { indexStride: options.indexStride } : {}),
  }) as unknown as { dispose: () => Promise<void> | void }
  fibers.push(writerFiber)
  const readerFiber = await ctx.plugin(TranscriptReaderService, { dataDir }) as unknown as {
    dispose: () => Promise<void> | void
  }
  fibers.push(readerFiber)
  return { writer: ctx.catsTranscriptWriter, reader: ctx.catsTranscriptReader }
}

function makeSession(): TranscriptSessionInfo {
  const suffix = randomUUID().slice(0, 8)
  return {
    sessionId: `sess_${suffix}`,
    threadId: 'thread_alpha',
    catId: 'cat_writer',
    cliSessionId: `cli_${suffix}`,
    seq: 1,
  }
}

/** Flush a 7-event session: even eventNo → invA, odd → invB, digest included. */
async function seedFlushedSession(pair: SessionPair, session: TranscriptSessionInfo): Promise<void> {
  for (let i = 0; i < 7; i++) {
    const invocationId = i % 2 === 0 ? 'invA' : 'invB'
    pair.writer.appendEvent(session, { type: 'text', content: `page message ${i} with needle ${NEEDLE}` }, invocationId)
  }
  await pair.writer.flush(session, { createdAt: 111, sealedAt: 222, sealReason: `${NEEDLE} seal for search` })
}

const CAPSULE: CollaborationContinuityCapsuleV1 = {
  v: 1,
  threadId: 'thread_c',
  catId: 'cat_c',
  mode: 'serial',
  chainIndex: 2,
  chainTotal: 3,
  a2aEnabled: false,
  ballState: 'in_progress',
  continuationReason: 'threshold_seal',
  createdAt: 1719999999999,
}

// ---------------------------------------------------------------------------
// TranscriptWriterService
// ---------------------------------------------------------------------------

describe('TranscriptWriterService', () => {
  it('appendEvent buffers events with sequential eventNo and invocationId passthrough', async () => {
    const { writer } = await mountPair()
    const session = makeSession()
    writer.appendEvent(session, { type: 'text', content: 'hello' })
    writer.appendEvent(session, { type: 'tool_use', toolName: 'Read' }, 'inv_1')
    writer.appendEvent(session, { type: 'text', content: 'bye' })

    expect(writer.getEventCount(session.sessionId)).toBe(3)
    const buffered = writer.getBufferedEvents(session.sessionId)
    expect(buffered.map((e) => e.eventNo)).toEqual([0, 1, 2])
    expect(buffered[0]?.event).toEqual({ type: 'text', content: 'hello' })
    expect(buffered[1]?.invocationId).toBe('inv_1')
    expect(buffered[2]?.invocationId).toBeUndefined()
    expect(writer.getEventCount('sess_unknown')).toBe(0)
    expect(writer.getBufferedEvents('sess_unknown')).toEqual([])
  })

  it('drainPendingWrites persists events.live.jsonl envelopes with full metadata', async () => {
    const { writer, reader } = await mountPair()
    const session = makeSession()
    writer.appendEvent(session, { type: 'text', content: 'live one' }, 'inv_live')
    writer.appendEvent(session, { type: 'text', content: 'live two' })
    await writer.drainPendingWrites(session.sessionId)

    const livePath = join(
      reader.getSessionDir(session.threadId, session.catId, session.sessionId),
      'events.live.jsonl',
    )
    expect(existsSync(livePath)).toBe(true)

    const lines = readFileSync(livePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(lines).toHaveLength(2)

    const first = lines[0]!
    expect(first.v).toBe(1)
    expect(typeof first.t).toBe('number')
    expect(first.threadId).toBe(session.threadId)
    expect(first.catId).toBe(session.catId)
    expect(first.sessionId).toBe(session.sessionId)
    expect(first.cliSessionId).toBe(session.cliSessionId)
    expect(first.invocationId).toBe('inv_live')
    expect(first.eventNo).toBe(0)
    expect(first.event).toEqual({ type: 'text', content: 'live one' })
    expect(lines[1]!.invocationId).toBeUndefined()
    expect(lines[1]!.eventNo).toBe(1)
  })

  it('flush writes events.jsonl + index.json + digest.extractive.json and clears live file/buffer', async () => {
    const { writer, reader } = await mountPair({ indexStride: 2 })
    const session = makeSession()
    writer.appendEvent(session, { type: 'tool_use', toolName: 'Write', toolInput: { file_path: 'src/a.ts' } })
    writer.appendEvent(session, { type: 'error', error: 'Unexpected EOF while parsing response' })
    writer.appendEvent(session, { type: 'text', content: 'msg-2' })
    writer.appendEvent(session, { type: 'text', content: 'msg-3' })
    writer.appendEvent(session, { type: 'text', content: 'msg-4' })
    writer.appendEvent(session, { type: 'text', content: 'msg-5' })

    const createdAt = Date.now() - 60_000
    const sealedAt = Date.now()
    await writer.flush(session, { createdAt, sealedAt, sealReason: 'threshold_seal' })

    const dir = reader.getSessionDir(session.threadId, session.catId, session.sessionId)
    expect(existsSync(join(dir, 'events.jsonl'))).toBe(true)
    expect(existsSync(join(dir, 'events.live.jsonl'))).toBe(false)
    expect(writer.getEventCount(session.sessionId)).toBe(0)
    expect(writer.getBufferedEvents(session.sessionId)).toEqual([])

    const lines = readFileSync(join(dir, 'events.jsonl'), 'utf-8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(6)
    const envelopes = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(envelopes.map((e) => e.eventNo)).toEqual([0, 1, 2, 3, 4, 5])

    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8')) as Record<string, unknown>
    expect(index.v).toBe(1)
    expect(index.eventCount).toBe(6)
    expect(index.stride).toBe(2)
    const len0 = Buffer.byteLength(lines[0]!, 'utf-8') + 1
    const len1 = Buffer.byteLength(lines[1]!, 'utf-8') + 1
    const len2 = Buffer.byteLength(lines[2]!, 'utf-8') + 1
    const len3 = Buffer.byteLength(lines[3]!, 'utf-8') + 1
    expect(index.offsets).toEqual([0, len0 + len1, len0 + len1 + len2 + len3])

    const digest = JSON.parse(readFileSync(join(dir, 'digest.extractive.json'), 'utf-8')) as Record<string, unknown>
    expect(digest.v).toBe(1)
    expect(digest.time).toEqual({ createdAt, sealedAt })
    expect(digest.sealReason).toBe('threshold_seal')
    const invocations = digest.invocations as Array<{ toolNames?: string[] }>
    expect(invocations[0]!.toolNames).toEqual(['Write'])
    expect(digest.filesTouched).toEqual([{ path: 'src/a.ts', ops: ['create'] }])
    const errors = digest.errors as Array<{ message: string }>
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe('Unexpected EOF while parsing response')
    const recent = digest.recentMessages as Array<{ content: string }>
    expect(recent.map((m) => m.content)).toEqual(['msg-2', 'msg-3', 'msg-4', 'msg-5'])
  })

  it('flush on an empty session is a no-op (no artifacts written)', async () => {
    const { writer, reader } = await mountPair()
    const session = makeSession()
    await writer.flush(session, { createdAt: 1, sealedAt: 2 })
    const dir = reader.getSessionDir(session.threadId, session.catId, session.sessionId)
    expect(existsSync(dir)).toBe(false)
    expect(writer.getEventCount(session.sessionId)).toBe(0)
  })

  it('flush merges pre-restart disk events with the buffer and re-numbers eventNo', async () => {
    const { writer, reader } = await mountPair()
    const session = makeSession()
    const dir = reader.getSessionDir(session.threadId, session.catId, session.sessionId)

    // Simulate a pre-restart event that only exists on disk (crash-recovery path).
    mkdirSync(dir, { recursive: true })
    const diskEnvelope = {
      v: 1,
      t: Date.now() - 5_000,
      threadId: session.threadId,
      catId: session.catId,
      sessionId: session.sessionId,
      cliSessionId: session.cliSessionId,
      eventNo: 0,
      event: { type: 'text', content: 'pre-restart event' },
    }
    writeFileSync(join(dir, 'events.live.jsonl'), `${JSON.stringify(diskEnvelope)}\n`, 'utf-8')

    // Post-restart buffered event (different content so content-based dedup keeps both).
    writer.appendEvent(session, { type: 'text', content: 'post-restart event' })
    await writer.flush(session, { createdAt: Date.now() - 5_000, sealedAt: Date.now() })

    const envelopes = readFileSync(join(dir, 'events.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(envelopes).toHaveLength(2)
    expect(envelopes.map((e) => e.eventNo)).toEqual([0, 1])
    expect(envelopes.map((e) => (e.event as Record<string, unknown>).content)).toEqual([
      'pre-restart event',
      'post-restart event',
    ])
    expect(existsSync(join(dir, 'events.live.jsonl'))).toBe(false)
    expect(writer.getEventCount(session.sessionId)).toBe(0)
  })

  it('generateExtractiveDigest groups repeated context-cancelled errors as terminal noise', async () => {
    const { writer } = await mountPair()
    const session = makeSession()
    writer.appendEvent(session, { type: 'error', error: 'Context cancelled while waiting for tool result' }, 'inv_n')
    writer.appendEvent(session, { type: 'error', error: 'Context cancelled again mid-stream' }, 'inv_n')

    const digest = writer.generateExtractiveDigest(session, { createdAt: 1, sealedAt: 2 })
    const noise = digest.diagnostics?.noise ?? []
    expect(noise).toHaveLength(1)
    expect(noise[0]!.kind).toBe('context_canceled')
    expect(noise[0]!.count).toBe(2)
    expect(noise[0]!.invocationIds).toEqual(['inv_n'])
    expect(noise[0]!.outcome).toBe('terminal')
    // terminal noise keeps one representative error for the digest
    expect(digest.errors).toHaveLength(1)
    expect(digest.errors[0]!.message).toBe('Context cancelled while waiting for tool result')
  })

  it('generateExtractiveDigest marks noise recovered once visible text follows', async () => {
    const { writer } = await mountPair()
    const session = makeSession()
    writer.appendEvent(session, { type: 'error', error: 'Context cancelled while waiting for tool result' }, 'inv_r')
    writer.appendEvent(session, { type: 'error', error: 'Context cancelled again mid-stream' }, 'inv_r')
    writer.appendEvent(session, { type: 'text', content: 'Recovered: continuing the task' }, 'inv_r')

    const digest = writer.generateExtractiveDigest(session, { createdAt: 1, sealedAt: 2 })
    const noise = digest.diagnostics?.noise ?? []
    expect(noise).toHaveLength(1)
    expect(noise[0]!.outcome).toBe('recovered')
    // recovered noise contributes no error entries
    expect(digest.errors).toEqual([])
    expect(digest.recentMessages?.map((m) => m.content)).toContain('Recovered: continuing the task')
  })

  it('getFilesTouched merges disk + buffer tool_use events into path → ops', async () => {
    const { writer } = await mountPair()
    const session = makeSession()
    writer.appendEvent(session, { type: 'tool_use', toolName: 'Write', toolInput: { file_path: 'src/new.ts' } }, 'inv_f')
    writer.appendEvent(session, { type: 'tool_use', name: 'Edit', input: { file_path: 'src/edit.ts' } }, 'inv_f')
    writer.appendEvent(session, { type: 'tool_use', toolName: 'Read', toolInput: { path: 'src/read.ts' } })
    await writer.drainPendingWrites(session.sessionId)

    const files = await writer.getFilesTouched(session.sessionId, {
      threadId: session.threadId,
      catId: session.catId,
    })
    const byPath = new Map(files.map((f) => [f.path, f.ops]))
    expect(byPath.get('src/new.ts')).toEqual(['create'])
    expect(byPath.get('src/edit.ts')).toEqual(['edit'])
    expect(byPath.get('src/read.ts')).toEqual(['read'])
  })

  it('generateExtractiveDigest captures the continuity capsule from system_info events', async () => {
    const { writer } = await mountPair()
    const session = makeSession()
    writer.appendEvent(session, {
      type: 'system_info',
      content: JSON.stringify({ type: 'session_seal_requested', continuityCapsule: CAPSULE }),
    })

    const digest = writer.generateExtractiveDigest(session, { createdAt: 1, sealedAt: 2 })
    expect(digest.continuityCapsule).toEqual(CAPSULE)
  })

  it('writeHandoffDigest writes markdown with YAML frontmatter', async () => {
    const { reader } = await mountPair()
    const session = makeSession()
    const dir = reader.getSessionDir(session.threadId, session.catId, session.sessionId)
    mkdirSync(dir, { recursive: true })

    await TranscriptWriterService.writeHandoffDigest(
      dir,
      { v: 1, model: 'test-model', generatedAt: 1720000000000 },
      '## Handoff\nContinue from here.',
    )

    const content = readFileSync(join(dir, 'digest.handoff.md'), 'utf-8')
    expect(content).toContain('---\nv: 1\nmodel: test-model\ngeneratedAt: 1720000000000\n---')
    expect(content).toContain('## Handoff\nContinue from here.')
  })
})

// ---------------------------------------------------------------------------
// TranscriptReaderService
// ---------------------------------------------------------------------------

describe('TranscriptReaderService', () => {
  it('readEvents paginates with cursor/limit/nextCursor/total', async () => {
    const pair = await mountPair()
    const session = makeSession()
    await seedFlushedSession(pair, session)

    const page1 = await pair.reader.readEvents(session.sessionId, session.threadId, session.catId, undefined, 3)
    expect(page1.total).toBe(7)
    expect(page1.events.map((e) => e.eventNo)).toEqual([0, 1, 2])
    expect(page1.events[0]!.threadId).toBe(session.threadId)
    expect(page1.events[0]!.sessionId).toBe(session.sessionId)
    expect(page1.nextCursor).toEqual({ eventNo: 3 })

    const page2 = await pair.reader.readEvents(session.sessionId, session.threadId, session.catId, page1.nextCursor, 3)
    expect(page2.events.map((e) => e.eventNo)).toEqual([3, 4, 5])
    expect(page2.nextCursor).toEqual({ eventNo: 6 })

    const page3 = await pair.reader.readEvents(session.sessionId, session.threadId, session.catId, page2.nextCursor, 3)
    expect(page3.events.map((e) => e.eventNo)).toEqual([6])
    expect(page3.nextCursor).toBeUndefined()

    const missing = await pair.reader.readEvents('sess_missing', session.threadId, session.catId)
    expect(missing).toEqual({ events: [], total: 0 })
  })

  it('readDigest returns the sealed extractive digest or null', async () => {
    const pair = await mountPair()
    const session = makeSession()
    await seedFlushedSession(pair, session)

    const digest = await pair.reader.readDigest(session.sessionId, session.threadId, session.catId)
    expect(digest).not.toBeNull()
    expect(digest!.v).toBe(1)
    expect(digest!.sessionId).toBe(session.sessionId)
    expect(digest!.sealReason).toBe(`${NEEDLE} seal for search`)
    expect(await pair.reader.readDigest('sess_missing', session.threadId, session.catId)).toBeNull()
  })

  it('search hits digests and events with snippets and pointers', async () => {
    const pair = await mountPair()
    const session = makeSession()
    await seedFlushedSession(pair, session)

    const hits = await pair.reader.search(session.threadId, NEEDLE)
    expect(hits.length).toBeGreaterThanOrEqual(2)

    const digestHit = hits.find((h) => h.kind === 'digest')
    expect(digestHit).toBeDefined()
    expect(digestHit!.score).toBe(1.0)
    expect(digestHit!.snippet.toLowerCase()).toContain(NEEDLE)

    const eventHit = hits.find((h) => h.kind === 'event')
    expect(eventHit).toBeDefined()
    expect(eventHit!.score).toBe(0.8)
    expect(eventHit!.pointer.eventNo).toBeTypeOf('number')
    expect(eventHit!.snippet.toLowerCase()).toContain(NEEDLE)

    // cat filter excludes the only cat dir in this dataDir
    expect(await pair.reader.search(session.threadId, NEEDLE, { cats: ['cat_other'] })).toEqual([])
  })

  it('readInvocationEvents filters envelopes by invocationId', async () => {
    const pair = await mountPair()
    const session = makeSession()
    await seedFlushedSession(pair, session)

    const invA = await pair.reader.readInvocationEvents(session.sessionId, session.threadId, session.catId, 'invA')
    expect(invA).not.toBeNull()
    expect(invA!.every((e) => e.invocationId === 'invA')).toBe(true)
    expect(invA!.map((e) => e.eventNo)).toEqual([0, 2, 4, 6])

    expect(await pair.reader.readInvocationEvents(session.sessionId, session.threadId, session.catId, 'invZ')).toBeNull()
    expect(await pair.reader.readInvocationEvents('sess_missing', session.threadId, session.catId, 'invA')).toBeNull()
  })

  it('readAllEvents returns every envelope in order', async () => {
    const pair = await mountPair()
    const session = makeSession()
    await seedFlushedSession(pair, session)

    const all = await pair.reader.readAllEvents(session.sessionId, session.threadId, session.catId)
    expect(all).toHaveLength(7)
    expect(all.map((e) => e.eventNo)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(all[0]!.event.content).toBe(`page message 0 with needle ${NEEDLE}`)

    expect(await pair.reader.readAllEvents('sess_missing', session.threadId, session.catId)).toEqual([])
  })

  it('readHandoffDigest round-trips writer-written frontmatter + body', async () => {
    const pair = await mountPair()
    const session = makeSession()
    const dir = pair.reader.getSessionDir(session.threadId, session.catId, session.sessionId)
    mkdirSync(dir, { recursive: true })
    await TranscriptWriterService.writeHandoffDigest(
      dir,
      { v: 1, model: 'test-model', generatedAt: 1720000000000 },
      '## Handoff\nContinue from here.',
    )

    const result = await pair.reader.readHandoffDigest(session.sessionId, session.threadId, session.catId)
    expect(result).toEqual({
      v: 1,
      model: 'test-model',
      generatedAt: 1720000000000,
      body: '## Handoff\nContinue from here.',
    })
    expect(await pair.reader.readHandoffDigest('sess_missing', session.threadId, session.catId)).toBeNull()
  })

  it('hasTranscript reports sealed sessions only', async () => {
    const pair = await mountPair()
    const session = makeSession()
    await seedFlushedSession(pair, session)
    expect(await pair.reader.hasTranscript(session.sessionId, session.threadId, session.catId)).toBe(true)
    expect(await pair.reader.hasTranscript('sess_missing', session.threadId, session.catId)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Default plugin
// ---------------------------------------------------------------------------

describe('default plugin', () => {
  it('mounts both services on one context (CATS_TRANSCRIPT_DIR fallback)', async () => {
    const envDir = join(tmpRoot, `env-${randomUUID()}`)
    process.env.CATS_TRANSCRIPT_DIR = envDir
    try {
      const ctx = new Context()
      const fiber = await ctx.plugin(Plugin) as unknown as { dispose: () => Promise<void> | void }
      fibers.push(fiber)
      expect(ctx.catsTranscriptWriter).toBeInstanceOf(TranscriptWriterService)
      expect(ctx.catsTranscriptReader).toBeInstanceOf(TranscriptReaderService)
    } finally {
      delete process.env.CATS_TRANSCRIPT_DIR
    }
  })
})

// ---------------------------------------------------------------------------
// stripLeakedToolCallPayload / stream stripper
// ---------------------------------------------------------------------------

describe('stripLeakedToolCallPayload', () => {
  it('strips leaked tool_uses payloads from visible text', () => {
    const leaked = 'Analysis done.\n{"tool_uses":[{"recipient_name":"functions.write","parameters":{"path":"a.ts"}}]}'
    expect(stripLeakedToolCallPayload(leaked)).toBe('Analysis done.')
  })

  it('strips leaked single-recipient mcp payloads', () => {
    expect(stripLeakedToolCallPayload('{"recipient_name":"mcp__fs__read","arguments":{"path":"b.ts"}}')).toBe('')
  })

  it('keeps intentional JSON examples behind a recognised example prefix', () => {
    const example = '例如：\n{"tool_uses":[{"recipient_name":"functions.write","parameters":{}}]}'
    expect(stripLeakedToolCallPayload(example)).toBe(example)
  })

  it('keeps fenced json examples intact', () => {
    const fenced = '```json\n{"tool_uses":[{"recipient_name":"functions.write"}]}\n```'
    expect(stripLeakedToolCallPayload(fenced)).toBe(fenced)
  })
})

describe('createLeakedToolCallStreamStripper', () => {
  it('holds back potential leak prefixes and strips them once confirmed', () => {
    const stripper = createLeakedToolCallStreamStripper()
    expect(stripper.push('Working\n{"tool_uses":[{"reci')).toBe('Working')
    expect(stripper.push('pient_name":"functions.write"}]}')).toBe('')
    expect(stripper.flush()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// CollaborationContinuityCapsule
// ---------------------------------------------------------------------------

describe('CollaborationContinuityCapsule', () => {
  it('isCollaborationContinuityCapsuleV1 validates the v1 shape strictly', () => {
    expect(isCollaborationContinuityCapsuleV1(CAPSULE)).toBe(true)

    const sealed: CollaborationContinuityCapsuleV1 = {
      ...CAPSULE,
      invocationId: 'inv_c',
      seal: { sessionId: 'sess_c', sessionSeq: 3, reason: 'quota exhausted' },
    }
    expect(isCollaborationContinuityCapsuleV1(sealed)).toBe(true)

    expect(isCollaborationContinuityCapsuleV1({ ...CAPSULE, v: 2 })).toBe(false)
    expect(isCollaborationContinuityCapsuleV1({ ...CAPSULE, catId: '' })).toBe(false)
    expect(isCollaborationContinuityCapsuleV1({ ...CAPSULE, a2aEnabled: 'yes' })).toBe(false)
    expect(isCollaborationContinuityCapsuleV1({ ...CAPSULE, invocationId: '' })).toBe(false)
    expect(
      isCollaborationContinuityCapsuleV1({ ...CAPSULE, seal: { sessionId: 's', sessionSeq: 0, reason: 'r' } }),
    ).toBe(false)
    expect(isCollaborationContinuityCapsuleV1(null)).toBe(false)
    expect(isCollaborationContinuityCapsuleV1('nope')).toBe(false)
  })

  it('formatContinuationPrompt surfaces the seal reason and mode chain', () => {
    const sealed: CollaborationContinuityCapsuleV1 = {
      ...CAPSULE,
      invocationId: 'inv_c',
      seal: { sessionId: 'sess_c', sessionSeq: 3, reason: 'quota exhausted' },
    }
    const prompt = formatContinuationPrompt(sealed)
    expect(prompt).toContain('[System Continuation]')
    expect(prompt).toContain('sealed because of quota exhausted')
    expect(prompt).toContain('Mode: serial (2 / 3)')
    expect(prompt).toContain('Thread: thread_c')

    // without a seal the continuationReason is used instead
    expect(formatContinuationPrompt(CAPSULE)).toContain('sealed because of threshold_seal')
  })

  it('extractContinuityCapsuleFromSystemInfo parses session_seal_requested payloads only', () => {
    const content = JSON.stringify({ type: 'session_seal_requested', continuityCapsule: CAPSULE })
    expect(extractContinuityCapsuleFromSystemInfo(content)).toEqual(CAPSULE)
    expect(extractContinuityCapsuleFromSystemInfo(JSON.stringify({ type: 'warning' }))).toBeNull()
    expect(extractContinuityCapsuleFromSystemInfo('not json')).toBeNull()
    expect(
      extractContinuityCapsuleFromSystemInfo(
        JSON.stringify({ type: 'session_seal_requested', continuityCapsule: { v: 2 } }),
      ),
    ).toBeNull()
  })
})
