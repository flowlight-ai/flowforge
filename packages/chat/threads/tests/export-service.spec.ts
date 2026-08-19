/**
 * ThreadExportService — markdown 导出投影移植契约验证（阶段5 批次1）：
 * - owner 导出：标题/元信息头 + 消息正文 + 发送者投影（@catId vs userId）
 * - 所有权：非 owner → UNAUTHORIZED；system 线程共享；未知 → THREAD_NOT_FOUND
 * - 未命名线程 → '未命名对话' 标题 fallback
 * - messageCount 与 markdown 内容一致
 *
 * @module @flowforge/chat-threads/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { CatId, UserId } from '@flowforge/cats-shared'
import { createCatId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { ThreadErrorCode, ThreadExportService } from '../src/index.ts'

const USER_ALICE = 'alice' as UserId
const USER_BOB = 'bob' as UserId
const CAT_OPUS = createCatId('opus')

interface Harness {
  ctx: Context
  exportService: ThreadExportService
  backend: MemoryStoresBackend
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const exportService = new ThreadExportService(ctx)
  return { ctx, exportService, backend }
}

/** Append a message to `threadId` authored by alice (user or cat). */
function appendMsg(
  h: Harness,
  threadId: string,
  content: string,
  options: { readonly catId?: CatId | null } = {},
) {
  return h.backend.messageStore.append({
    userId: USER_ALICE,
    catId: options.catId ?? null,
    content,
    mentions: [],
    timestamp: Date.now(),
    threadId,
  })
}

describe('ThreadExportService — exportMarkdown', () => {
  it('renders a markdown document with per-message sender projections', async () => {
    const h = harness()
    const thread = h.backend.threadStore.create({
      userId: USER_ALICE,
      title: '设计评审',
    })
    appendMsg(h, thread.id, '请问进度如何？')
    appendMsg(h, thread.id, '后端已完成，正在联调。', { catId: CAT_OPUS })

    const doc = await h.exportService.exportMarkdown(thread.id, USER_ALICE)

    expect(doc.threadId).toBe(thread.id)
    expect(doc.title).toBe('设计评审')
    expect(doc.messageCount).toBe(2)

    expect(doc.markdown).toContain('# 设计评审')
    expect(doc.markdown).toContain(`- Thread ID: ${thread.id}`)
    expect(doc.markdown).toContain('- Messages: 2')
    expect(doc.markdown).toContain('**alice**')
    expect(doc.markdown).toContain('请问进度如何？')
    expect(doc.markdown).toContain('**@opus**')
    expect(doc.markdown).toContain('后端已完成，正在联调。')
  })

  it('denies exports to non-owners and shares system threads', async () => {
    const h = harness()
    const owned = h.backend.threadStore.create({
      userId: USER_ALICE,
      title: 'private',
    })
    appendMsg(h, owned.id, 'secret')
    await expect(
      h.exportService.exportMarkdown(owned.id, USER_BOB),
    ).rejects.toMatchObject({ code: ThreadErrorCode.UNAUTHORIZED })

    const system = h.backend.threadStore.create({
      userId: 'system',
      title: 'IM Hub',
    })
    appendMsg(h, system.id, 'hub message')
    const doc = await h.exportService.exportMarkdown(system.id, USER_BOB)
    expect(doc.messageCount).toBe(1)
  })

  it('throws THREAD_NOT_FOUND for unknown threads', async () => {
    const h = harness()
    await expect(
      h.exportService.exportMarkdown('th_missing', USER_ALICE),
    ).rejects.toMatchObject({ code: ThreadErrorCode.THREAD_NOT_FOUND })
  })

  it('falls back to a default title for untitled threads', async () => {
    const h = harness()
    const thread = h.backend.threadStore.create({ userId: USER_ALICE, title: '' })
    const doc = await h.exportService.exportMarkdown(thread.id, USER_ALICE)
    expect(doc.markdown).toContain('# 未命名对话')
  })
})
