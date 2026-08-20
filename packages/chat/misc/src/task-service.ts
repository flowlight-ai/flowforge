/**
 * ChatTaskService — chat 任务服务（毛线球，T5.7.1）。
 *
 * 移植 clowder-ai `routes/tasks.ts`（api/src/routes/）的路由语义为 Cordis
 * 服务（R13 一切皆插件改造）：
 * - createTask：创建任务（201 语义）+ 广播 `task_created` 到 `thread:<threadId>`
 * - listTasks / getTask / updateTask（至少一字段 + 广播 `task_updated`）/
 *   deleteTask
 * - cancelWait：PR wait 终止（身份守卫 + 注入缝 lifecycle，无缝 503）
 *
 * 输入保留 clowder 路由契约（why/createdBy/ownerCatId/probe/resolveMode），
 * 在服务层桥接映射到 `catStores.tasks()` 的 flowforge store 契约
 * （description←why / catId←ownerCatId｜createdBy / metadata←probe+resolveMode）。
 *
 * @module @flowforge/chat-misc
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, TaskKind, TaskStatus, TaskProbeSpec } from '@flowforge/cats-shared'
import type { StoredTask, UpdateTaskPatch } from '@flowforge/cats-stores'

export const ChatTaskErrorCode = {
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  NO_ACTIVE_WAIT: 'NO_ACTIVE_WAIT',
  WAIT_LIFECYCLE_UNAVAILABLE: 'WAIT_LIFECYCLE_UNAVAILABLE',
  EMPTY_UPDATE: 'EMPTY_UPDATE',
} as const

export class ChatTaskError extends Error {
  readonly code: (typeof ChatTaskErrorCode)[keyof typeof ChatTaskErrorCode]
  readonly status: number
  readonly detail?: Record<string, unknown> | undefined

  constructor(
    code: (typeof ChatTaskErrorCode)[keyof typeof ChatTaskErrorCode],
    message: string,
    status: number,
    detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ChatTaskError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** 创建任务输入（clowder tasks 路由契约）。 */
export interface CreateChatTaskInput {
  readonly threadId: string
  readonly title: string
  readonly why?: string
  readonly createdBy: CatId | 'user'
  readonly ownerCatId?: CatId | null
  readonly kind?: TaskKind
  readonly probe?: TaskProbeSpec | null
  readonly resolveMode?: 'bounces_back' | 'completes' | null
}

/** 更新任务输入（至少一个字段）。 */
export interface UpdateChatTaskInput {
  readonly title?: string
  readonly ownerCatId?: CatId | null
  readonly status?: TaskStatus
  readonly why?: string
  readonly probe?: TaskProbeSpec | null
  readonly resolveMode?: 'bounces_back' | 'completes' | null
}

/** PR wait 生命周期缝（clowder GitHubWaitLifecycleService 的窄面）。 */
export interface ChatTaskWaitLifecycle {
  cancel(taskId: string, reason: { kind: 'user'; userId: string }): Promise<unknown>
}

/** ChatTaskService 选项。 */
export interface ChatTaskServiceOptions {
  /** 房间广播缝（缺省经 ctx.chatRealtime，未挂载则静默跳过）。 */
  broadcaster?: (room: string, event: string, data: unknown) => void
  /** PR wait 生命周期（cancel-wait 注入缝，缺省不可用 → 503 语义）。 */
  waitLifecycle?: ChatTaskWaitLifecycle
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat 任务服务（T5.7.1）— mounted by `@flowforge/chat-misc`. */
    chatTasks: ChatTaskService
  }
}

/** Map clowder 创建输入 → flowforge store CreateTaskInput。 */
function toStoreCreateInput(
  input: CreateChatTaskInput,
  identity: string,
): Omit<StoredTask, 'id' | 'createdAt' | 'updatedAt'> & { readonly id?: string } {
  const catId = input.ownerCatId ?? (input.createdBy === 'user' ? null : input.createdBy)
  const metadata: Record<string, unknown> = {}
  if (input.probe !== undefined && input.probe !== null) metadata.probe = input.probe
  if (input.resolveMode !== undefined && input.resolveMode !== null) metadata.resolveMode = input.resolveMode
  return {
    threadId: input.threadId,
    userId: identity,
    catId,
    title: input.title,
    status: 'todo',
    kind: input.kind ?? 'work',
    ...(input.why && input.why.length > 0 ? { description: input.why } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

/** Map clowder 更新输入 → flowforge store UpdateTaskPatch。 */
function toStoreUpdatePatch(input: UpdateChatTaskInput): UpdateTaskPatch {
  const metadata: Record<string, unknown> = {}
  if (input.probe !== undefined && input.probe !== null) metadata.probe = input.probe
  if (input.resolveMode !== undefined && input.resolveMode !== null) metadata.resolveMode = input.resolveMode
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.ownerCatId !== undefined ? { catId: input.ownerCatId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.why !== undefined ? { description: input.why } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
}

/**
 * Chat 任务服务。挂载点 `ctx.chatTasks`（`@flowforge/chat-misc`）。
 */
export class ChatTaskService extends Service {
  static inject = ['catStores']

  private readonly broadcaster: (room: string, event: string, data: unknown) => void
  private readonly waitLifecycle: ChatTaskWaitLifecycle | undefined

  constructor(ctx: Context, options: ChatTaskServiceOptions = {}) {
    super(ctx, 'chatTasks')
    const realtime = ctx.get('chatRealtime', false) as {
      broadcastToRoom(room: string, event: string, data: unknown): void
    } | undefined
    this.broadcaster = options.broadcaster ?? ((room, event, data) => realtime?.broadcastToRoom(room, event, data))
    this.waitLifecycle = options.waitLifecycle
  }

  /** 创建任务（POST /api/tasks 语义）；广播 `task_created`。 */
  async createTask(input: CreateChatTaskInput, identity: string): Promise<StoredTask> {
    const task = await this.ctx.catStores.tasks().create(toStoreCreateInput(input, identity))
    this.broadcaster(`thread:${task.threadId}`, 'task_created', task)
    return task
  }

  /** 列出线程任务（GET /api/tasks?threadId 语义，可选 kind 过滤）。 */
  async listTasks(threadId: string, kind?: TaskKind): Promise<StoredTask[]> {
    const tasks = await this.ctx.catStores.tasks().listForThread(threadId)
    return kind ? tasks.filter((t) => t.kind === kind) : tasks
  }

  /** 获取单个任务（GET /api/tasks/:id 语义）。 */
  async getTask(id: string): Promise<StoredTask | null> {
    return this.ctx.catStores.tasks().getById(id)
  }

  /** 更新任务（PATCH /api/tasks/:id 语义，至少一字段）；广播 `task_updated`。 */
  async updateTask(id: string, input: UpdateChatTaskInput): Promise<StoredTask | null> {
    if (Object.keys(input).length === 0) {
      throw new ChatTaskError(ChatTaskErrorCode.EMPTY_UPDATE, 'At least one field must be provided', 400)
    }
    const updated = await this.ctx.catStores.tasks().update(id, toStoreUpdatePatch(input))
    if (!updated) return null
    this.broadcaster(`thread:${updated.threadId}`, 'task_updated', updated)
    return updated
  }

  /** 删除任务（DELETE /api/tasks/:id 语义）。 */
  async deleteTask(id: string): Promise<boolean> {
    return this.ctx.catStores.tasks().delete(id)
  }

  /**
   * 终止 PR wait（POST /api/tasks/:id/cancel-wait 语义）：
   * 404 无任务 / 409 无 active wait / 403 非本人 / 503 生命周期不可用。
   */
  async cancelWait(id: string, identity: string): Promise<{ status: 'cancelled'; result: unknown }> {
    const task = await this.ctx.catStores.tasks().getById(id)
    if (!task) {
      throw new ChatTaskError(ChatTaskErrorCode.TASK_NOT_FOUND, 'Task not found', 404)
    }
    const automationState = (task.metadata as { automationState?: { await?: unknown } } | undefined)?.automationState
    if (task.kind !== 'pr_tracking' || !automationState?.await) {
      throw new ChatTaskError(ChatTaskErrorCode.NO_ACTIVE_WAIT, 'Task has no active PR wait', 409)
    }
    if (task.userId !== identity) {
      throw new ChatTaskError(ChatTaskErrorCode.FORBIDDEN, 'Not your wait', 403)
    }
    if (!this.waitLifecycle) {
      throw new ChatTaskError(
        ChatTaskErrorCode.WAIT_LIFECYCLE_UNAVAILABLE,
        'Wait lifecycle unavailable',
        503,
      )
    }
    const result = await this.waitLifecycle.cancel(task.id, { kind: 'user', userId: identity })
    return { status: 'cancelled', result }
  }
}
