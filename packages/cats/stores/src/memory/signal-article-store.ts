/**
 * MemorySignalArticleStore — in-memory implementation of {@link ISignalArticleStore}.
 *
 * Ported from clowder-ai `article-store.ts` + `article-document.ts` +
 * `inbox-records.ts` (api/src/domains/signals/services/): 文件系统（markdown
 * 库 + 按日 inbox JSON 索引）语义抽象为 Map 存储 —— 文章按 id 索引 + URL
 * 归一化索引（去 tracking 参数/hash/尾部斜杠，对齐 clowder deduplication）。
 *
 * @module @flowforge/cats-stores/memory
 */

import { createHash } from 'node:crypto'
import type { SignalArticle } from '@flowforge/cats-shared'
import type {
  ISignalArticleStore,
  SignalArticleDetail,
  UpdateSignalArticlePatch,
  UpsertSignalArticleInput,
} from '../ports/signal-article-store.ts'

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ref',
])

const SIGNAL_ID_PREFIX = 'signal_'
const SIGNAL_ID_HEX_LENGTH = 24

/** Normalize an article URL for deduplication (tracking params / hash / trailing slash). */
export function normalizeArticleUrl(inputUrl: string): string {
  try {
    const url = new URL(inputUrl.trim())
    url.hash = ''
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
    }

    const keptEntries = Array.from(url.searchParams.entries())
      .filter(([key]) => !TRACKING_QUERY_PARAMS.has(key))
      .sort(([aKey, aValue], [bKey, bValue]) => {
        if (aKey === bKey) return aValue.localeCompare(bValue)
        return aKey.localeCompare(bKey)
      })

    url.search = ''
    for (const [key, value] of keptEntries) {
      url.searchParams.append(key, value)
    }

    return url.toString()
  } catch {
    // Keep a deterministic fallback for malformed URLs.
    return inputUrl.trim()
  }
}

/** Generate a deterministic article ID from a raw URL. */
export function createSignalArticleId(inputUrl: string): string {
  const normalizedUrl = normalizeArticleUrl(inputUrl)
  const digest = createHash('sha256').update(normalizedUrl).digest('hex').slice(0, SIGNAL_ID_HEX_LENGTH)
  return `${SIGNAL_ID_PREFIX}${digest}`
}

/**
 * In-memory signal article store. Not durable across processes — use the
 * Sqlite backend (`@flowforge/cats-stores-sqlite`) for persistence.
 */
export class MemorySignalArticleStore implements ISignalArticleStore {
  private readonly articles = new Map<string, SignalArticleDetail>()
  private readonly byNormalizedUrl = new Map<string, string>()

  upsert(input: UpsertSignalArticleInput): SignalArticle {
    const fetchedAt = input.fetchedAt ?? new Date().toISOString()
    const articleId = input.articleId ?? createSignalArticleId(input.url)
    const status = input.status ?? 'inbox'
    const tags = input.tags ?? []

    const article: SignalArticle = {
      id: articleId,
      url: input.url,
      title: input.title,
      source: input.source.id,
      tier: input.source.tier,
      publishedAt: input.publishedAt,
      fetchedAt,
      status,
      tags: Array.from(tags),
      ...(input.summary ? { summary: input.summary } : {}),
      filePath: `memory://signal/${articleId}.md`,
    }

    const existing = this.articles.get(articleId)
    if (existing) {
      // Overwrite by id: keep mutable fields, refresh fetchedAt + content.
      this.articles.set(articleId, {
        article: {
          ...existing.article,
          ...article,
          tags: Array.from(tags),
          filePath: existing.article.filePath,
        },
        content: input.content ?? existing.content,
      })
    } else {
      const normalized = normalizeArticleUrl(input.url)
      this.articles.set(articleId, { article, content: input.content ?? input.summary ?? '' })
      this.byNormalizedUrl.set(normalized, articleId)
    }

    return this.articles.get(articleId)!.article
  }

  listArticles(): SignalArticle[] {
    return Array.from(this.articles.values())
      .map((detail) => detail.article)
      .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))
  }

  getById(id: string): SignalArticleDetail | null {
    return this.articles.get(id) ?? null
  }

  getByUrl(url: string): SignalArticleDetail | null {
    const id = this.byNormalizedUrl.get(normalizeArticleUrl(url))
    if (!id) return null
    return this.articles.get(id) ?? null
  }

  update(id: string, patch: UpdateSignalArticlePatch): SignalArticleDetail | null {
    const existing = this.articles.get(id)
    if (!existing) return null

    const nextArticle: SignalArticle = {
      ...existing.article,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.tags ? { tags: Array.from(patch.tags) } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
    }

    const updated: SignalArticleDetail = { article: nextArticle, content: existing.content }
    this.articles.set(id, updated)
    return updated
  }
}
