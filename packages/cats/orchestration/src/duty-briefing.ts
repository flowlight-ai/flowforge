/**
 * DutyBriefingService — 值班简报生成 + 投递 Cordis 服务（F233 Phase A）。
 *
 * 移植自 clowder-ai `duty-briefing/` 域（R13 一切皆插件改造），流程保持
 * collect（薄 IO，KD-4 全程只读）→ aggregate（纯投影聚合）→ render（纯渲染）
 * → deliver（唯一写副作用）四段：
 * - 数据源裁剪：flowforge 无 DynamicTaskStore（hold_ball）与 F167 telemetry
 *   （void-pass），对应 collector 省略（区保留、恒空）；invocation 死球检测
 *   仅覆盖 failed 记录（无 draft store，running 以 updatedAt 为心跳计健康）
 * - 聚合器/渲染器为纯函数原样移植（KD-3 异常优先、AC-A4 ≤15 行预算 +
 *   晾龄降序保留、KD-6 零按钮、INV-2 degraded 不静默、INV-5 当日重发跳过）
 * - 投递经 `ctx.catStores.messages().append`（origin='briefing' + 稳定 card id
 *   幂等键）；`Context` 挂载点：`ctx.catsDutyBriefing`
 *
 * @module @flowforge/cats-orchestration/duty-briefing
 */

import { Context, Service } from '@flowforge/cordis'
import { createUserId } from '@flowforge/cats-shared'
import type {
  BallEntry,
  CatId,
  DutyBriefing,
  RichCardBlock,
} from '@flowforge/cats-shared'
import type { StoredMessage } from '@flowforge/cats-stores'
import {
  BRIEFING_SCAN_BATCH,
  DEAD_BALL_ZOMBIE_GRACE_MS,
  DUTY_BRIEFING_CARD_ID,
  MAX_BRIEFING_BODY_LINES,
  MENTION_SCAN_ACTIVE_WINDOW_MS,
  NEEDS_USER_BLOCKED_MIN_MS,
  STALE_BLOCKED_THRESHOLD_MS,
  TITLE_MAX,
} from './invariant.ts'

// ---------------------------------------------------------------------------
// Aggregator input types（窄 Input：只声明聚合用到的字段）
// ---------------------------------------------------------------------------

export interface AggregatorTask {
  id: string
  title: string
  ownerCatId: string | null
  status: string // 'todo' | 'doing' | 'blocked' | 'done'
  why: string
  updatedAt: number
  threadId: string
}

export interface AggregatorZombie {
  invocationId: string
  threadId: string
  catId: string | null
  recordUpdatedAt: number
  detail?: string
}

export interface AggregatorMentionCandidate {
  threadId: string
  messageId: string
  catId: string | null
  title: string
  timestamp: number
}

export interface DutyBriefingInput {
  tasks: AggregatorTask[]
  zombies: AggregatorZombie[]
  mentionCandidates: AggregatorMentionCandidate[]
  /** threadId→title 映射（zombie 条目标题用）。 */
  threadTitles: Record<string, string>
  /** 健康活球计数（doing task + active invocation）。 */
  activeCount: number
  /** 健康球里最老的心跳（ms 时长）。 */
  oldestHeartbeatMs: number
  bindingStatus: 'bound' | 'degraded'
  degradedSources: string[]
  now: number
}

// ---------------------------------------------------------------------------
// 纯聚合器（KD-4 零写副作用）
// ---------------------------------------------------------------------------

/** exactOptionalPropertyTypes-safe holder spread (`holder` omitted when null). */
function holderOf(catId: string | null | undefined): { holder?: NonNullable<BallEntry['holder']> } {
  return catId == null ? {} : { holder: catId as NonNullable<BallEntry['holder']> }
}

/** exactOptionalPropertyTypes-safe detail spread (`detail` omitted when empty). */
function detailOf(detail: string | null | undefined): { detail?: string } {
  const trimmed = detail?.trim()
  return trimmed ? { detail: trimmed } : {}
}

const byAgeDesc = (a: BallEntry, b: BallEntry): number => b.ageMs - a.ageMs

function truncateTitle(label: string): string {
  return label.length > TITLE_MAX ? `${label.slice(0, TITLE_MAX - 1)}…` : label
}

/** blocked task 超龄 >7d → staleBlocked（睡美人近似）。 */
function tasksToStaleBlocked(tasks: AggregatorTask[], now: number): BallEntry[] {
  return tasks
    .filter((t) => t.status === 'blocked' && now - t.updatedAt > STALE_BLOCKED_THRESHOLD_MS)
    .map((t) => ({
      kind: 'task' as const,
      confidence: 'structured' as const,
      title: truncateTitle(t.title),
      ageMs: now - t.updatedAt,
      ...holderOf(t.ownerCatId),
      anchor: { taskId: t.id, threadId: t.threadId },
      ...detailOf(t.why),
    }))
}

/** blocked task 1d~7d → needsUser（结构化搁置球，AC-A2 防过敏）。 */
function tasksToNeedsUser(tasks: AggregatorTask[], now: number): BallEntry[] {
  return tasks
    .filter((t) => {
      if (t.status !== 'blocked') return false
      const age = now - t.updatedAt
      return age >= NEEDS_USER_BLOCKED_MIN_MS && age <= STALE_BLOCKED_THRESHOLD_MS
    })
    .map((t) => ({
      kind: 'task' as const,
      confidence: 'structured' as const,
      title: truncateTitle(t.title),
      ageMs: now - t.updatedAt,
      ...holderOf(t.ownerCatId),
      anchor: { taskId: t.id, threadId: t.threadId },
      ...detailOf(t.why),
    }))
}

/** mention 尾部 @co-creator 无后续 → needsUser（启发式候选，confidence=heuristic）。 */
function mentionsToNeedsUser(candidates: AggregatorMentionCandidate[], now: number): BallEntry[] {
  return candidates.map((c) => ({
    kind: 'mention-heuristic' as const,
    confidence: 'heuristic' as const,
    title: truncateTitle(c.title),
    ageMs: now - c.timestamp,
    ...holderOf(c.catId),
    anchor: { threadId: c.threadId, messageId: c.messageId },
  }))
}

/** invocation zombie → deadBalls。 */
function zombiesToDeadBalls(
  zombies: AggregatorZombie[],
  now: number,
  threadTitles: Record<string, string>,
): BallEntry[] {
  return zombies.map((z) => {
    const tTitle = threadTitles[z.threadId]
    const label = tTitle || (z.catId ? `${z.catId} 无心跳` : '调用无心跳')
    return {
      kind: 'invocation-death' as const,
      confidence: 'structured' as const,
      title: truncateTitle(label),
      ageMs: now - z.recordUpdatedAt,
      ...holderOf(z.catId),
      anchor: { threadId: z.threadId, invocationId: z.invocationId },
      ...detailOf(z.detail),
    }
  })
}

/** 纯函数聚合：DutyBriefingInput → DutyBriefing（KD-3 异常优先，区内晾龄降序）。 */
export function aggregateDutyBriefing(input: DutyBriefingInput): DutyBriefing {
  const needsUser = [
    ...tasksToNeedsUser(input.tasks, input.now),
    ...mentionsToNeedsUser(input.mentionCandidates, input.now),
  ].sort(byAgeDesc)
  const deadBalls = zombiesToDeadBalls(input.zombies, input.now, input.threadTitles).sort(byAgeDesc)

  return {
    generatedAt: input.now,
    bindingStatus: input.bindingStatus,
    counts: {
      active: input.activeCount,
      needsUser: needsUser.length,
      dead: deadBalls.length,
      voidPass: 0,
      staleBlocked: tasksToStaleBlocked(input.tasks, input.now).length,
    },
    needsUser,
    deadBalls,
    voidPasses: [],
    staleBlocked: tasksToStaleBlocked(input.tasks, input.now).sort(byAgeDesc),
    healthy: { count: input.activeCount, oldestHeartbeatMs: input.oldestHeartbeatMs },
    degradedSources: input.degradedSources,
  }
}

// ---------------------------------------------------------------------------
// 纯渲染器（KD-6 零按钮；AC-A4 ≤15 行预算）
// ---------------------------------------------------------------------------

const SECTION_EMOJI: Record<string, string> = {
  needsUser: '🔴',
  deadBalls: '💀',
  voidPasses: '⚠️',
  staleBlocked: '💤',
}

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}天`
}

function entryLine(emoji: string, e: BallEntry): string {
  const url = e.anchor.threadId ? `/thread/${e.anchor.threadId}` : null
  const title = url ? `[${e.title}](${url})` : e.title
  const tags: string[] = []
  if (e.holder) tags.push(`@${e.holder}`)
  tags.push(`晾${formatAge(e.ageMs)}`)
  if (e.confidence === 'heuristic') tags.push('推断')
  if (!url) tags.push('无跳转')
  return `${emoji} ${title} · ${tags.join(' · ')}`
}

interface TaggedEntry {
  emoji: string
  entry: BallEntry
}

/** 按区顺序（needsUser→dead→stale）展平，区内已是晾龄降序。 */
function flattenEntries(briefing: DutyBriefing): TaggedEntry[] {
  return [
    ...briefing.needsUser.map((entry) => ({ emoji: SECTION_EMOJI.needsUser!, entry })),
    ...briefing.deadBalls.map((entry) => ({ emoji: SECTION_EMOJI.deadBalls!, entry })),
    ...briefing.voidPasses.map((entry) => ({ emoji: SECTION_EMOJI.voidPasses!, entry })),
    ...briefing.staleBlocked.map((entry) => ({ emoji: SECTION_EMOJI.staleBlocked!, entry })),
  ]
}

function sectionsInPriorityOrder(briefing: DutyBriefing): TaggedEntry[][] {
  return [
    briefing.needsUser.map((entry) => ({ emoji: SECTION_EMOJI.needsUser!, entry })),
    briefing.deadBalls.map((entry) => ({ emoji: SECTION_EMOJI.deadBalls!, entry })),
    briefing.voidPasses.map((entry) => ({ emoji: SECTION_EMOJI.voidPasses!, entry })),
    briefing.staleBlocked.map((entry) => ({ emoji: SECTION_EMOJI.staleBlocked!, entry })),
  ]
}

function selectEntriesWithinBudget(
  briefing: DutyBriefing,
  keep: number,
): { visible: TaggedEntry[]; truncated: number } {
  const all = flattenEntries(briefing)
  if (all.length <= keep) return { visible: all, truncated: 0 }

  // 优先保区（每区至少 1 条），再按区序/区内晾龄降序填满
  const sections = sectionsInPriorityOrder(briefing)
  const selected = new Set<BallEntry>()
  let slots = keep
  for (const section of sections) {
    if (slots <= 0) break
    const first = section[0]?.entry
    if (!first) continue
    selected.add(first)
    slots -= 1
  }
  for (const section of sections) {
    if (slots <= 0) break
    for (const tagged of section) {
      if (slots <= 0) break
      if (selected.has(tagged.entry)) continue
      selected.add(tagged.entry)
      slots -= 1
    }
  }

  const visible = all.filter((tagged) => selected.has(tagged.entry))
  return { visible, truncated: all.length - visible.length }
}

/** DutyBriefing → rich card payload（渲染纯函数，对齐 clowder-ai renderBriefingCard）。 */
export function renderBriefingCard(briefing: DutyBriefing): RichCardBlock {
  const { counts, healthy } = briefing

  const countLine = `🔴 ${counts.needsUser} 需要你 · 💀 ${counts.dead} 死球 · ⚠️ ${counts.voidPass} 虚空 · 💤 ${counts.staleBlocked} 睡美人 · 🟢 ${counts.active} 正常`
  const healthyLine = `🟢 其余 ${healthy.count} 颗正常推进 · 最老心跳 ${formatAge(healthy.oldestHeartbeatMs)}`
  const degradedLine = briefing.bindingStatus === 'degraded' ? '⚠️ 简报 thread 绑定失效，已降级投递' : null
  const degradedSourcesLine =
    briefing.degradedSources.length > 0 ? `⚠️ 数据降级：${briefing.degradedSources.join(' / ')}` : null

  // ≤15 行预算（AC-A4）：扣固定行，余下给异常条目
  const fixedLines = 1 + 1 + (degradedLine ? 1 : 0) + (degradedSourcesLine ? 1 : 0)
  const entryBudget = MAX_BRIEFING_BODY_LINES - fixedLines

  let visible = flattenEntries(briefing)
  let truncated = 0
  if (visible.length > entryBudget) {
    // 留一行给折叠提示；优先保区，再按晾龄降序保留更紧急条目
    const keep = Math.max(0, entryBudget - 1)
    ;({ visible, truncated } = selectEntriesWithinBudget(briefing, keep))
  }

  const lines: string[] = [countLine]
  if (degradedLine) lines.push(degradedLine)
  if (degradedSourcesLine) lines.push(degradedSourcesLine)
  for (const t of visible) lines.push(entryLine(t.emoji, t.entry))
  if (truncated > 0) lines.push(`… 另有 ${truncated} 条（晾龄较短，已折叠）`)
  lines.push(healthyLine)

  const hasAlarm = counts.needsUser + counts.dead + counts.voidPass + counts.staleBlocked > 0

  return {
    id: DUTY_BRIEFING_CARD_ID,
    kind: 'card',
    v: 1,
    title: '☀️ 值班简报',
    tone: hasAlarm ? 'warning' : 'info',
    bodyMarkdown: lines.join('\n'),
    // KD-6: 无 actions（零按钮）——唯一交互是 bodyMarkdown 里的锚点链接
  }
}

// ---------------------------------------------------------------------------
// Cordis 服务（collect + deliver 编排）
// ---------------------------------------------------------------------------

export type GenerateOutcome =
  | 'unbound' // 无绑定 → 不投递
  | 'already-sent-today' // INV-5：当日已发，跳过
  | 'delivered' // 正常投递
  | 'degraded-delivered' // 绑定失效但降级到 fallback 投递（INV-2）
  | 'degraded-no-fallback' // 绑定失效且无 fallback → 调用方记 error，不静默

export interface GenerateResult {
  delivered: boolean
  outcome: GenerateOutcome
  threadId?: string
  messageId?: string
}

export interface DutyBriefingOptions {
  /** 简报目标 thread（未配置 → unbound，不投递）。 */
  targetThreadId?: string
  /** 默认 viewer userId（mention 扫描 + 投递可见性）。 */
  defaultUserId?: string
}

/** 单 collector 失败不崩整卡：catch → 记 degradedSources + 返回 fallback。 */
async function safeCollect<T>(
  source: string,
  fn: () => Promise<T> | T,
  fallback: T,
  degradedSources: string[],
): Promise<T> {
  try {
    return await fn()
  } catch {
    degradedSources.push(source)
    return fallback
  }
}

/** 系统产物消息（briefing 等）不算 operator 回应。 */
function isSystemProductMessage(m: StoredMessage): boolean {
  return m.userId === 'system' || m.origin === 'briefing'
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) 值班简报 — mounted by `@flowforge/cats-orchestration`.
     */
    catsDutyBriefing: DutyBriefingService
  }
}

/**
 * Cordis service exposing the duty briefing pipeline at `ctx.catsDutyBriefing`.
 */
export class DutyBriefingService extends Service {
  static inject = ['catStores']

  readonly targetThreadId: string | undefined
  readonly defaultUserId: string

  constructor(ctx: Context, options: DutyBriefingOptions = {}) {
    super(ctx, 'catsDutyBriefing')
    this.targetThreadId = options.targetThreadId
    this.defaultUserId = options.defaultUserId ?? 'default-user'
  }

  /**
   * Generate + deliver the briefing (on-demand route 与 daily cron 共用编排)。
   * KD-4 只读：除最终投递（唯一写）外全程只读。
   */
  async generate(options?: {
    userId?: string
    fallbackThreadId?: string
    now?: number
  }): Promise<GenerateResult> {
    const userId = options?.userId ?? this.defaultUserId
    const now = options?.now ?? Date.now()

    if (!this.targetThreadId) {
      return { delivered: false, outcome: 'unbound' }
    }

    const stores = this.ctx.catStores
    let deliverThreadId = this.targetThreadId
    let bindingStatus: 'bound' | 'degraded' = 'bound'

    const targetThread = await stores.threads().getById(this.targetThreadId)
    if (!targetThread || targetThread.archivedAt) {
      bindingStatus = 'degraded'
      // INV-2 不静默：降级到 fallback；无 fallback → error outcome
      if (!options?.fallbackThreadId) {
        return { delivered: false, outcome: 'degraded-no-fallback', threadId: this.targetThreadId }
      }
      deliverThreadId = options.fallbackThreadId
    }

    // INV-5 当日重发判定（纯投影，零新存储）
    if (await this.hasBriefingToday(deliverThreadId, now)) {
      return { delivered: false, outcome: 'already-sent-today', threadId: deliverThreadId }
    }

    const input = await this.collectInput(userId, bindingStatus, now)
    const briefing = aggregateDutyBriefing(input)
    const card = renderBriefingCard(briefing)

    const messageId = await this.deliverCard(deliverThreadId, card, now)
    return {
      delivered: true,
      outcome: bindingStatus === 'degraded' ? 'degraded-delivered' : 'delivered',
      threadId: deliverThreadId,
      messageId,
    }
  }

  /** 数据获取层：3 源只读投影（tasks / invocation zombies / mention 启发式）。 */
  async collectInput(
    userId: string,
    bindingStatus: 'bound' | 'degraded',
    now: number,
  ): Promise<DutyBriefingInput> {
    const stores = this.ctx.catStores
    const degradedSources: string[] = []

    const threads = await safeCollect(
      'threads',
      () => stores.threads().listForUser(createUserId(userId)),
      [],
      degradedSources,
    )
    const threadTitles: Record<string, string> = {}
    for (const t of threads) {
      if (t.title) threadTitles[t.id] = t.title
    }

    const tasks = await safeCollect(
      'tasks',
      async () => {
        const stored = await stores.tasks().listForUser(userId)
        return stored.map((t) => ({
          id: t.id,
          title: t.title,
          ownerCatId: t.catId ?? null,
          status: t.status,
          why: t.description ?? '',
          updatedAt: t.updatedAt,
          threadId: t.threadId,
        })) satisfies AggregatorTask[]
      },
      [] as AggregatorTask[],
      degradedSources,
    )

    // invocation 死球（裁剪版）：scanAll 缺失 → degraded；failed → zombie；
    // running 无 draft store → 超过 grace 才算僵尸，否则计健康
    // （心跳 = 最近一次状态迁移：executionStartedAt ?? createdAt）
    const invocation = await safeCollect(
      'invocation',
      async () => {
        const recordStore = stores.invocationRecords()
        const scanAll = recordStore.scanAll
        if (!scanAll) {
          degradedSources.push('invocation')
          return { zombies: [] as AggregatorZombie[], runningCount: 0, oldestHealthyAgeMs: 0 }
        }
        const records = await scanAll.call(recordStore)
        const ownerRecords = records.filter((r) => r.userId === userId)
        const zombies: AggregatorZombie[] = ownerRecords
          .filter((r) => r.status === 'failed')
          .map((r) => ({
            invocationId: r.invocationId,
            threadId: r.threadId,
            catId: r.catIds[0] ?? null,
            recordUpdatedAt: r.settledAt ?? r.executionStartedAt ?? r.createdAt,
            detail: r.error ?? 'invocation_failed',
          }))
        let runningCount = 0
        let oldestHealthyAgeMs = 0
        for (const r of ownerRecords) {
          if (r.status !== 'running') continue
          const heartbeat = r.executionStartedAt ?? r.createdAt
          if (now - heartbeat > DEAD_BALL_ZOMBIE_GRACE_MS) {
            zombies.push({
              invocationId: r.invocationId,
              threadId: r.threadId,
              catId: r.catIds[0] ?? null,
              recordUpdatedAt: heartbeat,
              detail: 'no_tracker_no_fresh_draft',
            })
          } else {
            runningCount += 1
            oldestHealthyAgeMs = Math.max(oldestHealthyAgeMs, now - heartbeat)
          }
        }
        return { zombies, runningCount, oldestHealthyAgeMs }
      },
      { zombies: [] as AggregatorZombie[], runningCount: 0, oldestHealthyAgeMs: 0 },
      degradedSources,
    )

    // mention 启发式：近期活跃 thread 尾部「猫 @co-creator 后 operator 无回应」
    const mentionCandidates = await safeCollect(
      'mention',
      async () => {
        const messageStore = stores.messages()
        const candidates: AggregatorMentionCandidate[] = []
        for (const thread of threads) {
          const lastActiveAt = thread.lastMessageAt ?? thread.updatedAt
          if (now - lastActiveAt > MENTION_SCAN_ACTIVE_WINDOW_MS) continue
          const tail = await messageStore.getByThread(thread.id, 1, userId)
          const last = tail[tail.length - 1]
          if (!last || !last.mentionsUser || last.catId == null) continue
          const after = await messageStore.getByThreadAfter(thread.id, last.id, undefined, userId)
          // 真正的 operator 已回应 → 球不在 operator 手上
          if (after.some((m) => m.catId == null && !isSystemProductMessage(m))) continue
          candidates.push({
            threadId: thread.id,
            messageId: last.id,
            catId: last.catId as CatId | null,
            title: deriveTitle(last.content, thread.title ?? null),
            timestamp: last.timelineOrderAt ?? last.timestamp,
          })
        }
        return candidates
      },
      [] as AggregatorMentionCandidate[],
      degradedSources,
    )

    const doingCount = tasks.filter((t) => t.status === 'doing').length
    const oldestTaskHeartbeatMs = (() => {
      const doing = tasks.filter((t) => t.status === 'doing')
      if (doing.length === 0) return 0
      return now - Math.min(...doing.map((t) => t.updatedAt))
    })()

    return {
      tasks,
      zombies: invocation.zombies,
      mentionCandidates,
      threadTitles,
      activeCount: doingCount + invocation.runningCount,
      oldestHeartbeatMs: Math.max(oldestTaskHeartbeatMs, invocation.oldestHealthyAgeMs),
      bindingStatus,
      degradedSources,
      now,
    }
  }

  /** 投递简报卡（唯一写副作用，KD-4）：origin='briefing' + 幂等键。 */
  private async deliverCard(threadId: string, card: RichCardBlock, now: number): Promise<string> {
    const msg = await this.ctx.catStores.messages().append({
      threadId,
      userId: 'system',
      catId: null,
      content: card.title,
      mentions: [],
      timestamp: now,
      origin: 'briefing',
      metadata: { rich: { v: 1, blocks: [card] } },
      idempotencyKey: `${DUTY_BRIEFING_CARD_ID}:${threadId}:${dayKeyLocal(now)}`,
    })
    return msg.id
  }

  /**
   * INV-5: 目标 thread 当日是否已发值班简报卡（纯投影）。
   * 裁剪版：扫描最近 BRIEFING_SCAN_BATCH 条消息（简报至多每日一投，
   * flowforge message store 无 before 游标翻页）。
   */
  private async hasBriefingToday(threadId: string, now: number): Promise<boolean> {
    const todayKey = dayKeyLocal(now)
    const batch = await this.ctx.catStores.messages().getByThread(threadId, BRIEFING_SCAN_BATCH)
    return batch.some(
      (m) =>
        m.origin === 'briefing' &&
        isDutyBriefingCard(m) &&
        dayKeyLocal(m.timelineOrderAt ?? m.timestamp) === todayKey,
    )
  }
}

/** 识别一条消息是否值班简报卡（origin='briefing' + 稳定 card id）。 */
function isDutyBriefingCard(m: StoredMessage): boolean {
  const blocks = (m.metadata?.rich as { blocks?: Array<{ kind?: string; id?: string }> } | undefined)?.blocks ?? []
  return blocks.some((b) => b.kind === 'card' && b.id === DUTY_BRIEFING_CARD_ID)
}

/** 本地时区 YYYY-MM-DD（简报当日判定与投递幂等键同源）。 */
function dayKeyLocal(timestamp: number): string {
  const d = new Date(timestamp)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** mention 条目标题：thread 标题优先，消息首行 fallback。 */
function deriveTitle(content: string, threadTitle: string | null): string {
  const firstLine = content
    .split('\n')
    .find((l) => l.trim().length > 0)
    ?.trim()
  const raw = threadTitle || firstLine || '(无标题)'
  return truncateTitle(raw)
}
