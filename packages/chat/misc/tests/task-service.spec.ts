/**
 * ChatTaskService — T5.7.1 任务服务契约验证（阶段5 批次7）。
 *
 * 覆盖（对齐 clowder-ai `routes/tasks.ts` 语义）：
 * - createTask：why→description / ownerCatId｜createdBy→catId /
 *   probe+resolveMode→metadata / identity→userId 映射 + 广播 task_created
 * - listTasks（kind 过滤）/ getTask / updateTask（至少一字段，广播
 *   task_updated）/ deleteTask
 * - cancelWait：404 无任务 / 409 无 active wait / 403 非本人 /
 *   503 生命周期未接线 / 成功透传 lifecycle 结果
 *
 * @module @flowforge/chat-misc/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import type { StoredTask } from '@flowforge/cats-stores'
import { ChatTaskError, ChatTaskErrorCode, ChatTaskService } from '../src/index.ts'

const ALICE = createUserId('alice')
const CAT_A = createCatId('cat_a')

interface Harness {
  ctx: Context
  tasks: ChatTaskService
  backend: MemoryStoresBackend
  broadcasts: Array<{ room: string; event: string; data: unknown }>
}

function harness(overrides: ConstructorParameters<typeof ChatTaskService>[1] = {}): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const broadcasts: Array<{ room: string; event: string; data: unknown }> = []
  const tasks = new ChatTaskService(ctx, {
    broadcaster: (room, event, data) => broadcasts.push({ room, event, data }),
    ...overrides,
  })
  return { ctx, tasks, backend, broadcasts }
}

describe('ChatTaskService — createTask', () => {
  it('maps clowder input onto the store contract and broadcasts task_created', async () => {
    const h = harness()
    const task = await h.tasks.createTask(
      {
        threadId: 't1',
        title: '升级依赖',
        why: '因为 CVE-2026-1234',
        createdBy: 'user',
        ownerCatId: CAT_A,
        kind: 'pr_tracking',
        probe: { kind: 'http_get', url: 'https://health.example.com' },
        resolveMode: 'bounces_back',
      },
      ALICE,
    )
    expect(task.threadId).toBe('t1')
    expect(task.userId).toBe(ALICE)
    expect(task.catId).toBe(CAT_A)
    expect(task.description).toBe('因为 CVE-2026-1234')
    expect(task.metadata).toMatchObject({
      probe: { kind: 'http_get', url: 'https://health.example.com' },
      resolveMode: 'bounces_back',
    })
    expect(task.status).toBe('todo')
    expect(h.broadcasts).toEqual([{ room: 'thread:t1', event: 'task_created', data: task }])
  })

  it('maps createdBy catId and omits metadata when probe/resolveMode are absent', async () => {
    const h = harness()
    const task = await h.tasks.createTask(
      { threadId: 't1', title: '简单任务', createdBy: CAT_A },
      ALICE,
    )
    expect(task.catId).toBe(CAT_A)
    expect(task.description).toBeUndefined()
    expect(task.metadata).toBeUndefined()
  })
})

describe('ChatTaskService — list/get/update/delete', () => {
  it('lists tasks for a thread with optional kind filter', async () => {
    const h = harness()
    await h.tasks.createTask({ threadId: 't1', title: 'A', createdBy: 'user' }, ALICE)
    await h.tasks.createTask({ threadId: 't1', title: 'B', createdBy: 'user', kind: 'pr_tracking' }, ALICE)

    const all = await h.tasks.listTasks('t1')
    expect(all).toHaveLength(2)
    const prs = await h.tasks.listTasks('t1', 'pr_tracking')
    expect(prs).toHaveLength(1)
    expect(prs[0]!.title).toBe('B')
  })

  it('gets a task by id and returns null when missing', async () => {
    const h = harness()
    const created = await h.tasks.createTask({ threadId: 't1', title: 'A', createdBy: 'user' }, ALICE)
    const found = await h.tasks.getTask(created.id)
    expect(found?.title).toBe('A')
    expect(await h.tasks.getTask('missing')).toBeNull()
  })

  it('updates a task, broadcasts task_updated, and rejects empty updates', async () => {
    const h = harness()
    const created = await h.tasks.createTask({ threadId: 't1', title: 'A', createdBy: 'user' }, ALICE)

    const updated = await h.tasks.updateTask(created.id, { status: 'done', why: '完成了' })
    expect(updated?.status).toBe('done')
    expect(updated?.description).toBe('完成了')
    expect(h.broadcasts.some((b) => b.event === 'task_updated')).toBe(true)

    await expect(h.tasks.updateTask(created.id, {})).rejects.toMatchObject({
      code: ChatTaskErrorCode.EMPTY_UPDATE,
      status: 400,
    })
    expect(h.tasks.updateTask).toBeInstanceOf(Function)
  })

  it('deletes a task', async () => {
    const h = harness()
    const created = await h.tasks.createTask({ threadId: 't1', title: 'A', createdBy: 'user' }, ALICE)
    expect(await h.tasks.deleteTask(created.id)).toBe(true)
    expect(await h.tasks.getTask(created.id)).toBeNull()
    expect(await h.tasks.deleteTask(created.id)).toBe(false)
  })
})

describe('ChatTaskService — cancelWait', () => {
  function seedPrWait(h: Harness, overrides: Partial<StoredTask> = {}): StoredTask {
    return h.backend.taskStore.create({
      threadId: 't1',
      userId: ALICE,
      catId: null,
      title: 'PR wait',
      status: 'doing',
      kind: 'pr_tracking',
      metadata: { automationState: { await: { kind: 'pr_review', prUrl: 'https://x' } } },
      ...overrides,
    })
  }

  it('cancels an active wait via the injected lifecycle', async () => {
    const cancel = vi.fn(async () => ({ ok: true }))
    const h = harness({ waitLifecycle: { cancel } })
    const task = seedPrWait(h)

    const result = await h.tasks.cancelWait(task.id, ALICE)
    expect(result.status).toBe('cancelled')
    expect(cancel).toHaveBeenCalledWith(task.id, { kind: 'user', userId: ALICE })
  })

  it('404 when the task does not exist', async () => {
    const h = harness()
    await expect(h.tasks.cancelWait('missing', ALICE)).rejects.toMatchObject({
      code: ChatTaskErrorCode.TASK_NOT_FOUND,
      status: 404,
    })
  })

  it('409 when there is no active wait', async () => {
    const h = harness()
    const plain = await h.tasks.createTask({ threadId: 't1', title: 'A', createdBy: 'user' }, ALICE)
    await expect(h.tasks.cancelWait(plain.id, ALICE)).rejects.toMatchObject({
      code: ChatTaskErrorCode.NO_ACTIVE_WAIT,
      status: 409,
    })

    const wrongKind = seedPrWait(h, { kind: 'work' })
    await expect(h.tasks.cancelWait(wrongKind.id, ALICE)).rejects.toMatchObject({
      code: ChatTaskErrorCode.NO_ACTIVE_WAIT,
      status: 409,
    })
  })

  it('403 when the caller is not the task owner', async () => {
    const h = harness()
    const task = seedPrWait(h)
    await expect(h.tasks.cancelWait(task.id, createUserId('bob'))).rejects.toMatchObject({
      code: ChatTaskErrorCode.FORBIDDEN,
      status: 403,
    })
  })

  it('503 when the wait lifecycle is not wired', async () => {
    const h = harness()
    const task = seedPrWait(h)
    await expect(h.tasks.cancelWait(task.id, ALICE)).rejects.toMatchObject({
      code: ChatTaskErrorCode.WAIT_LIFECYCLE_UNAVAILABLE,
      status: 503,
    })
  })

  it('exposes typed error class', () => {
    const err = new ChatTaskError(ChatTaskErrorCode.TASK_NOT_FOUND, 'nope', 404)
    expect(err.name).toBe('ChatTaskError')
    expect(err.code).toBe('TASK_NOT_FOUND')
  })
})
