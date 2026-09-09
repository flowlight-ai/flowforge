/**
 * @flowforge/chat-realtime-client — 浏览器实时通道客户端。
 *
 * 把 socket.io 原始事件收敛为类型化回调面（{@link ChatRealtimeClient}），
 * 对齐 `@flowforge/chat-realtime` 事件词表与房间语义。socket 一律经
 * {@link SocketIoClientLike} seam 注入；真实浏览器连接由组合根用
 * `io(url, opts)` 得到 socket 后注入，本包不直接 import `socket.io-client`
 * （R16 最小依赖策略）。
 *
 * @module @flowforge/chat-realtime-client
 */

export { ChatRealtimeClient } from './client.ts'
export type {
  ChatRealtimeClientHandlers,
  ChatRealtimeClientOptions,
  RealtimeStatus,
} from './client.ts'

export {
  buildCancelInvocation,
  buildJoinRoom,
  buildLeaveRoom,
  CANCEL_ORIGIN_EXPLICIT_STOP,
  CANCEL_PROVENANCE_ACTION_ID,
  CANCEL_PROVENANCE_CLIENT_INSTANCE_ID,
  CANCEL_REASON_USER_CANCEL,
  CLIENT_EVENT_JOIN_ROOM,
  CLIENT_EVENT_LEAVE_ROOM,
  threadRoom,
  userRoom,
} from './transport.ts'
export type { CancelInvocationPayload, SocketIoClientLike } from './transport.ts'

export {
  EVENT_APPROVAL_UPDATE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_THREAD_MESSAGE,
} from './events.ts'
export type {
  AgentMessage,
  AgentMessageType,
  ApprovalUpdatePayload,
  BroadcastAgentMessage,
  InvocationProgressPayload,
  SignalNewPayload,
} from './events.ts'