/**
 * ChatMemoryPublishService — 记忆发布门禁服务（T5.7.2）。
 *
 * 移植 clowder-ai `routes/memory-publish.ts`（api/src/routes/）的路由语义为
 * Cordis 服务（R13 一切皆插件改造）：
 * - publishMemory：POST /api/memory/publish 语义 —— 治理状态机迁移
 *   （submit_review 可自动创建 draft；其他 action 缺失 → 404）
 * - GovernanceConflictError → 409 语义错误
 * - 审计经 `ctx.catsAudit`（@flowforge/cats-orchestration）best-effort 写入，
 *   失败不阻断迁移（对齐 clowder）
 *
 * @module @flowforge/chat-misc
 */

import { Context, Service } from '@flowforge/cordis'
import { AuditEventTypes, type AuditEventInput } from '@flowforge/cats-shared'
import {
  GovernanceConflictError,
  type GovernanceEntry,
  type PublishAction,
} from '@flowforge/cats-stores'
import type { EventAuditLogService } from '@flowforge/cats-orchestration'

export const ChatMemoryPublishErrorCode = {
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  CONFLICT: 'CONFLICT',
} as const

export class ChatMemoryPublishError extends Error {
  readonly code: (typeof ChatMemoryPublishErrorCode)[keyof typeof ChatMemoryPublishErrorCode]
  readonly status: number
  readonly detail?: Record<string, unknown> | undefined

  constructor(
    code: (typeof ChatMemoryPublishErrorCode)[keyof typeof ChatMemoryPublishErrorCode],
    message: string,
    status: number,
    detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ChatMemoryPublishError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** 发布输入（clowder memory-publish 路由契约）。 */
export interface PublishChatMemoryInput {
  readonly entryId: string
  readonly action: PublishAction
  readonly actor: 'user' | string
}

/** 发布结果。 */
export interface PublishChatMemoryResult {
  readonly entryId: string
  readonly previousStatus: GovernanceEntry['status']
  readonly currentStatus: GovernanceEntry['status']
  readonly auditId?: string
}

/** Map publish action → audit event type. */
const ACTION_TO_AUDIT: Record<PublishAction, string> = {
  submit_review: AuditEventTypes.MEMORY_PUBLISH_SUBMITTED,
  approve: AuditEventTypes.MEMORY_PUBLISH_APPROVED,
  archive: AuditEventTypes.MEMORY_PUBLISH_ARCHIVED,
  rollback: AuditEventTypes.MEMORY_PUBLISH_ROLLBACK,
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 记忆发布门禁服务（T5.7.2）— mounted by `@flowforge/chat-misc`. */
    chatMemoryPublish: ChatMemoryPublishService
  }
}

/**
 * 记忆发布门禁服务。挂载点 `ctx.chatMemoryPublish`（`@flowforge/chat-misc`）。
 */
export class ChatMemoryPublishService extends Service {
  static inject = ['catStores']

  constructor(ctx: Context) {
    super(ctx, 'chatMemoryPublish')
  }

  /** 治理状态迁移（POST /api/memory/publish 语义）。 */
  async publishMemory(input: PublishChatMemoryInput): Promise<PublishChatMemoryResult> {
    const governance = this.ctx.catStores.memoryGovernance()

    try {
      let before = await governance.get(input.entryId)

      // Only submit_review can auto-create a draft.
      // Other actions on missing entries → 404 (not 409).
      if (!before) {
        if (input.action !== 'submit_review') {
          throw new ChatMemoryPublishError(
            ChatMemoryPublishErrorCode.ENTRY_NOT_FOUND,
            `Entry ${input.entryId} not found`,
            404,
            { action: input.action },
          )
        }
        before = await governance.create(input.entryId, input.actor)
      }

      const previousStatus = before.status
      const after = await governance.transition(input.entryId, input.action, input.actor)

      // Write audit log (best-effort — failure must not block the transition).
      let auditId: string | undefined
      try {
        const auditInput: AuditEventInput = {
          type: ACTION_TO_AUDIT[input.action] ?? `memory_publish_${input.action}`,
          data: { entryId: input.entryId, previousStatus, currentStatus: after.status, actor: input.actor },
        }
        const auditService: EventAuditLogService | undefined = this.ctx.catsAudit
        const event = await auditService?.append(auditInput)
        auditId = event?.id
      } catch {
        // Audit failure should not block the transition
      }

      return {
        entryId: input.entryId,
        previousStatus,
        currentStatus: after.status,
        ...(auditId ? { auditId } : {}),
      }
    } catch (err) {
      if (err instanceof GovernanceConflictError) {
        throw new ChatMemoryPublishError(
          ChatMemoryPublishErrorCode.CONFLICT,
          err.message,
          409,
          { currentStatus: err.currentStatus, action: err.action },
        )
      }
      throw err
    }
  }
}
