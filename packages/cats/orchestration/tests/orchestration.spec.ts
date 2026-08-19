/**
 * @flowforge/cats-orchestration — unit tests for the six batch-5 Cordis
 * services (audit log / summarizer + task extractor / freshness gate /
 * tool usage / dossier distillation / duty briefing).
 *
 * 对齐 dsh 测试风格：Cordis 服务直接构造挂到 `new Context()`（Service
 * 构造即注册），持久化走 `ctx.catStores`（Memory 后端）。
 *
 * @module @flowforge/cats-orchestration/tests
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createThreadId, createUserId, generateId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import {
  AUTO_SUMMARY_MESSAGE_THRESHOLD,
  aggregateDutyBriefing,
  computeFileHash,
  DossierDistillationService,
  DutyBriefingService,
  EventAuditLogService,
  extractByPatterns,
  extractTasks,
  FreshnessService,
  isMcpToolName,
  MAX_BRIEFING_BODY_LINES,
  prepareDraft,
  renderBriefingCard,
  UsageAggregatorService,
  classifyTool,
  type AggregatorTask,
  type DutyBriefingInput,
  type ExtractionOptions,
  type StoredMessage,
  type TaskInvoker,
} from '../src/index.ts'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const CAT_A = createCatId('cat_a')
const CAT_B = createCatId('cat_b')
const USER = 'user_1'
const USER_ID = createUserId(USER)
const DAY_MS = 24 * 60 * 60 * 1000

const tmpRoot = mkdtempSync(join(tmpdir(), 'flowforge-cats-orchestration-'))
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

interface Harness {
  ctx: Context
  stores: CatStores
  audit: EventAuditLogService
  freshness: FreshnessService
  toolUsage: UsageAggregatorService
  distiller: DossierDistillationService
}

/** Build a Cordis context with stores + all six orchestration services wired. */
function harness(): Harness {
  const ctx = new Context()
  const stores = new CatStores(ctx)
  new MemoryStoresBackend(ctx)
  const audit = new EventAuditLogService(ctx, { auditDir: join(tmpRoot, `audit-${generateId('run')}`) })
  const freshness = new FreshnessService(ctx)
  const toolUsage = new UsageAggregatorService(ctx)
  const distiller = new DossierDistillationService(ctx)
  return { ctx, stores, audit, freshness, toolUsage, distiller }
}

/** Append a cat-authored message fixture and return the stored record. */
function seedMessage(
  h: Harness,
  overrides: Partial<StoredMessage> & { threadId?: string; content: string },
): StoredMessage {
  const msg = h.stores.messages().append({
    threadId: overrides.threadId ?? 'thread_1',
    userId: USER,
    catId: overrides.catId ?? CAT_A,
    content: overrides.content,
    mentions: [],
    timestamp: overrides.timestamp ?? Date.now(),
  })
  return msg as StoredMessage
}

// ---------------------------------------------------------------------------
// 1. EventAuditLogService — append-only NDJSON 按日分片
// ---------------------------------------------------------------------------

describe('EventAuditLogService', () => {
  it('appends events with generated id/timestamp and reads them back by date', async () => {
    const h = harness()
    const e1 = await h.audit.append({ type: 'debate_winner', threadId: 'thread_1', data: { winner: CAT_A } })
    const e2 = await h.audit.append({ type: 'decision_made', threadId: 'thread_2', data: { call: 'adopt-b' } })

    expect(e1.id).toBeTruthy()
    expect(e2.id).not.toBe(e1.id)
    expect(e1.timestamp).toBeGreaterThan(0)

    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const byDate = await h.audit.readByDate(dateStr)
    expect(byDate).toHaveLength(2)
    expect(byDate.map((e) => e.type)).toEqual(expect.arrayContaining(['debate_winner', 'decision_made']))
  })

  it('filters by type and threadId within the trailing window', async () => {
    const h = harness()
    await h.audit.append({ type: 'phase_completed', threadId: 'thread_x', data: {} })
    await h.audit.append({ type: 'review_approved', threadId: 'thread_x', data: {} })
    await h.audit.append({ type: 'phase_completed', threadId: 'thread_y', data: {} })

    const byType = await h.audit.readByType('phase_completed')
    expect(byType).toHaveLength(2)

    const byThread = await h.audit.readByThread('thread_x')
    expect(byThread).toHaveLength(2)
    expect(byThread.every((e) => e.threadId === 'thread_x')).toBe(true)
  })

  it('lists NDJSON shard files newest-first', async () => {
    const h = harness()
    await h.audit.append({ type: 'server_started', data: {} })
    const files = await h.audit.listFiles()
    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files[0]).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.ndjson$/)
  })
})

// ---------------------------------------------------------------------------
// 2. AutoSummarizerService + TaskExtractor
// ---------------------------------------------------------------------------

describe('AutoSummarizerService', () => {
  it('skips summarization below the message threshold', async () => {
    const h = harness()
    const { AutoSummarizerService } = await import('../src/index.ts')
    const summarizer = new AutoSummarizerService(h.ctx)
    for (let i = 0; i < AUTO_SUMMARY_MESSAGE_THRESHOLD - 1; i++) {
      seedMessage(h, { content: `普通消息 ${i}，内容长度需要超过二十个字符以确保被计入统计范围。` })
    }
    const summary = await summarizer.maybeSummarize('thread_1')
    expect(summary).toBeNull()
    expect(h.stores.summaries().listByThread('thread_1')).toHaveLength(0)
  })

  it('generates a pattern-based summary at the threshold and cooldown-blocks the immediate rerun', async () => {
    const h = harness()
    const { AutoSummarizerService } = await import('../src/index.ts')
    const summarizer = new AutoSummarizerService(h.ctx)
    for (let i = 0; i < AUTO_SUMMARY_MESSAGE_THRESHOLD; i++) {
      seedMessage(h, {
        content: `讨论段落 ${i}：我们决定采用方案 B，因为方案 A 的性能问题还没有解决。`,
      })
    }

    const summary = await summarizer.maybeSummarize('thread_1')
    expect(summary).not.toBeNull()
    expect(summary!.createdBy).toBe('system')
    expect(summary!.conclusions.length).toBeGreaterThan(0)

    // Cooldown: immediate second attempt is a no-op.
    const again = await summarizer.maybeSummarize('thread_1')
    expect(again).toBeNull()
    expect(h.stores.summaries().listByThread('thread_1')).toHaveLength(1)
  })
})

describe('TaskExtractor', () => {
  const options: ExtractionOptions = { threadId: 'thread_1', userId: USER }

  it('degrades to pattern matching without an LLM invoker', async () => {
    const messages = [
      { id: 'm1', content: 'TODO: 修复登录超时问题' },
      { id: 'm2', content: '这里没有任务' },
    ] as unknown as StoredMessage[]
    const result = await extractTasks(messages, null, [], options)
    expect(result.degraded).toBe(true)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]!.title).toContain('修复登录超时问题')
  })

  it('parses the LLM JSON array and maps sourceIndex to message ids', async () => {
    const messages = [
      { id: 'm1', content: '计划确定' },
      { id: 'm2', content: '需要补充单元测试' },
    ] as unknown as StoredMessage[]
    const invoker: TaskInvoker = async function* () {
      yield {
        type: 'text',
        content: '[{"title":"补充单测","why":"质量要求","ownerCatId":"cat_a","sourceIndex":1}]',
      }
    }
    const result = await extractTasks(messages, invoker, ['cat_a'], options)
    expect(result.degraded).toBe(false)
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0]!.sourceMessageId).toBe('m2')
    expect(result.tasks[0]!.ownerCatId).toBe(CAT_A)
  })

  it('falls back to patterns when the LLM returns invalid JSON', async () => {
    const messages = [{ id: 'm1', content: 'TODO: 编写迁移脚本并验证' }] as unknown as StoredMessage[]
    const invoker: TaskInvoker = async function* () {
      yield { type: 'text', content: 'not json at all' }
    }
    const result = await extractTasks(messages, invoker, [], options)
    expect(result.degraded).toBe(true)
    expect(result.reason).toContain('pattern matching')
    expect(result.tasks.length).toBeGreaterThan(0)
  })

  it('drops ownerCatId values outside the valid registry', async () => {
    const messages = [{ id: 'm1', content: '任务' }] as unknown as StoredMessage[]
    const invoker: TaskInvoker = async function* () {
      yield { type: 'text', content: '[{"title":"t","why":"w","ownerCatId":"ghost","sourceIndex":0}]' }
    }
    const result = await extractTasks(messages, invoker, ['cat_a'], options)
    expect(result.tasks[0]!.ownerCatId).toBeUndefined()
  })

  it('extractByPatterns finds markdown checkboxes and TODO tags', () => {
    const messages = [
      { id: 'm1', content: '- [ ] 完成部署文档' },
      { id: 'm2', content: 'TODO 更新依赖清单' },
    ] as unknown as StoredMessage[]
    const tasks = extractByPatterns(messages)
    expect(tasks).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// 3. FreshnessService — F254 副作用闸门
// ---------------------------------------------------------------------------

describe('FreshnessService', () => {
  const thread = createThreadId('thread_f')

  it('AC-A5: acknowledgeHeld forces forward', async () => {
    const h = harness()
    h.stores.deliveryCursors().setSeenCursor(USER_ID, CAT_A, thread, '000001')
    const decision = await h.freshness.checkFreshness({
      userId: USER,
      catId: CAT_A,
      threadId: 'thread_f',
      latestMessageId: '000009',
      toolName: 'post_message',
      unseenMessages: [{ id: '000005', from: USER, preview: 'hi' }],
      acknowledgeHeld: true,
    })
    expect(decision.decision).toBe('forward')
    expect(decision.reason).toBe('acknowledge_held')
  })

  it('AC-A3: missing seen cursor fails open (forward)', async () => {
    const h = harness()
    const decision = await h.freshness.checkFreshness({
      userId: USER,
      catId: CAT_A,
      threadId: 'thread_f',
      latestMessageId: '000009',
      toolName: 'post_message',
    })
    expect(decision.decision).toBe('forward')
    expect(decision.reason).toBe('cursor_missing_fail_open')
  })

  it('forwards when the cursor is at/after the latest message (no unseen)', async () => {
    const h = harness()
    h.stores.deliveryCursors().setSeenCursor(USER_ID, CAT_A, thread, '000009')
    const decision = await h.freshness.checkFreshness({
      userId: USER,
      catId: CAT_A,
      threadId: 'thread_f',
      latestMessageId: '000009',
      toolName: 'post_message',
    })
    expect(decision.decision).toBe('forward')
    expect(decision.reason).toBe('no_unseen')
  })

  it('holds with capped previews (AC-A4) when non-self unseen messages exist', async () => {
    const h = harness()
    h.stores.deliveryCursors().setSeenCursor(USER_ID, CAT_A, thread, '000001')
    const decision = await h.freshness.checkFreshness({
      userId: USER,
      catId: CAT_A,
      threadId: 'thread_f',
      latestMessageId: '000009',
      toolName: 'cross_post',
      unseenMessages: [
        { id: '000002', from: USER, preview: 'm2' },
        { id: '000003', from: USER, preview: 'm3' },
        { id: '000004', from: USER, preview: 'm4' },
        { id: '000005', from: USER, preview: 'm5' },
        { id: '000006', from: USER, preview: 'm6' },
      ],
    })
    expect(decision.decision).toBe('held')
    expect(decision.reason).toBe('unseen_available')
    expect(decision.unseenCount).toBe(5)
    expect(decision.previews).toHaveLength(3)
    expect(decision.omittedCount).toBe(2)
    expect(decision.toolName).toBe('cross_post')
  })

  it('forwards when all unseen messages are self-authored', async () => {
    const h = harness()
    h.stores.deliveryCursors().setSeenCursor(USER_ID, CAT_A, thread, '000001')
    const decision = await h.freshness.checkFreshness({
      userId: USER,
      catId: CAT_A,
      threadId: 'thread_f',
      latestMessageId: '000009',
      toolName: 'post_message',
      unseenMessages: [
        { id: '000002', from: 'cat_a', preview: 'self', selfSource: true },
        { id: '000003', from: CAT_A, preview: 'self' },
      ],
    })
    expect(decision.decision).toBe('forward')
    expect(decision.reason).toBe('all_self_messages')
  })

  it('holds without previews when the cursor is behind but no details are provided', async () => {
    const h = harness()
    h.stores.deliveryCursors().setSeenCursor(USER_ID, CAT_A, thread, '000001')
    const decision = await h.freshness.checkFreshness({
      userId: USER,
      catId: CAT_A,
      threadId: 'thread_f',
      latestMessageId: '000009',
      toolName: 'post_message',
    })
    expect(decision.decision).toBe('held')
    expect(decision.previews).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. UsageAggregatorService — 工具用量遥测
// ---------------------------------------------------------------------------

describe('UsageAggregatorService', () => {
  it('classifyTool resolves Skill / Claude-Code MCP / Codex MCP / native', () => {
    expect(classifyTool('Skill', { skill: 'deploy-check' })).toEqual({
      category: 'skill',
      toolName: 'deploy-check',
    })
    expect(classifyTool('mcp__github__create_issue', undefined)).toEqual({
      category: 'mcp',
      toolName: 'mcp__github__create_issue',
      mcpServer: 'github',
    })
    expect(classifyTool('mcp:github/create_issue', undefined)).toEqual({
      category: 'mcp',
      toolName: 'mcp:github/create_issue',
      mcpServer: 'github',
    })
    expect(classifyTool('Read', undefined)).toEqual({ category: 'native', toolName: 'Read' })
    expect(isMcpToolName('mcp__x__y')).toBe(true)
    expect(isMcpToolName('mcp:x/y')).toBe(true)
    expect(isMcpToolName('Read')).toBe(false)
  })

  it('records usage and aggregates by category / top tools / by cat', async () => {
    const h = harness()
    h.toolUsage.recordToolUse('cat_a', 'Read', undefined)
    h.toolUsage.recordToolUse('cat_a', 'Read', undefined)
    h.toolUsage.recordToolUse('cat_a', 'mcp__github__create_issue', undefined)
    h.toolUsage.recordToolUse('cat_b', 'Skill', { skill: 'lint' })

    const report = await h.toolUsage.aggregate(1)
    expect(report.summary.totalCalls).toBe(4)
    expect(report.summary.byCategory.native).toBe(2)
    expect(report.summary.byCategory.mcp).toBe(1)
    expect(report.summary.byCategory.skill).toBe(1)
    expect(report.topTools[0]).toMatchObject({ name: 'Read', count: 2 })
    expect(report.byCat['cat_a']!.native).toBe(2)

    const filtered = await h.toolUsage.aggregate(1, { catId: 'cat_b' })
    expect(filtered.summary.totalCalls).toBe(1)
    expect(filtered.summary.byCategory.skill).toBe(1)
  })

  it('keeps a bounded ring of structured tool events', () => {
    const h = harness()
    for (let i = 0; i < 1050; i++) {
      h.toolUsage.recordToolEvent({
        invocationId: `inv_${i}`,
        sessionId: 'sess_1',
        threadId: 'thread_1',
        catId: 'cat_a',
        toolName: 'Read',
        timestamp: i,
        turnIndex: i,
        status: 'success',
        summary: { seq: i },
      })
    }
    expect(h.toolUsage.listToolEvents()).toHaveLength(1000)
    const tail = h.toolUsage.listToolEvents(2)
    expect((tail[1]!.summary as { seq: number }).seq).toBe(1049)
  })
})

// ---------------------------------------------------------------------------
// 5. DossierDistillationService — F208 蒸馏管线
// ---------------------------------------------------------------------------

const DOSSIER = [
  '# Team Dossier',
  '',
  '### Alpha `cat:cat_a`',
  'alpha capabilities: baseline text HERE',
  '',
  '### Beta `cat:cat_b`',
  'beta capabilities: other baseline text HERE',
  '',
].join('\n')

interface ProposalSeed {
  targetCatId?: string
  beforeSnapshot?: string
  afterDraft?: string
  content?: string
  evidenceRefs?: []
}

async function createProposal(h: Harness, seed: ProposalSeed = {}) {
  const content = seed.content ?? DOSSIER
  return h.stores.dossierDistillationProposals().create({
    sourceEvent: 'feat-phase-close',
    sourceId: generateId('src'),
    targetCatId: createCatId(seed.targetCatId ?? 'cat_a'),
    targetFields: ['nativePeakAbilities'],
    beforeSnapshot: seed.beforeSnapshot ?? 'baseline text HERE',
    afterDraft: seed.afterDraft ?? 'baseline text UPGRADED',
    rationale: 'phase D evidence supports upgrade',
    evidenceRefs: seed.evidenceRefs === undefined ? [{ type: 'observation', id: 'obs_1' } as const] : seed.evidenceRefs,
    baseHash: computeFileHash(content),
    createdBy: 'cat_a',
  })
}

describe('DossierDistillationService', () => {
  it('stages observations (Phase D) and lists them newest-first', async () => {
    const h = harness()
    const first = await h.distiller.addObservation({ catId: CAT_A, content: 'obs one', author: 'operator' })
    await h.distiller.addObservation({ catId: CAT_A, content: 'obs two', author: 'operator' })
    await h.distiller.addObservation({ catId: CAT_B, content: 'other cat', author: 'operator' })

    expect(first.id).toBeTruthy()
    expect(first.provenance.type).toBe('cvo')
    const listed = await h.distiller.listObservations(CAT_A)
    expect(listed).toHaveLength(2)
    expect(listed.every((o) => o.catId === CAT_A)).toBe(true)
  })

  it('fail-closed: proposal creation with empty evidenceRefs throws (KD-17)', async () => {
    const h = harness()
    await expect(createProposal(h, { evidenceRefs: [] })).rejects.toThrow()
  })

  it('full lifecycle: propose → approve → apply replaces only the target cat section', async () => {
    const h = harness()
    const proposal = await createProposal(h)
    expect(proposal.status).toBe('pending')

    const approved = await h.distiller.approveProposal(proposal.proposalId, 'operator_1')
    expect(approved?.status).toBe('approved')

    const outcome = await h.distiller.applyProposal(proposal.proposalId, 'cat_a', DOSSIER, 'commitsha123')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.proposal.status).toBe('applied')
      expect(outcome.proposal.appliedCommitSha).toBe('commitsha123')
      // cat_a section replaced…
      expect(outcome.draft.modifiedContent).toContain('baseline text UPGRADED')
      // …cat_b section untouched.
      expect(outcome.draft.modifiedContent).toContain('beta capabilities: other baseline text HERE')
      expect(outcome.draft.targetPath).toBe('docs/team/cat-dossier.md')
      expect(outcome.draft.commitMessage).toContain(`docs(F208): apply distillation to cat_a`)
    }
  })

  it('BASE_HASH_MISMATCH: refuses to apply when the dossier drifted (KD-17 stale-write lock)', async () => {
    const h = harness()
    const proposal = await createProposal(h)
    await h.distiller.approveProposal(proposal.proposalId, 'operator_1')

    const drifted = DOSSIER + '\nsomeone edited the file meanwhile\n'
    const outcome = await h.distiller.applyProposal(proposal.proposalId, 'cat_a', drifted)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('BASE_HASH_MISMATCH')

    // Sanity: the pure applier flags the same condition.
    const draft = prepareDraft(proposal, drifted)
    expect(draft.ok).toBe(false)
  })

  it('NOT_APPROVED: refuses to apply a pending proposal', async () => {
    const h = harness()
    const proposal = await createProposal(h)
    const outcome = await h.distiller.applyProposal(proposal.proposalId, 'cat_a', DOSSIER)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('NOT_APPROVED')
  })

  it('section anchoring: beforeSnapshot in another cat section fails closed (P1 fix)', async () => {
    // baseHash matches the content, but the snapshot text only exists inside
    // cat_b's section while the proposal targets cat_a.
    const content = [
      '# Team Dossier',
      '',
      '### Alpha `cat:cat_a`',
      'alpha capabilities: unrelated',
      '',
      '### Beta `cat:cat_b`',
      'beta capabilities: baseline text HERE',
      '',
    ].join('\n')
    const h = harness()
    const proposal = await createProposal(h, { content, targetCatId: 'cat_a' })
    await h.distiller.approveProposal(proposal.proposalId, 'operator_1')

    const outcome = await h.distiller.applyProposal(proposal.proposalId, 'cat_a', content)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.code).toBe('BEFORE_SNAPSHOT_NOT_FOUND')
  })

  it('reject proposal transitions pending → rejected', async () => {
    const h = harness()
    const proposal = await createProposal(h)
    const rejected = await h.distiller.rejectProposal(proposal.proposalId, 'operator_1', 'evidence too thin')
    expect(rejected?.status).toBe('rejected')
    expect(rejected?.rejectionReason).toBe('evidence too thin')
  })
})

// ---------------------------------------------------------------------------
// 6. DutyBriefingService — 纯聚合/渲染 + 服务编排
// ---------------------------------------------------------------------------

function aggTask(overrides: Partial<AggregatorTask> & Pick<AggregatorTask, 'id' | 'status' | 'updatedAt'>): AggregatorTask {
  return {
    title: `task ${overrides.id}`,
    ownerCatId: CAT_A,
    why: 'blocked on review',
    threadId: 'thread_1',
    ...overrides,
  }
}

function briefingInput(overrides: Partial<DutyBriefingInput> = {}): DutyBriefingInput {
  return {
    tasks: [],
    zombies: [],
    mentionCandidates: [],
    threadTitles: {},
    activeCount: 2,
    oldestHeartbeatMs: 30_000,
    bindingStatus: 'bound',
    degradedSources: [],
    now: 1_000_000_000_000,
    ...overrides,
  }
}

describe('DutyBriefing pure aggregator/renderer', () => {
  const now = 1_000_000_000_000

  it('routes blocked tasks to needsUser (1d~7d) vs staleBlocked (>7d), age-desc', () => {
    const briefing = aggregateDutyBriefing(
      briefingInput({
        now,
        tasks: [
          aggTask({ id: 't-fresh', status: 'blocked', updatedAt: now - 2 * DAY_MS }),
          aggTask({ id: 't-stale', status: 'blocked', updatedAt: now - 8 * DAY_MS }),
          aggTask({ id: 't-doing', status: 'doing', updatedAt: now - DAY_MS }),
          aggTask({ id: 't-young', status: 'blocked', updatedAt: now - 2 * 60 * 60 * 1000 }),
        ],
      }),
    )
    expect(briefing.needsUser.map((e) => e.anchor.taskId)).toEqual(['t-fresh'])
    expect(briefing.staleBlocked.map((e) => e.anchor.taskId)).toEqual(['t-stale'])
    expect(briefing.counts.active).toBe(2)
    expect(briefing.counts.staleBlocked).toBe(1)
    // doing task + t-young blocked 不进异常区
    expect(briefing.counts.needsUser).toBe(1)
  })

  it('maps zombies to deadBalls and mentions to heuristic needsUser entries', () => {
    const briefing = aggregateDutyBriefing(
      briefingInput({
        now,
        zombies: [{ invocationId: 'inv_1', threadId: 'thread_1', catId: CAT_A, recordUpdatedAt: now - 3 * 60 * 60 * 1000, detail: 'invocation_failed' }],
        mentionCandidates: [{ threadId: 'thread_2', messageId: 'm9', catId: CAT_B, title: '等待确认', timestamp: now - 60_000 }],
        threadTitles: { thread_1: '主线任务' },
      }),
    )
    expect(briefing.deadBalls).toHaveLength(1)
    expect(briefing.deadBalls[0]!.title).toBe('主线任务')
    expect(briefing.needsUser).toHaveLength(1)
    expect(briefing.needsUser[0]!.confidence).toBe('heuristic')
  })

  it('renders a ≤15-line card with count header and folding when overflowing', () => {
    const manyTasks: AggregatorTask[] = Array.from({ length: 30 }, (_, i) =>
      aggTask({ id: `t-${i}`, status: 'blocked', updatedAt: now - (i + 1) * DAY_MS }),
    )
    const briefing = aggregateDutyBriefing(briefingInput({ now, tasks: manyTasks }))
    const card = renderBriefingCard(briefing)

    expect(card.id).toBe('duty-briefing')
    expect(card.kind).toBe('card')
    expect(card.tone).toBe('warning')
    const lines = card.bodyMarkdown!.split('\n')
    expect(lines.length).toBeLessThanOrEqual(MAX_BRIEFING_BODY_LINES)
    expect(lines[0]).toContain('🔴')
    expect(lines.some((l) => l.includes('另有'))).toBe(true)
    expect(card.actions).toBeUndefined() // KD-6 零按钮
  })
})

describe('DutyBriefingService', () => {
  it('unbound: no target thread → no delivery', async () => {
    const h = harness()
    const service = new DutyBriefingService(h.ctx)
    const result = await service.generate({ userId: USER })
    expect(result).toEqual({ delivered: false, outcome: 'unbound' })
  })

  it('delivers once per day (INV-5) and skips the second run', async () => {
    const h = harness()
    h.stores.threads().create({ id: 'thread_brief', userId: USER_ID, title: '值班台' })
    // blocked task aged 2d → needsUser zone
    h.stores.tasks().create({
      threadId: 'thread_brief',
      title: '修复推送失败',
      userId: USER,
      catId: CAT_A,
      description: '等待人工确认配置',
      status: 'blocked',
      kind: 'work',
    })
    // failed invocation → deadBalls zone
    const inv = await h.stores.invocationRecords().create({
      threadId: createThreadId('thread_1'),
      userId: USER_ID,
      catIds: [CAT_A],
      source: 'user',
    })
    if (inv.outcome === 'created') {
      await h.stores.invocationRecords().update({ invocationId: inv.invocationId, status: 'failed', error: 'boom' })
    }

    const service = new DutyBriefingService(h.ctx, { targetThreadId: 'thread_brief', defaultUserId: USER })
    const now = Date.now()
    const first = await service.generate({ now })
    expect(first.delivered).toBe(true)
    expect(first.outcome).toBe('delivered')
    expect(first.threadId).toBe('thread_brief')

    // 卡片真实投递到 message store（origin=briefing + 稳定 card id）
    const messages = await h.stores.messages().getByThread('thread_brief')
    expect(messages.some((m) => m.origin === 'briefing')).toBe(true)

    const second = await service.generate({ now: now + 60_000 })
    expect(second.delivered).toBe(false)
    expect(second.outcome).toBe('already-sent-today')
  })

  it('degraded binding without fallback → error outcome, not silent (INV-2)', async () => {
    const h = harness()
    const service = new DutyBriefingService(h.ctx, { targetThreadId: 'thread_missing' })
    const result = await service.generate({ userId: USER })
    expect(result.delivered).toBe(false)
    expect(result.outcome).toBe('degraded-no-fallback')
  })

  it('degraded binding with fallback delivers to the fallback thread', async () => {
    const h = harness()
    h.stores.threads().create({ id: 'thread_fb', userId: USER_ID, title: '值班台备用' })
    const service = new DutyBriefingService(h.ctx, { targetThreadId: 'thread_missing' })
    const result = await service.generate({ userId: USER, fallbackThreadId: 'thread_fb' })
    expect(result.delivered).toBe(true)
    expect(result.outcome).toBe('degraded-delivered')
    expect(result.threadId).toBe('thread_fb')
  })
})
