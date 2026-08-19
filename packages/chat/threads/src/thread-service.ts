/**
 * ThreadService — 线程域 Cordis 服务（阶段5 批次1，ctx.chatThreads）。
 *
 * 移植自 clowder-ai `routes/threads.ts`（R13 一切皆插件改造）：Fastify 路由
 * 内联业务提取为服务层——
 * - create（F32-b preferredCats / F095 pinned+backlogItemId 关联校验）
 * - list（sidebar 投影 / q 搜索 / 回收站 deleted 视图）
 * - patch 标题/成员/labels（F187 语义经 metadata.labels 承载）
 * - softDelete（F095 Phase D 软删 + #35 活跃调用保护 + 系统线程 F192 保护
 *   + I-2 审计回调）/ restore / purge 硬删级联
 * 存储经 `ctx.catStores.threads()/backlogs()/readStates()/messages()/tasks()`
 * 解析（static inject=['catStores']）。
 *
 * @module @flowforge/chat-threads/service
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, UserId } from '@flowforge/cats-shared'
import type { StoredThread } from '@flowforge/cats-stores'
import { ThreadErrorCode } from './invariant.ts'
import { parseOptionalBoolean, projectThreadForListView, sanitizeThreadForResponse } from './sanitize.ts'

/** Business error with a stable machine-readable code (mirrors clowder-ai route codes). */
export class ChatThreadsError extends Error {
  readonly code: (typeof ThreadErrorCode)[keyof typeof ThreadErrorCode]

  constructor(code: (typeof ThreadErrorCode)[keyof typeof ThreadErrorCode], message: string) {
    super(message)
    this.name = 'ChatThreadsError'
    this.code = code
  }
}

/** Input for creating a chat thread. */
export interface CreateChatThreadInput {
  readonly userId: UserId
  /** F32-b Phase 2: thread-level cat preference (validated upstream against the registry). */
  readonly preferredCats?: readonly CatId[]
  readonly title?: string
  readonly projectPath?: string
  /** F095 Phase C: pin thread on creation. */
  readonly pinned?: boolean
  /** F095 Phase C: associate thread with a backlog item (existence + ownership validated). */
  readonly backlogItemId?: string
  /** F192: system threads (IM hub / eval) are deletion-protected. */
  readonly systemKind?: string
}

/** Patch input — at least one field required. */
export interface UpdateChatThreadInput {
  readonly title?: string
  readonly preferredCats?: readonly CatId[]
  readonly pinned?: boolean
  readonly labels?: readonly string[]
}

export interface ListChatThreadsOptions {
  /** Lightweight list projection used by the sidebar. */
  readonly view?: 'sidebar'
  /** Title substring search (case-insensitive). */
  readonly q?: string
  /** F095 Phase D: list soft-deleted threads (trash bin) instead of active ones. */
  readonly deleted?: boolean | string
  readonly limit?: number
}

export interface DeleteChatThreadOptions {
  readonly userId: UserId
  /** F192: system threads require explicit force to delete. */
  readonly force?: boolean
}

/** Constructor options for optional collaborators (kept out of Cordis inject to avoid hard deps). */
export interface ThreadServiceOptions {
  /**
   * #35: protect active invocations from thread deletion. Atomic
   * has()+mark semantics live in the invocation tracker; the service only
   * needs the boolean probe. Wired by the composition root (stage-5 batch 5
   * connects the multi-mention orchestrator, stage-4 the cats tracker).
   */
  readonly hasActiveInvocations?: (threadId: string) => boolean
  /** I-2: audit hook fired (fire-and-forget) after a successful soft delete. */
  readonly onThreadDeleted?: (thread: StoredThread, deletedBy: string) => void
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat thread domain service — mounted by `@flowforge/chat-threads`. */
    chatThreads: ThreadService
  }
}

/**
 * Cordis service exposing the chat thread domain at `ctx.chatThreads`.
 */
export class ThreadService extends Service {
  static inject = ['catStores'] as const

  private readonly options: ThreadServiceOptions

  constructor(ctx: Context, options: ThreadServiceOptions = {}) {
    super(ctx, 'chatThreads')
    this.options = options
  }

  /** POST /api/threads — create a thread (F32-b/F095 semantics). */
  async create(input: CreateChatThreadInput): Promise<StoredThread> {
    const metadata: Record<string, unknown> = {}
    if (input.projectPath !== undefined) metadata.projectPath = input.projectPath
    if (input.pinned) metadata.pinned = true
    if (input.backlogItemId) metadata.backlogItemId = input.backlogItemId
    if (input.systemKind) metadata.systemKind = input.systemKind

    // F095 Phase C: link backlog item on creation (validate existence + ownership)
    if (input.backlogItemId) {
      const item = await Promise.resolve(
        this.ctx.catStores.backlogs().getById(input.backlogItemId),
      )
      if (!item || item.userId !== input.userId) {
        throw new ChatThreadsError(
          ThreadErrorCode.INVALID_BACKLOG_ITEM,
          'Invalid backlogItemId: backlog item not found or not owned by user',
        )
      }
    }

    const thread = await Promise.resolve(
      this.ctx.catStores.threads().create({
        userId: input.userId,
        title: input.title ?? '新对话',
        ...(input.preferredCats && input.preferredCats.length > 0
          ? { assignedCatIds: input.preferredCats }
          : {}),
        metadata,
      }),
    )
    return sanitizeThreadForResponse(thread)
  }

  /** GET /api/threads — list threads for a user (sidebar projection / q / trash). */
  async list(userId: UserId, options: ListChatThreadsOptions = {}): Promise<StoredThread[]> {
    const showDeleted = parseOptionalBoolean(options.deleted)
    const threads = await Promise.resolve(
      this.ctx.catStores.threads().listForUser(userId, {
        includeArchived: showDeleted === true,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      }),
    )
    // F095 Phase D: trash bin view = soft-deleted (archived) threads only.
    const filtered = showDeleted
      ? threads.filter((t) => t.archivedAt !== undefined)
      : threads.filter((t) => t.archivedAt === undefined)
    const q = options.q?.toLowerCase()
    const searched = q ? filtered.filter((t) => t.title.toLowerCase().includes(q)) : filtered
    return searched.map((thread) => projectThreadForListView(sanitizeThreadForResponse(thread), options.view))
  }

  /** GET /api/threads/:id — fetch + ownership check (system threads are shared). */
  async get(id: string, userId: UserId): Promise<StoredThread> {
    const thread = await Promise.resolve(this.ctx.catStores.threads().getById(id))
    if (!thread) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, '对话不存在')
    }
    if (thread.userId !== userId && thread.userId !== 'system') {
      throw new ChatThreadsError(ThreadErrorCode.UNAUTHORIZED, '无权访问此对话')
    }
    return sanitizeThreadForResponse(thread)
  }

  /** PATCH /api/threads/:id — partial update (title / preferredCats / pinned / labels). */
  async patch(id: string, patch: UpdateChatThreadInput): Promise<StoredThread> {
    const existing = await Promise.resolve(this.ctx.catStores.threads().getById(id))
    if (!existing || existing.archivedAt !== undefined) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Thread not found')
    }
    const hasAny =
      patch.title !== undefined ||
      patch.preferredCats !== undefined ||
      patch.pinned !== undefined ||
      patch.labels !== undefined
    if (!hasAny) {
      throw new ChatThreadsError(ThreadErrorCode.INVALID_INPUT, 'At least one field must be provided')
    }

    const metadata: Record<string, unknown> = { ...existing.metadata }
    if (patch.pinned !== undefined) metadata.pinned = patch.pinned
    if (patch.labels !== undefined) metadata.labels = patch.labels

    const updated = await Promise.resolve(
      this.ctx.catStores.threads().update(id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.preferredCats !== undefined ? { assignedCatIds: patch.preferredCats } : {}),
        metadata,
      }),
    )
    if (!updated) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Thread not found')
    }
    return sanitizeThreadForResponse(updated)
  }

  /**
   * DELETE /api/threads/:id — soft delete (F095 Phase D) with #35 active-invocation
   * protection and F192 system-thread guard. Data is preserved for the trash bin.
   */
  async softDelete(id: string, opts: DeleteChatThreadOptions): Promise<void> {
    // #35: protect active invocations from deletion
    if (this.options.hasActiveInvocations?.(id)) {
      throw new ChatThreadsError(
        ThreadErrorCode.ACTIVE_INVOCATION,
        '灵智体正在工作中，请等待当前任务完成后再删除对话',
      )
    }

    const thread = await Promise.resolve(this.ctx.catStores.threads().getById(id))

    // F192: system threads (IM hub / eval domain) require explicit force
    if (thread?.metadata?.systemKind && !opts.force) {
      throw new ChatThreadsError(
        ThreadErrorCode.SYSTEM_THREAD_PROTECTED,
        '系统级 thread 需要确认才能删除',
      )
    }

    // Soft delete — archivedAt marks the trash-bin state
    const deleted = await Promise.resolve(this.ctx.catStores.threads().archive(id, opts.userId))
    if (!deleted) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Cannot delete this thread')
    }

    // Cascade: drop read cursors so a restored thread starts unread-clean.
    void Promise.resolve(this.ctx.catStores.readStates().deleteByThread(id)).catch(() => {})

    // I-2: audit hook (fire-and-forget)
    if (thread) this.options.onThreadDeleted?.(thread, opts.userId)
  }

  /** POST /api/threads/:id/restore — restore a soft-deleted thread. */
  async restore(id: string): Promise<StoredThread> {
    const thread = await Promise.resolve(this.ctx.catStores.threads().getById(id))
    if (!thread) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Thread not found')
    }
    if (thread.archivedAt === undefined) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_DELETED, 'Thread is not deleted')
    }
    const restored = await Promise.resolve(this.ctx.catStores.threads().unarchive(id))
    if (!restored) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_DELETED, 'Thread is not deleted')
    }
    return sanitizeThreadForResponse(restored)
  }

  /**
   * Hard delete with cascade (messages / tasks / read states / thread).
   * Used by the trash-bin permanent-delete surface; softDelete is the default.
   */
  async purge(id: string): Promise<void> {
    if (this.options.hasActiveInvocations?.(id)) {
      throw new ChatThreadsError(ThreadErrorCode.ACTIVE_INVOCATION, 'ACTIVE_INVOCATION')
    }
    const messages = this.ctx.catStores.messages()
    await Promise.resolve(messages.deleteByThread(id))
    const tasks = this.ctx.catStores.tasks()
    const threadTasks = await Promise.resolve(tasks.listForThread(id))
    await Promise.all(threadTasks.map((task) => Promise.resolve(tasks.delete(task.id))))
    await Promise.resolve(this.ctx.catStores.readStates().deleteByThread(id))
    const ok = await Promise.resolve(this.ctx.catStores.threads().delete(id))
    if (!ok) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Thread not found')
    }
  }
}
