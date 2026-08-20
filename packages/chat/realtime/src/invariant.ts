/**
 * Invariants & constants for @flowforge/chat-realtime.
 *
 * 移植自 clowder-ai `SocketManager.ts`（room 词汇/校验规则）与阶段5计划
 * T5.11.3 事件词汇（thread:message / invocation:progress / signal:new /
 * approval:update —— 对齐 clowder-ai socket.io 事件语义）。
 *
 * @module @flowforge/chat-realtime/invariant
 */

// ---------------------------------------------------------------------------
// Room vocabulary（clowder-ai join_room 白名单语义）
// ---------------------------------------------------------------------------

/** Lobby thread id used when a broadcast omits threadId（clowder-ai `default`）。 */
export const DEFAULT_THREAD_ID = 'default'

/** Room prefixes a client may join（clowder-ai SocketManager join_room regex）。 */
export const ROOM_PREFIX_PATTERN =
  /^(thread:|worktree:|preview:global$|workspace:global$|workspace:navigate:ack$|user:)/

/** Identity-scoped room prefix — ACL: only the room owner may join. */
export const USER_ROOM_PREFIX = 'user:'

/** Thread room prefix — broadcast target for agent/user messages. */
export const THREAD_ROOM_PREFIX = 'thread:'

/** Global rooms requiring an authenticated userId（clowder-ai F156 B-3）。 */
export const GLOBAL_ROOMS: readonly string[] = [
  'workspace:global',
  'workspace:navigate:ack',
  'preview:global',
]

// ---------------------------------------------------------------------------
// Event vocabulary（T5.11.3；对齐 clowder-ai socket.io 事件名语义）
// ---------------------------------------------------------------------------

/**
 * Thread-room agent/user message stream（clowder-ai `agent_message` 语义）。
 * Payload 注入 threadId + 单调 seq + seqEpoch（F183 gap detection）。
 */
export const EVENT_THREAD_MESSAGE = 'thread:message'

/** Invocation lifecycle progress（clowder-ai heartbeat/intent_mode/queue 语义）。 */
export const EVENT_INVOCATION_PROGRESS = 'invocation:progress'

/** New signal notification（user-scoped，clowder-ai emitToUser 族语义）。 */
export const EVENT_SIGNAL_NEW = 'signal:new'

/** Proposal/approval lifecycle update（clowder-ai `proposal_updated`/`proposal_created` 语义）。 */
export const EVENT_APPROVAL_UPDATE = 'approval:update'

// ---------------------------------------------------------------------------
// Cancel semantics（clowder-ai cancel_invocation handler constants）
// ---------------------------------------------------------------------------

/** F254: only explicit Stop provenance is accepted. */
export const CANCEL_ORIGIN_EXPLICIT_STOP = 'explicit_stop'

/** Cancel abort reason for single-slot user cancel（tracker.cancel 入参）。 */
export const CANCEL_REASON_USER_CANCEL = 'user_cancel'

/** Cancel-all abort reason — suppresses auto-resume（clowder-ai 语义区分）。 */
export const CANCEL_REASON_CANCEL_ALL = 'cancel_all'

/** F254 provenance field length bounds（actionId/clientInstanceId）。 */
export const CANCEL_PROVENANCE_MAX_LENGTH = 200

/** Cancel feedback copy（clowder-ai buildCancelMessages）。 */
export const CANCEL_FEEDBACK_TEXT = '⏹ 已取消'

/** broadcastToRoomWithAck default timeout（clowder-ai 1500ms）。 */
export const ACK_BROADCAST_TIMEOUT_MS = 1500

/**
 * Rejection outcomes for handleCancelInvocation（结构化，供路由层/测试断言）。
 * 对应 clowder-ai log.warn 的四类拒绝路径。
 */
export const CancelRejectReason = {
  NO_TRACKER: 'NO_TRACKER',
  MISSING_THREAD: 'MISSING_THREAD',
  UNATTRIBUTED: 'UNATTRIBUTED',
  DUPLICATE_ACTION: 'DUPLICATE_ACTION',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
} as const

export type CancelRejectReasonValue = (typeof CancelRejectReason)[keyof typeof CancelRejectReason]
