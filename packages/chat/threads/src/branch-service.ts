/**
 * ThreadBranchService — 线程分支 Cordis 服务（阶段5 批次1，ctx.chatBranch）。
 *
 * 移植自 clowder-ai `routes/thread-branch.ts`（ADR-008 D4 "Edit = Branch"）：
 * 编辑某条消息 = 以该消息为切点创建新线程，历史消息复制到切点处，
 * 最后一条以编辑后内容替换；任一复制失败即回滚（删除孤儿分支线程与
 * 已复制消息）。通知经 `onBranched` 回调解耦（批次3 realtime 接
 * socket `thread_branched` 广播）。
 *
 * @module @flowforge/chat-threads/branch
 */

import { Context, Service } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import type { StoredThread } from '@flowforge/cats-stores'
import { BRANCH_FALLBACK_TITLE, BRANCH_MAX_MESSAGES, BRANCH_TITLE_SUFFIX, ThreadErrorCode } from './invariant.ts'
import { ChatThreadsError } from './thread-service.ts'

/** Input for creating a branch from a message. */
export interface BranchFromMessageInput {
  readonly threadId: string
  readonly fromMessageId: string
  /** Replacement content for the branch point message (the "edit"). */
  readonly editedContent?: string
  readonly userId: UserId
}

/** Result of a successful branch. */
export interface BranchResult {
  readonly threadId: string
  readonly messageCount: number
  readonly title: string
}

export interface BranchServiceOptions {
  /**
   * Notify hook fired after a successful branch (clowder-ai broadcasts
   * `thread_branched` to `thread:<id>` room). Stage-5 batch 3 wires this to
   * the realtime service; tests use it to assert notification semantics.
   */
  readonly onBranched?: (event: {
    readonly sourceThreadId: string
    readonly newThreadId: string
    readonly fromMessageId: string
  }) => void
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat thread branch service — mounted by `@flowforge/chat-threads`. */
    chatBranch: ThreadBranchService
  }
}

/**
 * Cordis service exposing edit-as-branch at `ctx.chatBranch`.
 */
export class ThreadBranchService extends Service {
  static inject = ['catStores'] as const

  private readonly options: BranchServiceOptions

  constructor(ctx: Context, options: BranchServiceOptions = {}) {
    super(ctx, 'chatBranch')
    this.options = options
  }

  /** POST /api/threads/:id/branch — create a branch from a message. */
  async branchFromMessage(input: BranchFromMessageInput): Promise<BranchResult> {
    const { threadId, fromMessageId, editedContent, userId } = input
    const threads = this.ctx.catStores.threads()
    const messages = this.ctx.catStores.messages()

    // ① Source thread must exist and caller must have access
    const sourceThread = await Promise.resolve(threads.getById(threadId))
    if (!sourceThread) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, '对话不存在')
    }
    if (sourceThread.userId !== userId && sourceThread.userId !== 'system') {
      throw new ChatThreadsError(ThreadErrorCode.UNAUTHORIZED, '无权对此对话创建分支')
    }

    // ② fromMessage must exist and belong to this thread
    const fromMessage = await Promise.resolve(messages.getById(fromMessageId))
    if (!fromMessage || fromMessage.threadId !== threadId) {
      throw new ChatThreadsError(ThreadErrorCode.INVALID_FROM_MESSAGE, '指定的消息不存在或不属于此对话')
    }

    // ③ Visible messages up to and including fromMessage (soft-deleted
    //    messages are filtered by the store — cannot branch from deleted)
    const allMessages = await Promise.resolve(messages.getByThread(threadId, BRANCH_MAX_MESSAGES, userId))
    const cutIndex = allMessages.findIndex((m) => m.id === fromMessageId)
    if (cutIndex === -1) {
      throw new ChatThreadsError(ThreadErrorCode.FROM_MESSAGE_DELETED, '无法从已删除的消息创建分支')
    }
    const messagesToCopy = allMessages.slice(0, cutIndex + 1)

    // ④ New thread with "(分支)" suffix
    const branchTitle = sourceThread.title
      ? `${sourceThread.title}${BRANCH_TITLE_SUFFIX}`
      : BRANCH_FALLBACK_TITLE
    const newThread = await Promise.resolve(
      threads.create({
        userId,
        title: branchTitle,
        ...(sourceThread.assignedCatIds ? { assignedCatIds: sourceThread.assignedCatIds } : {}),
        metadata: {
          ...(sourceThread.metadata?.projectPath !== undefined
            ? { projectPath: sourceThread.metadata.projectPath }
            : {}),
          branchedFrom: threadId,
          branchedFromMessageId: fromMessageId,
        },
      }),
    )

    // ⑤ Copy messages inside a guarded block; roll back on any failure
    try {
      for (let i = 0; i < messagesToCopy.length; i++) {
        const src = messagesToCopy[i]!
        const isLast = i === messagesToCopy.length - 1
        const replaced = isLast && editedContent !== undefined
        await Promise.resolve(
          messages.append({
            userId: src.userId,
            catId: src.catId,
            content: replaced ? editedContent! : src.content,
            ...(src.contentBlocks && !replaced ? { contentBlocks: src.contentBlocks } : {}),
            ...(src.metadata ? { metadata: src.metadata } : {}),
            ...(src.origin ? { origin: src.origin } : {}),
            mentions: [...src.mentions],
            timestamp: src.timestamp,
            threadId: newThread.id,
          }),
        )
      }
    } catch (err) {
      // Best-effort rollback: remove the orphan branch thread + copied messages
      await this.rollbackBranch(newThread)
      throw new ChatThreadsError(
        ThreadErrorCode.BRANCH_FAILED,
        `分支创建失败，已回滚: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    this.options.onBranched?.({
      sourceThreadId: threadId,
      newThreadId: newThread.id,
      fromMessageId,
    })

    return { threadId: newThread.id, messageCount: messagesToCopy.length, title: branchTitle }
  }

  /** Best-effort rollback — delete copied messages then the orphan thread. */
  private async rollbackBranch(newThread: StoredThread): Promise<void> {
    const messages = this.ctx.catStores.messages()
    const threads = this.ctx.catStores.threads()
    await Promise.resolve(messages.deleteByThread(newThread.id)).catch(() => {})
    await Promise.resolve(threads.delete(newThread.id)).catch(() => {})
  }
}
