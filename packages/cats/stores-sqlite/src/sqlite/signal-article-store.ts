/**
 * SqliteSignalArticleStore — durable ISignalArticleStore（批次52）.
 *
 * 语义对齐 Memory 版：URL 归一化去重索引（tracking 参数/hash/尾斜杠剥离）、
 * upsert 按 id 覆盖（保留既有 filePath，刷新 fetchedAt + content）、
 * listArticles 按 fetchedAt 降序。归一化/ID 生成复用 `@flowforge/cats-stores/memory`
 * 的纯函数（单一事实源）。
 *
 * @module @flowforge/cats-stores-sqlite/sqlite
 */

import type { DatabaseSync } from 'node:sqlite'
import type { SignalArticle } from '@flowforge/cats-shared'
import { createSignalArticleId, normalizeArticleUrl } from '@flowforge/cats-stores/memory'
import type {
  ISignalArticleStore,
  SignalArticleDetail,
  UpdateSignalArticlePatch,
  UpsertSignalArticleInput,
} from '@flowforge/cats-stores/ports'

interface ArticleRow {
  readonly id: string
  readonly normalized_url: string
  readonly status: string
  readonly fetched_at: string
  readonly data: string
  readonly content: string
}

export class SqliteSignalArticleStore implements ISignalArticleStore {
  constructor(private readonly db: DatabaseSync) {}

  upsert(input: UpsertSignalArticleInput): SignalArticle {
    const fetchedAt = input.fetchedAt ?? new Date().toISOString()
    const articleId = input.articleId ?? createSignalArticleId(input.url)
    const status = input.status ?? 'inbox'
    const tags = input.tags ?? []

    const existing = this.getById(articleId)
    if (existing !== null) {
      // Overwrite by id: keep mutable fields, refresh fetchedAt + content.
      const merged: SignalArticle = {
        ...existing.article,
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
        filePath: existing.article.filePath,
      }
      this.writeRow(merged, input.content ?? existing.content)
      return merged
    }

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
    this.writeRow(article, input.content ?? input.summary ?? '')
    return article
  }

  listArticles(): SignalArticle[] {
    const all = (this.db.prepare('SELECT * FROM signal_articles').all() as unknown as ArticleRow[])
      .map((row) => JSON.parse(row.data) as SignalArticle)
    return all.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))
  }

  getById(id: string): SignalArticleDetail | null {
    const row = this.db.prepare('SELECT * FROM signal_articles WHERE id = ?')
      .get(id) as unknown as ArticleRow | undefined
    if (row === undefined) return null
    return { article: JSON.parse(row.data) as SignalArticle, content: row.content }
  }

  getByUrl(url: string): SignalArticleDetail | null {
    const normalized = normalizeArticleUrl(url)
    const row = this.db.prepare(
      'SELECT * FROM signal_articles WHERE normalized_url = ?',
    ).get(normalized) as unknown as ArticleRow | undefined
    if (row === undefined) return null
    return { article: JSON.parse(row.data) as SignalArticle, content: row.content }
  }

  update(id: string, patch: UpdateSignalArticlePatch): SignalArticleDetail | null {
    const existing = this.getById(id)
    if (existing === null) return null
    const nextArticle: SignalArticle = {
      ...existing.article,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.tags ? { tags: Array.from(patch.tags) } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
    }
    this.writeRow(nextArticle, existing.content)
    return { article: nextArticle, content: existing.content }
  }

  private writeRow(article: SignalArticle, content: string): void {
    this.db.prepare(`
      INSERT INTO signal_articles (id, normalized_url, status, fetched_at, data, content)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        normalized_url = excluded.normalized_url, status = excluded.status,
        fetched_at = excluded.fetched_at, data = excluded.data, content = excluded.content
    `).run(
      article.id,
      normalizeArticleUrl(article.url),
      article.status,
      article.fetchedAt,
      JSON.stringify(article),
      content,
    )
  }
}
