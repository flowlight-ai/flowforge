/**
 * ChatMemoryPublishService — T5.7.2 记忆发布门禁契约验证（阶段5 批次7）。
 *
 * 覆盖（对齐 clowder-ai `routes/memory-publish.ts` 语义）：
 * - submit_review 自动创建 draft；完整生命周期 draft → pending_review →
 *   published → archived / rollback → draft
 * - 缺失 entry 非 submit_review → 404 ENTRY_NOT_FOUND
 * - 非法迁移 → 409 CONFLICT（detail 带 currentStatus/action）
 * - 审计 best-effort：未挂载 catsAudit 不阻断迁移
 *
 * @module @flowforge/chat-misc/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { ChatMemoryPublishErrorCode, ChatMemoryPublishService } from '../src/index.ts'

interface Harness {
  ctx: Context
  publish: ChatMemoryPublishService
  backend: MemoryStoresBackend
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const publish = new ChatMemoryPublishService(ctx)
  return { ctx, publish, backend }
}

describe('ChatMemoryPublishService — governance transitions', () => {
  it('submit_review auto-creates a draft then moves to pending_review', async () => {
    const h = harness()
    const result = await h.publish.publishMemory({
      entryId: 'm1',
      action: 'submit_review',
      actor: 'alice',
    })
    expect(result.previousStatus).toBe('draft')
    expect(result.currentStatus).toBe('pending_review')

    const entry = h.backend.memoryGovernanceStore.get('m1')
    expect(entry?.status).toBe('pending_review')
    expect(entry?.updatedBy).toBe('alice')
  })

  it('approve publishes a pending entry', async () => {
    const h = harness()
    await h.publish.publishMemory({ entryId: 'm1', action: 'submit_review', actor: 'alice' })
    const result = await h.publish.publishMemory({ entryId: 'm1', action: 'approve', actor: 'bob' })
    expect(result.currentStatus).toBe('published')
  })

  it('archive and rollback both work from published', async () => {
    const h = harness()
    await h.publish.publishMemory({ entryId: 'm1', action: 'submit_review', actor: 'alice' })
    await h.publish.publishMemory({ entryId: 'm1', action: 'approve', actor: 'bob' })

    const archived = await h.publish.publishMemory({ entryId: 'm1', action: 'archive', actor: 'bob' })
    expect(archived.currentStatus).toBe('archived')

    // rollback 需要重新 published
    await h.publish.publishMemory({ entryId: 'm2', action: 'submit_review', actor: 'alice' })
    await h.publish.publishMemory({ entryId: 'm2', action: 'approve', actor: 'bob' })
    const rolled = await h.publish.publishMemory({ entryId: 'm2', action: 'rollback', actor: 'bob' })
    expect(rolled.currentStatus).toBe('draft')
  })

  it('404 when the entry is missing and the action is not submit_review', async () => {
    const h = harness()
    await expect(
      h.publish.publishMemory({ entryId: 'missing', action: 'approve', actor: 'alice' }),
    ).rejects.toMatchObject({
      code: ChatMemoryPublishErrorCode.ENTRY_NOT_FOUND,
      status: 404,
    })
  })

  it('409 CONFLICT on illegal transitions with currentStatus/action detail', async () => {
    const h = harness()
    await h.publish.publishMemory({ entryId: 'm1', action: 'submit_review', actor: 'alice' })
    // pending_review 不能直接 archive
    await expect(
      h.publish.publishMemory({ entryId: 'm1', action: 'archive', actor: 'bob' }),
    ).rejects.toMatchObject({
      code: ChatMemoryPublishErrorCode.CONFLICT,
      status: 409,
      detail: { currentStatus: 'pending_review', action: 'archive' },
    })
  })

  it('writes audit best-effort and does not fail without catsAudit', async () => {
    const h = harness()
    const result = await h.publish.publishMemory({
      entryId: 'm1',
      action: 'submit_review',
      actor: 'alice',
    })
    expect(result.auditId).toBeUndefined()
  })

  it('writes auditId when catsAudit is mounted', async () => {
    const ctx = new Context()
    new CatStores(ctx)
    const backend = new MemoryStoresBackend(ctx)
    ctx.provide('catsAudit', {
      append: vi.fn(async (input: unknown) => ({ id: 'audit-1', ...(input as object) })),
    })
    const publish = new ChatMemoryPublishService(ctx)

    const result = await publish.publishMemory({ entryId: 'm1', action: 'submit_review', actor: 'alice' })
    expect(result.auditId).toBe('audit-1')
    expect(backend.memoryGovernanceStore.get('m1')?.status).toBe('pending_review')
  })

  it('audit failure does not block the transition', async () => {
    const ctx = new Context()
    new CatStores(ctx)
    const backend = new MemoryStoresBackend(ctx)
    ctx.provide('catsAudit', {
      append: vi.fn(async () => {
        throw new Error('audit down')
      }),
    })
    const publish = new ChatMemoryPublishService(ctx)

    const result = await publish.publishMemory({ entryId: 'm1', action: 'submit_review', actor: 'alice' })
    expect(result.currentStatus).toBe('pending_review')
    expect(backend.memoryGovernanceStore.get('m1')?.status).toBe('pending_review')
  })
})
