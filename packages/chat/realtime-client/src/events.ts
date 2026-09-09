/**
 * @flowforge/chat-realtime-client/events — 浏览器侧事件词表。
 *
 * 转发 `@flowforge/chat-realtime` 已披露的服务端事件名与载荷类型，使页面侧
 * 与服务器绑定侧共用同一词表，避免事件名/载荷漂移；并暴露客户端发起的
 * 房间动作基线（join_room / leave_room）。
 *
 * @module @flowforge/chat-realtime-client/events
 */

import {
  EVENT_APPROVAL_UPDATE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_THREAD_MESSAGE,
  type AgentMessage,
  type AgentMessageType,
  type ApprovalUpdatePayload,
  type BroadcastAgentMessage,
  type InvocationProgressPayload,
  type SignalNewPayload,
} from '@flowforge/chat-realtime'
import { CLIENT_EVENT_JOIN_ROOM, CLIENT_EVENT_LEAVE_ROOM } from './transport.ts'

export {
  EVENT_APPROVAL_UPDATE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_THREAD_MESSAGE,
}
export type {
  AgentMessage,
  AgentMessageType,
  ApprovalUpdatePayload,
  BroadcastAgentMessage,
  InvocationProgressPayload,
  SignalNewPayload,
}
export { CLIENT_EVENT_JOIN_ROOM, CLIENT_EVENT_LEAVE_ROOM }