/**
 * FreshnessService — 副作用新鲜度闸门 Cordis 服务（F254 裁剪版）。
 *
 * 移植自 clowder-ai `freshness/FreshnessGateService.ts`（R13 一切皆插件改造）：
 * - 决定 post_message / cross_post 等副作用是放行（forward）还是扣留（held）
 * - 使用独立的 seenCursor（非 deliveryCursor，AC-A9 隔离）
 * - AC-A5 acknowledgeHeld 逃生舱 / AC-A3 cursor 缺失 fail-open
 * - cursor 依赖经 `ctx.catStores.deliveryCursors()` 解析（inject=['catStores']）
 * - `Context` 扩展挂载点：`ctx.catsFreshness`（对齐 24-stage4 计划 T4.5.5）
 *
 * @module @flowforge/cats-orchestration/freshness
 */

import { Context, Service } from '@flowforge/cordis'
import { createThreadId, createUserId } from '@flowforge/cats-shared'
import type {
  FreshnessCheckInput,
  FreshnessDecision,
} from '@flowforge/cats-shared'
import { FRESHNESS_HELD_CONTEXT_LIMIT } from './invariant.ts'

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) 副作用新鲜度闸门 — mounted by `@flowforge/cats-orchestration`.
     */
    catsFreshness: FreshnessService
  }
}

/**
 * Cordis service exposing the F254 freshness gate at `ctx.catsFreshness`.
 */
export class FreshnessService extends Service {
  static inject = ['catStores']

  constructor(ctx: Context) {
    super(ctx, 'catsFreshness')
  }

  /**
   * Decide whether to hold or forward a side-effect based on whether the cat
   * has unseen (non-self) messages in the target thread.
   */
  async checkFreshness(input: FreshnessCheckInput): Promise<FreshnessDecision> {
    const { userId, catId, threadId, latestMessageId, toolName, acknowledgeHeld } = input

    // AC-A5: acknowledgeHeld escape hatch — force forward
    if (acknowledgeHeld) {
      return { decision: 'forward', reason: 'acknowledge_held', unseenCount: 0, toolName }
    }

    // seenCursor (NOT deliveryCursor — AC-A9)
    const seenCursor = await this.ctx.catStores
      .deliveryCursors()
      .getSeenCursor(createUserId(userId), catId, createThreadId(threadId))

    // AC-A3: fail-open when cursor doesn't exist
    if (seenCursor == null) {
      return { decision: 'forward', reason: 'cursor_missing_fail_open', unseenCount: 0, toolName }
    }

    // No unseen messages when caller didn't provide details: seenCursor >= latestMessageId
    // (sortable-string domain — lex comparison is monotonic)
    const hasCallerProvidedMessages = (input.unseenMessages?.length ?? 0) > 0
    if (!hasCallerProvidedMessages && seenCursor >= latestMessageId) {
      return { decision: 'forward', reason: 'no_unseen', unseenCount: 0, toolName }
    }

    // Filter out self-messages
    const unseenMessages = input.unseenMessages ?? []
    const nonSelfUnseen = unseenMessages.filter((msg) => !(msg.selfSource ?? msg.from === catId))

    // All unseen are from self — don't hold
    if (nonSelfUnseen.length === 0 && unseenMessages.length > 0) {
      return { decision: 'forward', reason: 'all_self_messages', unseenCount: 0, toolName }
    }

    // Cursor says behind but no message details provided — still hold
    if (nonSelfUnseen.length === 0 && unseenMessages.length === 0) {
      return {
        decision: 'held',
        reason: 'unseen_available',
        unseenCount: 0, // count unknown without messages
        toolName,
        previews: [],
        omittedCount: 0,
      }
    }

    // Held envelope with capped previews (AC-A4)
    const previews = nonSelfUnseen.slice(0, FRESHNESS_HELD_CONTEXT_LIMIT).map((msg) => ({
      from: msg.from,
      messageId: msg.id,
      preview: msg.preview,
    }))
    const omittedCount = Math.max(0, nonSelfUnseen.length - FRESHNESS_HELD_CONTEXT_LIMIT)

    return {
      decision: 'held',
      reason: 'unseen_available',
      unseenCount: nonSelfUnseen.length,
      toolName,
      previews,
      omittedCount,
    }
  }
}
