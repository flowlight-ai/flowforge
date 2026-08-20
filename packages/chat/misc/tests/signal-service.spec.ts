/**
 * ChatSignalService — T5.7.3 signal-hunter 服务契约验证（阶段5 批次7）。
 *
 * 覆盖（对齐 clowder-ai `routes/signals.ts` + `article-query-service.ts` +
 * `article-stats.ts` 语义）：
 * - inbox：默认 status=inbox / limit 归一化 / date / source / tier /
 *   status=all / deletedAt 过滤 + 按 fetchedAt 倒序
 * - getArticleById / getArticleByUrl（URL 归一化：tracking 参数剥离）
 * - search：全文 haystack（title/url/source/summary/note/tags/content）+
 *   空 query → 0
 * - updateArticle：status/tags/summary/note/deletedAt
 * - getStats：today/week/unread/byTier/bySource
 * - sources：list / updateSource（串行化，缺失 → null）
 * - 注入缝：fetch 未接线 503 / enrich 未接线 not_found / backfill 未接线 503
 *
 * @module @flowforge/chat-misc/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { SignalArticle, SignalSource } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import type { ISignalArticleStore } from '@flowforge/cats-stores/ports'
import { ChatSignalService, type SignalSourceStore } from '../src/index.ts'

const SRC: SignalSource = {
  id: 'rss-1',
  name: '官方博客',
  url: 'https://example.com/feed.xml',
  tier: 1,
  category: 'official',
  enabled: true,
  fetch: { method: 'rss' },
  schedule: { frequency: 'daily' },
}

interface Harness {
  ctx: Context
  signals: ChatSignalService
  backend: MemoryStoresBackend
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const signals = new ChatSignalService(ctx)
  return { ctx, signals, backend }
}

let articleSeq = 0

async function upsertArticle(
  store: ISignalArticleStore,
  overrides: Partial<Parameters<ISignalArticleStore['upsert']>[0]> = {},
): Promise<SignalArticle> {
  return await store.upsert({
    source: SRC,
    title: '默认标题',
    // MemorySignalArticleStore 按 url 去重（createSignalArticleId），播种必须唯一
    url: `https://example.com/post/${++articleSeq}`,
    publishedAt: '2026-08-01T00:00:00.000Z',
    content: '正文内容',
    ...overrides,
  })
}

describe('ChatSignalService — inbox', () => {
  it('returns inbox articles newest-first with default limit', async () => {
    const h = harness()
    await upsertArticle(h.backend.signalArticleStore, { title: '老文', fetchedAt: '2026-08-01T00:00:00Z' })
    await upsertArticle(h.backend.signalArticleStore, { title: '新文', fetchedAt: '2026-08-02T00:00:00Z' })
    await upsertArticle(h.backend.signalArticleStore, { title: '已读', status: 'read', fetchedAt: '2026-08-03T00:00:00Z' })

    const inbox = await h.signals.listInbox()
    expect(inbox.map((a) => a.title)).toEqual(['新文', '老文'])
  })

  it('filters by date/source/tier and supports status=all', async () => {
    const h = harness()
    await upsertArticle(h.backend.signalArticleStore, { title: 'A', fetchedAt: '2026-08-01T10:00:00Z' })
    await upsertArticle(h.backend.signalArticleStore, { title: 'B', fetchedAt: '2026-08-02T10:00:00Z' })

    const dated = await h.signals.listInbox({ date: '2026-08-01' })
    expect(dated.map((a) => a.title)).toEqual(['A'])

    const bySource = await h.signals.listInbox({ source: 'rss-1' })
    expect(bySource).toHaveLength(2)

    const noMatch = await h.signals.listInbox({ source: 'rss-2' })
    expect(noMatch).toHaveLength(0)

    const tier2 = await h.signals.listInbox({ tier: 2 })
    expect(tier2).toHaveLength(0)

    const all = await h.signals.listInbox({ status: 'all' })
    expect(all).toHaveLength(2)
  })

  it('normalizes inbox limit', async () => {
    const h = harness()
    for (let i = 0; i < 5; i += 1) {
      await upsertArticle(h.backend.signalArticleStore, {
        title: `文${i}`,
        fetchedAt: `2026-08-0${i + 1}T00:00:00Z`,
      })
    }
    const limited = await h.signals.listInbox({ limit: 2 })
    expect(limited).toHaveLength(2)
    const bad = await h.signals.listInbox({ limit: -1 })
    expect(bad).toHaveLength(5)
  })
})

describe('ChatSignalService — get/search/update/stats', () => {
  it('gets an article by id and by normalized URL', async () => {
    const h = harness()
    const seeded = await upsertArticle(h.backend.signalArticleStore, {
      url: 'https://example.com/p?utm_source=x&b=2&a=1#frag',
    })

    const byId = await h.signals.getArticle(seeded.id)
    expect(byId?.title).toBe('默认标题')

    // 归一化剥离 utm/gclid/fbclid/ref 与 hash、排序参数
    const byUrl = await h.signals.getArticleByUrl('https://example.com/p?a=1&utm_source=y&b=2')
    expect(byUrl?.id).toBe(seeded.id)
  })

  it('searches across title/url/source/summary/note/tags/content', async () => {
    const h = harness()
    await upsertArticle(h.backend.signalArticleStore, {
      title: 'RAG 综述',
      url: 'https://example.com/rag',
      content: '检索增强生成',
      tags: ['llm'],
      summary: '年度综述',
    })
    await upsertArticle(h.backend.signalArticleStore, { title: 'Agent 进展', url: 'https://example.com/agent' })

    const byTitle = await h.signals.search({ query: '综述' })
    expect(byTitle.total).toBe(1)

    const byContent = await h.signals.search({ query: '增强' })
    expect(byContent.total).toBe(1)

    const byTag = await h.signals.search({ query: 'llm' })
    expect(byTag.total).toBe(1)

    const empty = await h.signals.search({ query: '' })
    expect(empty.total).toBe(0)
  })

  it('updates article mutable fields', async () => {
    const h = harness()
    const seeded = await upsertArticle(h.backend.signalArticleStore, { tags: [] })

    const updated = await h.signals.updateArticle(seeded.id, {
      status: 'starred',
      tags: ['pinned'],
      summary: '摘要',
      note: '备注',
    })
    expect(updated?.status).toBe('starred')
    expect(updated?.tags).toEqual(['pinned'])
    expect(updated?.summary).toBe('摘要')
    expect(updated?.note).toBe('备注')

    expect(await h.signals.updateArticle('missing', { status: 'read' })).toBeNull()
  })

  it('computes stats: today/week/unread/byTier/bySource', async () => {
    const h = harness()
    const now = new Date('2026-08-10T12:00:00Z')
    await upsertArticle(h.backend.signalArticleStore, {
      url: 'https://example.com/a',
      fetchedAt: '2026-08-10T08:00:00Z', // today
    })
    await upsertArticle(h.backend.signalArticleStore, {
      source: { ...SRC, id: 'rss-2', name: '社区', tier: 2, category: 'community' },
      url: 'https://example.com/b',
      fetchedAt: '2026-08-05T08:00:00Z', // within week
      status: 'read',
    })
    const deleted = await upsertArticle(h.backend.signalArticleStore, {
      url: 'https://example.com/c',
      fetchedAt: '2026-07-01T08:00:00Z', // outside week
      status: 'archived',
    })
    await h.signals.updateArticle(deleted.id, { deletedAt: '2026-08-01T00:00:00Z' }) // soft-deleted → excluded

    const stats = await h.signals.getStats(now)
    expect(stats.todayCount).toBe(1)
    expect(stats.weekCount).toBe(2)
    expect(stats.unreadCount).toBe(1)
    expect(stats.byTier).toEqual({ 1: 1, 2: 1 })
    expect(stats.bySource).toEqual({ 'rss-1': 1, 'rss-2': 1 })
  })
})

describe('ChatSignalService — sources & seams', () => {
  it('lists sources and updates enabled state serially', async () => {
    const saved: SignalSourceConfigLike = { version: 1, sources: [SRC] }
    const store: SignalSourceStore = {
      load: async () => saved,
      save: async (config) => {
        saved.sources = config.sources
      },
    }
    const ctx = new Context()
    new CatStores(ctx)
    new MemoryStoresBackend(ctx)
    const signals = new ChatSignalService(ctx, { sourceStore: store })

    expect(await signals.listSources()).toHaveLength(1)
    const updated = await signals.updateSource('rss-1', { enabled: false })
    expect(updated?.enabled).toBe(false)
    expect(saved.sources[0]!.enabled).toBe(false)
    expect(await signals.updateSource('missing', { enabled: true })).toBeNull()
  })

  it('serializes concurrent source updates', async () => {
    const saved: SignalSourceConfigLike = { version: 1, sources: [SRC] }
    const store: SignalSourceStore = {
      load: async () => saved,
      save: async (config) => {
        saved.sources = config.sources
      },
    }
    const ctx = new Context()
    new CatStores(ctx)
    new MemoryStoresBackend(ctx)
    const signals = new ChatSignalService(ctx, { sourceStore: store })

    await Promise.all([
      signals.updateSource('rss-1', { enabled: false }),
      signals.updateSource('rss-1', { enabled: true }),
    ])
    expect(saved.sources[0]!.enabled).toBe(true)
  })

  it('fetch/backfill seams reject with 503 semantics when not wired', async () => {
    const h = harness()
    await expect(h.signals.fetchSourceById('rss-1')).rejects.toThrow('503')
    await expect(h.signals.backfill('rss-1')).rejects.toThrow('503')
  })

  it('enrich seam falls back to not_found when not wired', async () => {
    const h = harness()
    const result = await h.signals.enrichArticleById('article-1')
    expect(result.reason).toBe('not_found')
    expect(result.articleId).toBe('article-1')
  })

  it('wired fetch/enrich/backfill seams delegate to the injected functions', async () => {
    const ctx = new Context()
    new CatStores(ctx)
    new MemoryStoresBackend(ctx)
    const signals = new ChatSignalService(ctx, {
      fetchSource: async () => ({ storedArticles: 3, errors: [] }),
      enrichArticle: async (id) => ({ reason: 'ok', articleId: id, summary: '富化' }),
      backfillSource: async () => ({ ok: true }),
    })

    const fetched = await signals.fetchSourceById('rss-1')
    expect(fetched.storedArticles).toBe(3)

    const enriched = await signals.enrichArticleById('article-1')
    expect(enriched.reason).toBe('ok')
    expect(enriched.summary).toBe('富化')

    const backfilled = await signals.backfill('rss-1')
    expect(backfilled).toMatchObject({ ok: true })
  })
})

interface SignalSourceConfigLike {
  readonly version: 1
  sources: readonly SignalSource[]
}
