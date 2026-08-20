/**
 * @flowforge/chat-realtime — chat realtime event face Cordis plugin (stage-5 batch 3).
 *
 * Mounts `ChatRealtimeService` at `ctx.chatRealtime` over an injectable
 * `RealtimeTransport` seam (default: in-process `InMemoryRealtimeTransport`;
 * socket.io adapter provided by the composition root's WS domain):
 * - broadcast face: broadcastAgentMessage (thread:message + F183 seq/seqEpoch
 *   injection + BroadcastRateMonitor) / broadcastToRoom(+WithAck) / emitToUser /
 *   invocation:progress / signal:new / approval:update vocabulary
 * - room management: join_room whitelist + F156 user-room ACL + global-room auth
 * - cancel orchestration: F254 explicit provenance, F108 scoped cancel,
 *   F-parallel-cancel scoped broadcast, session-mutex force release, slot
 *   cleanup + multi-mention abort late wiring
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/chat-realtime'
 * # optional collaborators (lazy-resolved at cancel time):
 * - name: '@flowforge/cats-invocation'   # mounts tracker/mutex/queue services
 * ```
 *
 * @module @flowforge/chat-realtime
 */

import type { Context } from '@flowforge/cordis'
import { ChatRealtimeService } from './realtime-service.ts'
import type { ChatRealtimeServiceOptions } from './realtime-service.ts'

export { buildCancelMessages, ChatRealtimeService } from './realtime-service.ts'
export type {
  CancelInvocationInput,
  CancelInvocationOutcome,
  CancelMessagesInput,
  CancelSlotCleanup,
  ChatRealtimeServiceOptions,
  MentionAbort,
} from './realtime-service.ts'

export {
  ACK_BROADCAST_TIMEOUT_MS,
  CANCEL_FEEDBACK_TEXT,
  CANCEL_ORIGIN_EXPLICIT_STOP,
  CANCEL_PROVENANCE_MAX_LENGTH,
  CANCEL_REASON_CANCEL_ALL,
  CANCEL_REASON_USER_CANCEL,
  CancelRejectReason,
  DEFAULT_THREAD_ID,
  EVENT_APPROVAL_UPDATE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_THREAD_MESSAGE,
  GLOBAL_ROOMS,
  ROOM_PREFIX_PATTERN,
  THREAD_ROOM_PREFIX,
  USER_ROOM_PREFIX,
} from './invariant.ts'
export type { CancelRejectReasonValue } from './invariant.ts'

export type {
  AgentMessage,
  AgentMessageType,
  ApprovalUpdatePayload,
  BroadcastAgentMessage,
  InvocationProgressPayload,
  SignalNewPayload,
} from './events.ts'

export { BroadcastRateMonitor } from './rate-monitor.ts'
export type {
  BroadcastRateMonitorOptions,
  BroadcastRateStats,
  BroadcastRateWarnEvent,
} from './rate-monitor.ts'

export { ThreadSequencer } from './thread-sequencer.ts'

export { InMemoryRealtimeTransport } from './transport.ts'
export type {
  InMemoryRealtimeClient,
  RealtimeServerSocket,
  RealtimeTransport,
} from './transport.ts'

export default function Plugin(ctx: Context, options?: ChatRealtimeServiceOptions) {
  ctx.plugin(ChatRealtimeService, options)
}
