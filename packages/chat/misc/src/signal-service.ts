/**
 * ChatSignalService — signal-hunter 服务（T5.7.3）。
 *
 * 移植 clowder-ai `routes/signals.ts`（api/src/routes/）的路由语义为 Cordis
 * 服务（R13 一切皆插件改造）：
 * - inbox/articles/search/update/stats：委托 SignalArticleQueryService
 *   （存储经 catStores.signalArticles()）
 * - sources 列表/更新：经 `SignalSourceStore` 缝（默认进程内配置存储）+
 *   SerialTaskQueue 串行化更新（对齐 clowder）
 * - fetch/enrich/backfill：注入缝（真实调度器在 composition root 装配）
 *
 * @module @flowforge/chat-misc
 */

import { Context, Service } from '@flowforge/cordis'
import type { SignalArticle, SignalArticleStatus, SignalSource, SignalSourceConfig, SignalTier } from '@flowforge/cats-shared'
import { SignalArticleQueryService, type ListInboxOptions, type SearchSignalArticlesOptions, type UpdateSignalArticleInput } from './signal-query.ts'

/** SignalSource 配置存储缝。 */
export interface SignalSourceStore {
  load(): SignalSourceConfig | Promise<SignalSourceConfig>
  save(config: SignalSourceConfig): void | Promise<void>
}

/** 进程内 source 配置存储（缺省缝实现）。 */
class InMemorySignalSourceStore implements SignalSourceStore {
  private config: SignalSourceConfig = { version: 1, sources: [] }
  load(): SignalSourceConfig {
    return this.config
  }
  save(config: SignalSourceConfig): void {
    this.config = config
  }
}

/** Fetch 调度摘要（clowder runSignalFetchScheduler 返回契约）。 */
export interface SignalFetchSummary {
  readonly storedArticles: number
  readonly errors: readonly string[]
}

/** Enrich 结果（clowder enrichArticleContent 返回契约）。 */
export interface SignalEnrichResult {
  readonly reason: 'ok' | 'not_found' | 'fetch_failed' | 'unchanged'
  readonly articleId?: string
  readonly summary?: string
}

/** 串行任务队列（clowder SerialTaskQueue 移植）。 */
class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve()

  async run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task)
    this.tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

/** ChatSignalService 选项。 */
export interface ChatSignalServiceOptions {
  /** Source 配置存储（缺省进程内实现）。 */
  sourceStore?: SignalSourceStore
  /** 单源抓取调度（注入缝，缺省 503 语义）。 */
  fetchSource?: (sourceId: string) => Promise<SignalFetchSummary>
  /** 文章富化（注入缝，缺省 not_found 语义）。 */
  enrichArticle?: (articleId: string) => Promise<SignalEnrichResult>
  /** 单源回填（注入缝，缺省 503 语义）。 */
  backfillSource?: (sourceId: string) => Promise<unknown>
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Signal-hunter 服务（T5.7.3）— mounted by `@flowforge/chat-misc`. */
    chatSignals: ChatSignalService
  }
}

/**
 * Signal 服务。挂载点 `ctx.chatSignals`（`@flowforge/chat-misc`）。
 */
export class ChatSignalService extends Service {
  static inject = ['catStores']

  readonly query: SignalArticleQueryService
  private readonly sourceStore: SignalSourceStore
  private readonly fetchSource: ((sourceId: string) => Promise<SignalFetchSummary>) | undefined
  private readonly enrichArticle: ((articleId: string) => Promise<SignalEnrichResult>) | undefined
  private readonly backfillSource: ((sourceId: string) => Promise<unknown>) | undefined
  private readonly sourceUpdateQueue = new SerialTaskQueue()

  constructor(ctx: Context, options: ChatSignalServiceOptions = {}) {
    super(ctx, 'chatSignals')
    this.sourceStore = options.sourceStore ?? new InMemorySignalSourceStore()
    this.fetchSource = options.fetchSource
    this.enrichArticle = options.enrichArticle
    this.backfillSource = options.backfillSource
    this.query = new SignalArticleQueryService({ store: ctx.catStores.signalArticles() })
  }

  // -------------------------------------------------------------------------
  // Article queries (delegated to SignalArticleQueryService)
  // -------------------------------------------------------------------------

  /** 列出 inbox 文章。 */
  listInbox(options: ListInboxOptions = {}): Promise<readonly SignalArticle[]> {
    return this.query.listInbox(options)
  }

  /** 按 id 获取文章。 */
  getArticle(id: string): Promise<SignalArticle | null> {
    return this.query.getArticleById(id)
  }

  /** 按 URL 获取文章。 */
  getArticleByUrl(url: string): Promise<SignalArticle | null> {
    return this.query.getArticleByUrl(url)
  }

  /** 全文搜索。 */
  search(options: SearchSignalArticlesOptions): Promise<{ readonly total: number; readonly items: readonly SignalArticle[] }> {
    return this.query.search(options)
  }

  /** 更新文章（status/tags/summary/note/deletedAt）。 */
  updateArticle(id: string, input: UpdateSignalArticleInput): Promise<SignalArticle | null> {
    return this.query.updateArticle(id, input)
  }

  /** 统计。 */
  getStats(now?: Date) {
    return this.query.getStats(now)
  }

  // -------------------------------------------------------------------------
  // Sources (serialized config updates)
  // -------------------------------------------------------------------------

  /** 列出全部 signal sources。 */
  async listSources(): Promise<readonly SignalSource[]> {
    const config = await this.sourceStore.load()
    return config.sources
  }

  /** 更新 source enabled 状态（串行化，防并发覆盖）。 */
  async updateSource(id: string, patch: { enabled: boolean }): Promise<SignalSource | null> {
    return this.sourceUpdateQueue.run(async () => {
      const config = await this.sourceStore.load()
      const target = config.sources.find((source) => source.id === id)
      if (!target) return null

      const updatedSources = config.sources.map((source) =>
        source.id === id ? { ...source, enabled: patch.enabled } : source,
      )
      await this.sourceStore.save({ ...config, sources: updatedSources })
      return { ...target, enabled: patch.enabled }
    })
  }

  // -------------------------------------------------------------------------
  // Fetch / enrich / backfill (injected seams)
  // -------------------------------------------------------------------------

  /** 触发单源抓取调度。未注入缝时抛 503 语义错误。 */
  async fetchSourceById(sourceId: string): Promise<SignalFetchSummary> {
    if (!this.fetchSource) {
      throw new Error('signal fetch scheduler is not wired (503)')
    }
    return this.fetchSource(sourceId)
  }

  /** 触发文章富化。未注入缝时返回 not_found 语义。 */
  enrichArticleById(articleId: string): Promise<SignalEnrichResult> {
    return this.enrichArticle
      ? this.enrichArticle(articleId)
      : Promise.resolve({ reason: 'not_found', articleId })
  }

  /** 触发单源回填。未注入缝时抛 503 语义错误。 */
  async backfill(sourceId: string): Promise<unknown> {
    if (!this.backfillSource) {
      throw new Error('signal backfill is not wired (503)')
    }
    return this.backfillSource(sourceId)
  }
}

export type { SignalArticleStatus, SignalTier }
