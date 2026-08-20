/**
 * ThreadService — 线程域服务移植契约验证（阶段5 批次1，T5.1.6）：
 * - create：metadata 承载 projectPath/pinned/backlogItemId/systemKind（F095/F192）
 * - create：backlogItemId 存在性 + 所有权校验（INVALID_BACKLOG_ITEM）
 * - get：404 / 403 / system 线程共享
 * - list：活跃视图 / 回收站 deleted 视图（F095 Phase D）/ q 搜索 /
 *   sidebar 投影 / internal.* 剥离
 * - patch：title/preferredCats/pinned/labels（F187 语义经 metadata.labels）
 * - softDelete：#35 活跃调用保护 + F192 系统线程 force 门 + 读状态级联 +
 *   I-2 审计回调 / restore 状态机
 * - purge：消息/任务/读状态/线程硬删级联
 *
 * @module @flowforge/chat-threads/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import { createCatId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { ThreadErrorCode, ThreadService } from '../src/index.ts'

const USER_ALICE = 'alice' as UserId
const USER_BOB = 'bob' as UserId
const CAT_OPUS = createCatId('opus')

interface Harness {
  ctx: Context
  threads: ThreadService
  backend: MemoryStoresBackend
}

function harness(
  options: ConstructorParameters<typeof ThreadService>[1] = {},
): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const threads = new ThreadService(ctx, options)
  return { ctx, threads, backend }
}

/** Seed a backlog item owned by `userId` and return its id. */
function seedBacklog(backend: MemoryStoresBackend, userId: string): string {
  return backend.backlogStore.create({
    userId,
    title: 'backlog item',
    summary: 'item summary',
    priority: 'p1',
    tags: [],
    status: 'open',
    createdBy: 'user',
  }).id
}

/** Seed a task bound to a thread and return its id. */
function seedTask(backend: MemoryStoresBackend, threadId: string): string {
  return backend.taskStore.create({
    threadId,
    userId: USER_ALICE,
    catId: null,
    title: 'thread task',
    status: 'todo',
    kind: 'work',
  }).id
}

describe('ThreadService — create', () => {
  it('creates a thread carrying projectPath/pinned/systemKind via metadata', async () => {
    const h = harness()
    const thread = await h.threads.create({
      userId: USER_ALICE,
      title: 'design sync',
      projectPath: '/w/proj',
      pinned: true,
      systemKind: 'im-hub',
      preferredCats: [CAT_OPUS],
    })
    expect(thread.title).toBe('design sync')
    expect(thread.assignedCatIds).toEqual([CAT_OPUS])
    expect(thread.metadata).toMatchObject({
      projectPath: '/w/proj',
      pinned: true,
      systemKind: 'im-hub',
    })
  })

  it('links a valid backlog item (existence + ownership)', async () => {
    const h = harness()
    const backlogId = seedBacklog(h.backend, USER_ALICE)
    const thread = await h.threads.create({
      userId: USER_ALICE,
      backlogItemId: backlogId,
    })
    expect(thread.metadata?.backlogItemId).toBe(backlogId)
  })

  it('rejects unknown backlog items', async () => {
    const h = harness()
    await expect(
      h.threads.create({ userId: USER_ALICE, backlogItemId: 'bl_missing' }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.INVALID_BACKLOG_ITEM })
  })

  it('rejects backlog items owned by another user', async () => {
    const h = harness()
    const foreign = seedBacklog(h.backend, USER_BOB)
    await expect(
      h.threads.create({ userId: USER_ALICE, backlogItemId: foreign }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.INVALID_BACKLOG_ITEM })
  })
})

describe('ThreadService — get', () => {
  it('returns the owner thread', async () => {
    const h = harness()
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    const fetched = await h.threads.get(created.id, USER_ALICE)
    expect(fetched.id).toBe(created.id)
  })

  it('throws THREAD_NOT_FOUND for unknown ids', async () => {
    const h = harness()
    await expect(h.threads.get('th_missing', USER_ALICE)).rejects.toMatchObject({
      code: ThreadErrorCode.THREAD_NOT_FOUND,
    })
  })

  it('throws UNAUTHORIZED for foreign threads', async () => {
    const h = harness()
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    await expect(h.threads.get(created.id, USER_BOB)).rejects.toMatchObject({
      code: ThreadErrorCode.UNAUTHORIZED,
    })
  })

  it('shares system-owned threads with every user', async () => {
    const h = harness()
    const created = h.backend.threadStore.create({
      userId: 'system',
      title: 'IM Hub',
    })
    const fetched = await h.threads.get(created.id, USER_BOB)
    expect(fetched.id).toBe(created.id)
  })
})

describe('ThreadService — list', () => {
  it('lists active threads only by default and surfaces the trash view', async () => {
    const h = harness()
    const keep = await h.threads.create({ userId: USER_ALICE, title: 'keep' })
    const drop = await h.threads.create({ userId: USER_ALICE, title: 'drop' })
    await h.threads.softDelete(drop.id, { userId: USER_ALICE })

    const active = await h.threads.list(USER_ALICE)
    expect(active.map((t) => t.id)).toEqual([keep.id])

    const trash = await h.threads.list(USER_ALICE, { deleted: true })
    expect(trash.map((t) => t.id)).toEqual([drop.id])
    expect(trash[0]?.archivedAt).toBeTypeOf('number')
  })

  it('parses loose boolean deleted query values', async () => {
    const h = harness()
    const drop = await h.threads.create({ userId: USER_ALICE, title: 'drop' })
    await h.threads.softDelete(drop.id, { userId: USER_ALICE })

    const asString = await h.threads.list(USER_ALICE, { deleted: 'true' })
    expect(asString.map((t) => t.id)).toEqual([drop.id])
    const asOne = await h.threads.list(USER_ALICE, { deleted: '1' })
    expect(asOne.map((t) => t.id)).toEqual([drop.id])
  })

  it('filters by case-insensitive title substring', async () => {
    const h = harness()
    await h.threads.create({ userId: USER_ALICE, title: 'Deploy Pipeline' })
    await h.threads.create({ userId: USER_ALICE, title: 'Design Sync' })

    const hits = await h.threads.list(USER_ALICE, { q: 'deploy' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe('Deploy Pipeline')
  })

  it('projects the sidebar view without the metadata blob', async () => {
    const h = harness()
    const created = await h.threads.create({
      userId: USER_ALICE,
      title: 't',
      projectPath: '/w/proj',
    })
    const sidebar = await h.threads.list(USER_ALICE, { view: 'sidebar' })
    expect(sidebar[0]?.metadata).toBeUndefined()

    const full = await h.threads.list(USER_ALICE)
    expect(full[0]?.metadata?.projectPath).toBe('/w/proj')
    expect(created.metadata?.projectPath).toBe('/w/proj')
  })

  it('strips internal.* metadata keys from every projection', async () => {
    const h = harness()
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    h.backend.threadStore.update(created.id, {
      metadata: { 'internal.custody': 'secret', pinned: true },
    })
    const fetched = await h.threads.get(created.id, USER_ALICE)
    expect(fetched.metadata).toEqual({ pinned: true })
  })
})

describe('ThreadService — patch', () => {
  it('patches title and preferredCats', async () => {
    const h = harness()
    const created = await h.threads.create({
      userId: USER_ALICE,
      preferredCats: [CAT_OPUS],
    })
    const patched = await h.threads.patch(created.id, {
      title: 'renamed',
      preferredCats: [],
    })
    expect(patched.title).toBe('renamed')
    expect(patched.assignedCatIds).toEqual([])
  })

  it('carries pinned and labels through metadata (F187 semantics)', async () => {
    const h = harness()
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    const patched = await h.threads.patch(created.id, {
      pinned: true,
      labels: ['work', 'urgent'],
    })
    expect(patched.metadata?.pinned).toBe(true)
    expect(patched.metadata?.labels).toEqual(['work', 'urgent'])
  })

  it('rejects an empty patch and unknown / archived threads', async () => {
    const h = harness()
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    await expect(h.threads.patch(created.id, {})).rejects.toMatchObject({
      code: ThreadErrorCode.INVALID_INPUT,
    })
    await expect(h.threads.patch('th_missing', { title: 'x' })).rejects.toMatchObject({
      code: ThreadErrorCode.THREAD_NOT_FOUND,
    })

    const archived = await h.threads.create({ userId: USER_ALICE, title: 'a' })
    await h.threads.softDelete(archived.id, { userId: USER_ALICE })
    await expect(
      h.threads.patch(archived.id, { title: 'x' }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.THREAD_NOT_FOUND })
  })
})

describe('ThreadService — softDelete / restore', () => {
  it('soft-deletes, cascades read cursors, and fires the audit hook', async () => {
    const onThreadDeleted = vi.fn()
    const h = harness({ onThreadDeleted })
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    const msg = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'hello',
      mentions: [],
      timestamp: Date.now(),
      threadId: created.id,
    })
    h.backend.threadReadStateStore.ack(USER_ALICE, created.id, msg.id)

    await h.threads.softDelete(created.id, { userId: USER_ALICE })

    const stored = h.backend.threadStore.getById(created.id)
    expect(stored?.archivedAt).toBeTypeOf('number')
    // Cascade: a restored thread starts unread-clean.
    expect(h.backend.threadReadStateStore.get(USER_ALICE, created.id)).toBeNull()
    // I-2 audit hook
    expect(onThreadDeleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      USER_ALICE,
    )
  })

  it('protects threads with active invocations (#35)', async () => {
    const h = harness({ hasActiveInvocations: (threadId) => threadId === 'th_busy' })
    await expect(
      h.threads.softDelete('th_busy', { userId: USER_ALICE }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.ACTIVE_INVOCATION })
  })

  it('guards system threads behind an explicit force (F192)', async () => {
    const h = harness()
    const created = await h.threads.create({
      userId: USER_ALICE,
      systemKind: 'im-hub',
    })
    await expect(
      h.threads.softDelete(created.id, { userId: USER_ALICE }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.SYSTEM_THREAD_PROTECTED })

    await h.threads.softDelete(created.id, { userId: USER_ALICE, force: true })
    expect(h.backend.threadStore.getById(created.id)?.archivedAt).toBeTypeOf('number')
  })

  it('throws THREAD_NOT_FOUND when deleting an unknown thread', async () => {
    const h = harness()
    await expect(
      h.threads.softDelete('th_missing', { userId: USER_ALICE }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.THREAD_NOT_FOUND })
  })

  it('restores a soft-deleted thread and rejects double restore', async () => {
    const h = harness()
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    await h.threads.softDelete(created.id, { userId: USER_ALICE })

    const restored = await h.threads.restore(created.id)
    expect(restored.archivedAt).toBeUndefined()
    expect(h.backend.threadStore.getById(created.id)?.archivedAt).toBeUndefined()

    await expect(h.threads.restore(created.id)).rejects.toMatchObject({
      code: ThreadErrorCode.THREAD_NOT_DELETED,
    })
  })
})

describe('ThreadService — purge', () => {
  it('hard-deletes with messages / tasks / read states cascade', async () => {
    const h = harness()
    const created = await h.threads.create({ userId: USER_ALICE, title: 't' })
    const msg = h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'hello',
      mentions: [],
      timestamp: Date.now(),
      threadId: created.id,
    })
    const taskId = seedTask(h.backend, created.id)
    h.backend.threadReadStateStore.ack(USER_ALICE, created.id, msg.id)

    await h.threads.purge(created.id)

    expect(h.backend.threadStore.getById(created.id)).toBeNull()
    expect(h.backend.messageStore.getByThread(created.id)).toEqual([])
    expect(h.backend.taskStore.getById(taskId)).toBeNull()
    expect(h.backend.threadReadStateStore.get(USER_ALICE, created.id)).toBeNull()
  })

  it('protects purge behind the active-invocation probe (#35)', async () => {
    const h = harness({ hasActiveInvocations: (threadId) => threadId === 'th_busy' })
    await expect(h.threads.purge('th_busy')).rejects.toMatchObject({
      code: ThreadErrorCode.ACTIVE_INVOCATION,
    })
  })
})
