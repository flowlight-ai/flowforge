/**
 * @flowforge/chat-messages — chat message domain Cordis plugin (stage-5 batch 2).
 *
 * Mounts two services over `ctx.catStores` (stage-4 ports + Memory/Sqlite
 * backends):
 * - `MessageService`       → `ctx.chatMessages`       — publish (idempotency /
 *   delivery-mode) / history cursor pagination / delivery lifecycle
 * - `MessageActionService` → `ctx.chatMessageActions` — soft/hard delete /
 *   restore / F096 interactive block-state
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'   # aggregate + default Memory backend
 * - name: '@flowforge/chat-messages'
 * ```
 *
 * @module @flowforge/chat-messages
 */

import type { Context } from '@flowforge/cordis'
import { MessageActionService } from './message-action-service.ts'
import { MessageService } from './message-service.ts'

export {
  UNDECLARED_CARRIER_CAPABILITY,
  resolveFreshnessCarrierCapabilityOrUndeclared,
  resolveMessageDispositionForAdmission,
  resolveQueueAuthorIntentByCatId,
} from './disposition.ts'
export type {
  ExactParentTracker,
  FreshnessCarrierCapability,
  MessageWorkDisposition,
  QueueAuthorIntent,
} from './disposition.ts'
export {
  AUTO_TITLE_MAX_LENGTH,
  DEFAULT_THREAD_ID,
  HARD_DELETE_CONFIRM_PHRASE,
  MessageErrorCode,
  UNTITLED_THREAD_TITLES,
} from './invariant.ts'
export type { MessageErrorCodeValue } from './invariant.ts'
export { MessageActionService } from './message-action-service.ts'
export type {
  DeletedMessageResult,
  MessageActionServiceOptions,
  PatchBlockStateInput,
  RestoredMessageResult,
} from './message-action-service.ts'
export { ChatMessagesError, MessageService, parseHistoryCursor } from './message-service.ts'
export type {
  MessageHistoryOptions,
  MessageHistoryPage,
  MessageServiceOptions,
  PublishMessageInput,
  PublishMessageResult,
  QueueAdmissionOutcome,
} from './message-service.ts'

export default function Plugin(ctx: Context) {
  ctx.plugin(MessageService)
  ctx.plugin(MessageActionService)
}
