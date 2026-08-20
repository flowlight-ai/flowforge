/**
 * ISignalArticleStore — signal-hunter article store port.
 *
 * Added in stage-5 batch 7 (T5.7.3): abstracts the clowder-ai
 * `article-store.ts` + `article-document.ts` + `inbox-records.ts` file-system
 * semantics (markdown library + per-day inbox JSON index) behind a single
 * port. 查询服务（SignalArticleQueryService）只依赖此接口，与存储形态解耦；
 * Memory 后端提供进程内实现，Sqlite 后端可增量接入。
 *
 * @module @flowforge/cats-stores/ports
 */

import type { SignalArticle, SignalArticleStatus, SignalSource } from '@flowforge/cats-shared'

/** A stored article with its full body content (search haystack). */
export interface SignalArticleDetail {
  readonly article: SignalArticle
  readonly content: string
}

/** Input for storing a fetched article. */
export interface UpsertSignalArticleInput {
  readonly source: SignalSource
  readonly title: string
  readonly url: string
  readonly publishedAt: string
  readonly content?: string
  readonly summary?: string
  readonly articleId?: string
  readonly fetchedAt?: string
  readonly status?: SignalArticleStatus
  readonly tags?: readonly string[]
}

/** Mutable fields for updating an article. */
export interface UpdateSignalArticlePatch {
  readonly status?: SignalArticleStatus
  readonly tags?: readonly string[]
  readonly summary?: string
  readonly note?: string
  readonly deletedAt?: string
}

/** Common interface for signal article stores. */
export interface ISignalArticleStore {
  /** Store (or overwrite by id) an article; returns the stored record. */
  upsert(input: UpsertSignalArticleInput): SignalArticle | Promise<SignalArticle>
  /** List all stored articles (metadata only, newest first). */
  listArticles(): SignalArticle[] | Promise<SignalArticle[]>
  /** Get a single article with content by id. */
  getById(id: string): SignalArticleDetail | null | Promise<SignalArticleDetail | null>
  /** Get a single article with content by normalized URL. */
  getByUrl(url: string): SignalArticleDetail | null | Promise<SignalArticleDetail | null>
  /** Patch mutable fields; returns the updated detail or null when missing. */
  update(id: string, patch: UpdateSignalArticlePatch): SignalArticleDetail | null | Promise<SignalArticleDetail | null>
}

export type { SignalArticle, SignalArticleStatus, SignalSource }
