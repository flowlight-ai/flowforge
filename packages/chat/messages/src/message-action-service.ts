/**
 * MessageActionService — 消息行动域 Cordis 服务（阶段5 批次2，ctx.chatMessageActions）。
 *
 * 移植自 clowder-ai `routes/message-actions.ts`（R13 一切皆插件改造）：
 * - delete（ADR-008 D3 / S5+S6：soft 默认；hard 需 confirmTitle 与线程标题
 *   匹配——无标题线程用固定确认短语；权限=作者或线程创建者）
 * - restore（仅删除者或线程创建者；tombstone（已硬删）不可恢复）
 * - patchBlockState（F096：交互块状态持久化，仅 interactive 块可改）
 * 实时广播（message_deleted/message_hard_deleted/message_restored）经
 * options 钩子注入，批次3 realtime 接线。
 *
 * @module @flowforge/chat-messages/actions
 */

import { Context, Service } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import type { StoredMessage } from '@flowforge/cats-stores'
import { HARD_DELETE_CONFIRM_PHRASE, MessageErrorCode } from './invariant.ts'
import { ChatMessagesError } from './message-service.ts'

/** Result shape of a successful delete (mirrors clowder-ai route body). */
export interface DeletedMessageResult {
  readonly id: string
  readonly threadId: string
  readonly deletedAt?: number
  readonly deletedBy?: string
  /** Hard delete only — the message is gone, only the tombstone remains. */
  readonly _tombstone?: true
}

/** Result shape of a successful restore. */
export interface RestoredMessageResult {
  readonly id: string
  readonly threadId: string
  readonly content: string
  readonly timestamp: number
}

/** Interactive block-state patch input (F096). */
export interface PatchBlockStateInput {
  readonly userId: UserId
  readonly blockId: string
  readonly disabled?: boolean
  readonly selectedIds?: readonly string[]
}

/** Constructor options — realtime hooks kept out of Cordis inject. */
export interface MessageActionServiceOptions {
  readonly onDeleted?: (message: StoredMessage, deletedBy: string, mode: 'soft' | 'hard') => void
  readonly onRestored?: (message: StoredMessage) => void
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat message action service — mounted by `@flowforge/chat-messages`. */
    chatMessageActions: MessageActionService
  }
}

/**
 * Cordis service exposing message actions at `ctx.chatMessageActions`.
 */
export class MessageActionService extends Service {
  static inject = ['catStores'] as const

  private readonly options: MessageActionServiceOptions

  constructor(ctx: Context, options: MessageActionServiceOptions = {}) {
    super(ctx, 'chatMessageActions')
    this.options = options
  }

  /** DELETE /api/messages/:id — soft (default) or hard delete with confirmTitle. */
  async delete(
    id: string,
    input: { userId: UserId; mode?: 'soft' | 'hard'; confirmTitle?: string },
  ): Promise<DeletedMessageResult> {
    const mode = input.mode ?? 'soft'
    const target = await this.assertCanAct(id, input.userId, '无权删除此消息')

    if (mode === 'hard') {
      if (!input.confirmTitle) {
        throw new ChatMessagesError(MessageErrorCode.CONFIRM_TITLE_REQUIRED, '硬删除需要输入对话标题确认')
      }
      const thread = await Promise.resolve(this.ctx.catStores.threads().getById(target.threadId))
      const expectedTitle = thread?.title || HARD_DELETE_CONFIRM_PHRASE
      if (input.confirmTitle !== expectedTitle) {
        throw new ChatMessagesError(MessageErrorCode.CONFIRM_TITLE_MISMATCH, '对话标题不匹配')
      }
      const deleted = await Promise.resolve(this.ctx.catStores.messages().hardDelete(id, input.userId))
      if (!deleted) {
        throw new ChatMessagesError(MessageErrorCode.DELETE_FAILED, '删除失败')
      }
      this.options.onDeleted?.(deleted, input.userId, 'hard')
      return {
        id: deleted.id,
        threadId: deleted.threadId,
        ...(deleted.deletedAt !== undefined ? { deletedAt: deleted.deletedAt } : {}),
        ...(deleted.deletedBy !== undefined ? { deletedBy: deleted.deletedBy } : {}),
        _tombstone: true,
      }
    }

    const deleted = await Promise.resolve(this.ctx.catStores.messages().softDelete(id, input.userId))
    if (!deleted) {
      throw new ChatMessagesError(MessageErrorCode.MESSAGE_NOT_FOUND, '消息不存在')
    }
    this.options.onDeleted?.(deleted, input.userId, 'soft')
    return {
      id: deleted.id,
      threadId: deleted.threadId,
      ...(deleted.deletedAt !== undefined ? { deletedAt: deleted.deletedAt } : {}),
      ...(deleted.deletedBy !== undefined ? { deletedBy: deleted.deletedBy } : {}),
    }
  }

  /** PATCH /api/messages/:id/restore — restore a soft-deleted message. */
  async restore(id: string, input: { userId: UserId }): Promise<RestoredMessageResult> {
    const target = await Promise.resolve(this.ctx.catStores.messages().getById(id))
    if (!target) {
      throw new ChatMessagesError(MessageErrorCode.MESSAGE_NOT_FOUND, '消息不存在')
    }
    if (!target.deletedAt || target._tombstone) {
      throw new ChatMessagesError(
        MessageErrorCode.MESSAGE_NOT_RESTORABLE,
        '消息不存在、未被删除、或已硬删除',
      )
    }
    // Only the deleter or the thread creator may restore.
    if (target.deletedBy !== input.userId) {
      await this.assertThreadCreatorOrThrow(target, input.userId, '无权恢复此消息')
    }
    const restored = await Promise.resolve(this.ctx.catStores.messages().restore(id))
    if (!restored) {
      throw new ChatMessagesError(MessageErrorCode.DELETE_FAILED, '恢复失败')
    }
    this.options.onRestored?.(restored)
    return {
      id: restored.id,
      threadId: restored.threadId,
      content: restored.content,
      timestamp: restored.timestamp,
    }
  }

  /** F096: PATCH /api/messages/:id/block-state — persist interactive block state. */
  async patchBlockState(id: string, input: PatchBlockStateInput): Promise<{ status: 'ok' }> {
    const target = await this.assertCanAct(id, input.userId, '无权修改此消息')

    const rich = (target.metadata?.rich ?? undefined) as
      | { blocks?: Array<Record<string, unknown>> }
      | undefined
    const blocks = rich?.blocks
    if (!blocks) {
      throw new ChatMessagesError(MessageErrorCode.NO_RICH_BLOCKS, 'Message has no rich blocks')
    }
    const block = blocks.find((b) => b['id'] === input.blockId)
    if (!block) {
      throw new ChatMessagesError(MessageErrorCode.BLOCK_NOT_FOUND, `Block ${input.blockId} not found`)
    }
    if (block['kind'] !== 'interactive') {
      throw new ChatMessagesError(
        MessageErrorCode.BLOCK_NOT_INTERACTIVE,
        `Block ${input.blockId} is not interactive (kind: ${String(block['kind'])})`,
      )
    }

    const merged = { ...block }
    if (input.disabled !== undefined) merged['disabled'] = input.disabled
    if (input.selectedIds !== undefined) merged['selectedIds'] = [...input.selectedIds]

    const nextRich = { ...rich, blocks: blocks.map((b) => (b === block ? merged : b)) }
    await Promise.resolve(this.ctx.catStores.messages().updateExtra(id, { rich: nextRich }))
    return { status: 'ok' }
  }

  /** Fetch + authorize: message author or thread creator (clowder-ai P1-1). */
  private async assertCanAct(id: string, userId: UserId, denialMessage: string): Promise<StoredMessage> {
    const target = await Promise.resolve(this.ctx.catStores.messages().getById(id))
    if (!target) {
      throw new ChatMessagesError(MessageErrorCode.MESSAGE_NOT_FOUND, '消息不存在')
    }
    if (target.userId !== userId) {
      await this.assertThreadCreatorOrThrow(target, userId, denialMessage)
    }
    return target
  }

  /** Thread-creator authorization branch — throws UNAUTHORIZED when denied. */
  private async assertThreadCreatorOrThrow(
    target: StoredMessage,
    userId: UserId,
    denialMessage: string,
  ): Promise<void> {
    const thread = await Promise.resolve(this.ctx.catStores.threads().getById(target.threadId))
    if (!thread || thread.userId !== userId) {
      throw new ChatMessagesError(MessageErrorCode.UNAUTHORIZED, denialMessage)
    }
  }
}
