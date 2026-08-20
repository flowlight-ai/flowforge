/**
 * @flowforge/chat-mention — chat @mention 路由 / 多 @ 并发编排 / callback-auth Cordis
 * 插件（阶段5 批次5）。
 *
 * Mounts `MultiMentionOrchestratorService` at `ctx.chatMention`：
 * - MentionParser 纯函数（F086 #969）：零宽字符/markdown 噪声清理 + 首个 @mention 提取
 * - Multi-Mention 编排（F086 M1）：pending→running→partial→done/timeout/failed 状态机、
 *   响应归集、线程/槽级取消（MentionAbort）、catsInvocationQueue 并发派发
 * - callback-auth 签名校验纯函数 + F174 D2b-1 in-context 失败表面化 notifier
 *
 * 队列经 `ctx.catsInvocationQueue` 懒解析（可选依赖，未装载时 dispatch 降级为
 * 'skipped'）；取消取消由组合根 `chatRealtime.setMentionAbort(chatMention)` 接线。
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-invocation'
 * - name: '@flowforge/chat-mention'
 * ```
 *
 * @module @flowforge/chat-mention
 */

import type { Context } from '@flowforge/cordis'
import { MultiMentionOrchestratorService } from './multi-mention-service.ts'

export { MultiMentionOrchestrator } from './multi-mention-orchestrator.ts'
export type { MultiMentionCreateParams } from './multi-mention-orchestrator.ts'
export { isValidTransition, getAllowedTransitions } from './multi-mention-state-machine.ts'

export {
  normalizeCatIdMentionsInText,
  normalizeMentionNoise,
  parseMentions,
  primaryMentionHandleFromPatterns,
} from './mention-parser.ts'
export type { ParsedMention } from './mention-parser.ts'

export {
  CallbackAuthSystemMessageNotifier,
  callbackToolFromUrl,
  extractCallbackCredentials,
  extractLegacyCredentials,
  isBackgroundHeartbeatTool,
  isSurfaceableReason,
} from './callback-auth.ts'
export type {
  CallbackAuthFailureBlock,
  CallbackAuthMessageStore,
  CallbackAuthReason,
  CallbackAuthSocketBroadcaster,
  HideSimilarParams,
  NotifyParams,
  NotifierOptions,
} from './callback-auth.ts'

export {
  BACKGROUND_HEARTBEAT_TOOLS,
  CALLBACK_AUTH_SOURCE,
  DEDUP_WINDOW_MS,
  HIDE_WINDOW_MS,
  REASON_DESCRIPTIONS,
  SURFACEABLE_REASONS,
} from './invariant.ts'

export { MultiMentionOrchestratorService } from './multi-mention-service.ts'
export type { DispatchInput, MultiMentionDispatchOutcome } from './multi-mention-service.ts'

export default function Plugin(ctx: Context) {
  ctx.plugin(MultiMentionOrchestratorService)
}