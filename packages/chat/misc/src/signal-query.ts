/**
 * SignalArticleQueryService — signal-hunter 文章查询服务（T5.7.3）。
 *
 * 移植 clowder-ai `article-query-service.ts` + `article-stats.ts`
 * （api/src/domains/signals/services/）的查询语义为 Cordis 插件服务依赖
 * （R13 一切皆插件改造）：存储经 `ISignalArticleStore` 注入（stage-5
 * batch 7 提升），study-meta 富化（studyCount/lastStudiedAt）作为注入缝，
 * 缺省不做富化 —— 与文件系统/Redis 形态解耦。
 *
 * @module @flowforge/chat-misc
 */

import type { SignalArticle, SignalArticleStatus, SignalTier } from '@flowforge/cats-shared'
import type { ISignalArticleStore, UpdateSignalArticlePatch } from '@flowforge/cats-stores'

export interface ListInboxOptions {
  readonly date?: string | undefined
  readonly limit?: number | undefined
  readonly source?: string | undefined
  readonly tier?: SignalTier | undefined
  readonly status?: SignalArticleStatus | 'all' | undefined
}

export interface SearchSignalArticlesOptions {
  readonly query: string
  readonly limit?: number | undefined
  readonly status?: SignalArticleStatus | undefined
  readonly source?: string | undefined
  readonly tier?: SignalTier | undefined
  readonly dateFrom?: string | undefined
  readonly dateTo?: string | undefined
}

export interface UpdateSignalArticleInput {
  readonly status?: SignalArticleStatus | undefined
  readonly tags?: readonly string[] | undefined
  readonly summary?: string | undefined
  readonly note?: string | undefined
  readonly deletedAt?: string | undefined
}

/** Signal 文章统计（clowder article-stats.ts 契约）。 */
export interface SignalArticleStats {
  readonly todayCount: number
  readonly weekCount: number
  readonly unreadCount: number
  readonly byTier: Record<string, number>
  readonly bySource: Record<string, number>
}

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_IN_MS = 24 * 60 * 60 * 1000
const DEFAULT_INBOX_LIMIT = 20

function toDateBound(value: string | undefined, fallback: number, mode: 'start' | 'end'): number {
  if (!value) return fallback
  const input = value.trim()
  if (input.length === 0) return fallback
  const parsed = Date.parse(input)
  if (Number.isNaN(parsed)) return fallback
  if (mode === 'end' && ISO_DAY_PATTERN.test(input)) {
    return parsed + DAY_IN_MS - 1
  }
  return parsed
}

function withinDateRange(targetIso: string, from: string | undefined, to: string | undefined): boolean {
  const target = Date.parse(targetIso)
  if (Number.isNaN(target)) return false
  return target >= toDateBound(from, Number.NEGATIVE_INFINITY, 'start') &&
    target <= toDateBound(to, Number.POSITIVE_INFINITY, 'end')
}

function normalizeInboxLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_INBOX_LIMIT
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : DEFAULT_INBOX_LIMIT
}

/** 纯函数统计（clowder computeSignalArticleStats 移植）。 */
export function computeSignalArticleStats(articles: readonly SignalArticle[], now: Date): SignalArticleStats {
  const byTier: Record<string, number> = {}
  const bySource: Record<string, number> = {}

  let todayCount = 0
  let weekCount = 0
  let unreadCount = 0

  const nowMs = now.getTime()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - 6)

  for (const article of articles) {
    const fetchedMs = Date.parse(article.fetchedAt)
    if (Number.isNaN(fetchedMs)) continue

    byTier[String(article.tier)] = (byTier[String(article.tier)] ?? 0) + 1
    bySource[article.source] = (bySource[article.source] ?? 0) + 1

    if (article.status === 'inbox') unreadCount += 1
    if (fetchedMs >= weekStart.getTime() && fetchedMs <= nowMs) weekCount += 1
    if (fetchedMs >= todayStart.getTime() && fetchedMs <= nowMs) todayCount += 1
  }

  return { todayCount, weekCount, unreadCount, byTier, bySource }
}

/** Study-meta 富化缝（clowder StudyMetaService 的窄面）。 */
export type StudyMetaEnricher = (article: SignalArticle) => SignalArticle | Promise<SignalArticle>

/** SignalArticleQueryService 选项。 */
export interface SignalArticleQueryOptions {
  /** 文章存储（缺省经 ctx.catStores.signalArticles()，由 SignalService 装配）。 */
  store?: ISignalArticleStore
  /** Study-meta 富化（缺省恒等 —— 不读文件系统）。 */
  enrich?: StudyMetaEnricher
}

/** 选择满足 inbox 过滤条件的文章（clowder selectInboxArticles 移植）。 */
function selectInboxArticles(articles: readonly SignalArticle[], options: ListInboxOptions, limit: number): SignalArticle[] {
  const sorted = [...articles].sort((l, r) => Date.parse(r.fetchedAt) - Date.parse(l.fetchedAt))
  const selected: SignalArticle[] = []
  const wantedStatus = options.status ?? 'inbox'

  for (const article of sorted) {
    if (article.deletedAt) continue
    if (wantedStatus !== 'all' && article.status !== wantedStatus) continue
    if (options.source && article.source !== options.source) continue
    if (options.tier && article.tier !== options.tier) continue
    selected.push(article)
    if (selected.length >= limit) break
  }
  return selected
}

/**
 * Signal 文章查询服务（纯查询：list/search/update/stats）。
 * 由 `ChatSignalService`（ctx.chatSignals）装配并挂载。
 */
export class SignalArticleQueryService {
  private readonly store: ISignalArticleStore
  private readonly enrich: StudyMetaEnricher

  constructor(options: SignalArticleQueryOptions) {
    if (!options.store) {
      throw new Error('SignalArticleQueryService requires a store (wired via ChatSignalService)')
    }
    this.store = options.store
    this.enrich = options.enrich ?? ((article) => article)
  }

  /** 列出 inbox 文章（date/limit/source/tier/status 过滤）。 */
  async listInbox(options: ListInboxOptions = {}): Promise<readonly SignalArticle[]> {
    const limit = normalizeInboxLimit(options.limit)
    const dateInput = options.date?.trim()
    const date = dateInput && dateInput.length > 0 ? dateInput : undefined

    const all = await this.store.listArticles()
    const filtered = date
      ? all.filter((a) => a.fetchedAt.slice(0, 10) === date)
      : all
    const selected = selectInboxArticles(filtered, options, limit)
    return Promise.all(selected.map((a) => this.enrich(a)))
  }

  /** 按 id 获取文章（含 content）。 */
  async getArticleById(id: string): Promise<SignalArticle | null> {
    const detail = await this.store.getById(id)
    if (!detail) return null
    return this.enrich(detail.article)
  }

  /** 按归一化 URL 获取文章（含 content）。 */
  async getArticleByUrl(url: string): Promise<SignalArticle | null> {
    const input = url.trim()
    if (input.length === 0) return null
    const detail = await this.store.getByUrl(input)
    if (!detail) return null
    return this.enrich(detail.article)
  }

  /** 全文搜索（title/url/source/summary/note/tags/content）。 */
  async search(
    options: SearchSignalArticlesOptions,
  ): Promise<{ readonly total: number; readonly items: readonly SignalArticle[] }> {
    const query = options.query.trim().toLowerCase()
    if (query.length === 0) {
      return { total: 0, items: [] }
    }

    const all = await this.store.listArticles()
    const matched: SignalArticle[] = []
    for (const article of all) {
      if (article.deletedAt) continue
      if (options.status && article.status !== options.status) continue
      if (options.source && article.source !== options.source) continue
      if (options.tier && article.tier !== options.tier) continue
      if (!withinDateRange(article.fetchedAt, options.dateFrom, options.dateTo)) continue

      const detail = await this.store.getById(article.id)
      const haystacks = [
        article.title,
        article.url,
        article.source,
        article.summary ?? '',
        article.note ?? '',
        ...article.tags,
        detail?.content ?? '',
      ].map((value) => value.toLowerCase())
      if (haystacks.some((value) => value.includes(query))) {
        matched.push(article)
      }
    }

    matched.sort((l, r) => Date.parse(r.fetchedAt) - Date.parse(l.fetchedAt))
    const limit = options.limit ?? 20
    const items = await Promise.all(matched.slice(0, limit).map((a) => this.enrich(a)))
    return { total: matched.length, items }
  }

  /** 更新文章可变字段（status/tags/summary/note/deletedAt）。 */
  async updateArticle(id: string, input: UpdateSignalArticleInput): Promise<SignalArticle | null> {
    const patch: UpdateSignalArticlePatch = {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.deletedAt !== undefined ? { deletedAt: input.deletedAt } : {}),
    }
    const updated = await this.store.update(id, patch)
    if (!updated) return null
    return this.enrich(updated.article)
  }

  /** 统计（today/week/unread/byTier/bySource）。 */
  async getStats(now: Date = new Date()): Promise<SignalArticleStats> {
    const all = await this.store.listArticles()
    return computeSignalArticleStats(all.filter((a) => !a.deletedAt), now)
  }
}
