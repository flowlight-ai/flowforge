/**
 * @flowforge/chat-realtime-client/transport — Socket.IO client seam。
 *
 * 与 `@flowforge/chat-realtime` 同理，本包把浏览器连接抽象为
 * {@link SocketIoClientLike} 注入 seam：契约测试用内存假 socket 驱动，
 * 真实浏览器连接经 {@link defaultClientFor} 适配 socket.io-client socket
 * 装配。服务器绑定语义（thread:/user: 房间、join_room/leave_room）以纯函数
 * 居于此模块，便于逐字断言与单测。
 *
 * @module @flowforge/chat-realtime-client/transport
 */

/** socket.io 客户端 socket 的业务子集（浏览器往返 socket）。 */
export interface SocketIoClientLike {
  /** 已建立连接。 */
  readonly connected: boolean
  /** 连接 id（socket.io socket.id；连接时非空）。 */
  readonly id?: string | undefined
  /** 注册服务端 → 客户端事件监听。 */
  on(event: string, handler: (payload: unknown) => void): void
  /** 移除服务端 → 客户端事件监听。 */
  off(event: string, handler: (payload: unknown) => void): void
  /** 客户端 → 服务端事件发送（join_room/leave_room/cancel_invocation 等）。 */
  emit(event: string, ...args: unknown[]): void
  /** 主动断开（导航离开/登出）。 */
  disconnect(): void
}

/** `@flowforge/chat-realtime` 已披露的加入/离开房间客户端事件基线。 */
export const CLIENT_EVENT_JOIN_ROOM = 'join_room'
export const CLIENT_EVENT_LEAVE_ROOM = 'leave_room'
/** 多标签页取消协调的在途 provenance 字段（对齐 chat-realtime cancel 语义）。 */
export const CANCEL_PROVENANCE_ACTION_ID = 'actionId'
export const CANCEL_PROVENANCE_CLIENT_INSTANCE_ID = 'clientInstanceId'
export const CANCEL_REASON_USER_CANCEL = 'user_cancel'
export const CANCEL_ORIGIN_EXPLICIT_STOP = 'explicit_stop'

/** 线程房间名（对齐 chat-realtime `thread:` 房间前缀）。 */
export function threadRoom(threadId: string): string {
  return `thread:${threadId}`
}

/** 面向指定用户的定向房间名（对齐 chat-realtime `user:` 前缀）。 */
export function userRoom(userId: string): string {
  return `user:${userId}`
}

/** 加入一个房间的服务器绑定载荷。 */
export function buildJoinRoom(room: string): { readonly type: 'join_room'; readonly room: string } {
  return { type: 'join_room', room }
}

/** 离开一个房间的服务器绑定载荷。 */
export function buildLeaveRoom(room: string): { readonly type: 'leave_room'; readonly room: string } {
  return { type: 'leave_room', room }
}

/** 取消一次 invocation 的服务器绑定载荷（对齐 chat-realtime cancel 语义）。 */
export interface CancelInvocationPayload {
  readonly type: 'cancel_invocation'
  readonly threadId: string
  readonly invocationId?: string
  readonly actionId?: string
  readonly clientInstanceId?: string
  readonly reason: string
  readonly origin: string
}

/**
 * 构造取消载荷；actionId/clientInstanceId 在多标签页场景用于去重协调。
 */
export function buildCancelInvocation(input: {
  readonly threadId: string
  readonly invocationId?: string
  readonly actionId?: string
  readonly clientInstanceId?: string
  readonly reason?: string
  readonly origin?: string
}): CancelInvocationPayload {
  return {
    type: 'cancel_invocation',
    threadId: input.threadId,
    ...(input.invocationId !== undefined ? { invocationId: input.invocationId } : {}),
    ...(input.actionId !== undefined ? { actionId: input.actionId } : {}),
    ...(input.clientInstanceId !== undefined
      ? { clientInstanceId: input.clientInstanceId }
      : {}),
    reason: input.reason ?? CANCEL_REASON_USER_CANCEL,
    origin: input.origin ?? CANCEL_ORIGIN_EXPLICIT_STOP,
  }
}