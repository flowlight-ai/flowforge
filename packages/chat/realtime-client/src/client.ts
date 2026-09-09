/**
 * @flowforge/chat-realtime-client — 浏览器侧实时通道客户端。
 *
 * 对齐 `@flowforge/chat-realtime` 事件词表：消费服务端四类投递
 * （thread:message / invocation:progress / signal:new / approval:update），
 * 并发出服务器绑定动作（join_room/leave_room/cancel_invocation）。
 *
 * 可测试性：socket 一律经 {@link SocketIoClientLike} seam 注入 —— 契约测试以
 * 内存假 socket 驱动 {@link ChatRealtimeClient}，不碰真实 socket.io。真实浏览
 * 器连接由组合根用 `io(url, opts)` 得到的 socket 注入 { link }
 * 本模块不直接 import `socket.io-client`。
 *
 * @module @flowforge/chat-realtime-client
 */

import type {
  ApprovalUpdatePayload,
  BroadcastAgentMessage,
  InvocationProgressPayload,
  SignalNewPayload,
} from '@flowforge/chat-realtime'
import { EVENT_THREAD_MESSAGE, EVENT_INVOCATION_PROGRESS, EVENT_SIGNAL_NEW, EVENT_APPROVAL_UPDATE } from '@flowforge/chat-realtime'
import {
  buildJoinRoom,
  buildLeaveRoom,
  buildCancelInvocation,
  threadRoom,
  userRoom,
  CLIENT_EVENT_JOIN_ROOM,
  CLIENT_EVENT_LEAVE_ROOM,
  type CancelInvocationPayload,
  type SocketIoClientLike,
} from './transport.ts'

/** 连接状态（客户端本地视角）。 */
export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/** 客户端回调面 —— ChatRealtimeClient 对宿主页面的全部可见对账事件。 */
export interface ChatRealtimeClientHandlers {
  onMessage?: (payload: BroadcastAgentMessage) => void
  onInvocationProgress?: (payload: InvocationProgressPayload) => void
  onSignalNew?: (payload: SignalNewPayload) => void
  onApprovalUpdate?: (payload: ApprovalUpdatePayload) => void
  onStatus?: (status: RealtimeStatus) => void
  onError?: (payload: unknown) => void
}

/** ChatRealtimeClient 构造选项。 */
export interface ChatRealtimeClientOptions {
  /** 注入的 socket seam（生产由 `io(url, opts)` 得到；测试传内存假实现）。 */
  readonly socket: SocketIoClientLike
  /** 首屏加入的线程房间（可再经 subscribeThread/leaveThread 变更）。 */
  readonly threadId?: string
  /** 身份已知时自动加入 `user:<id>` 定向房间（接收 signal/approval）。 */
  readonly userId?: string
  /** 回调面。 */
  readonly handlers?: ChatRealtimeClientHandlers
}

/**
 * 浏览器实时通道客户端 —— 把 socket.io 原始事件收敛为类型化回调面。
 *
 * 生命周期：构造后连接即生效（socket 由调用方已连接或 autoConnect）；宿主
 * 导航离开/登出时调用 {@link dispose} 清理监听并断开。线程切换经
 * {@link subscribeThread} 发出 leave_room 旧线程 + join_room 新线程。
 */
export class ChatRealtimeClient {
  private readonly socket: SocketIoClientLike
  private readonly userId?: string | undefined
  private readonly handlers: Required<ChatRealtimeClientHandlers>
  private subscribedThread?: string | undefined
  private status: RealtimeStatus = 'idle'
  private disposed = false
  private readonly unsubscribes: Array<() => void>

  constructor(options: ChatRealtimeClientOptions) {
    this.socket = options.socket
    this.userId = options.userId
    this.handlers = {
      onMessage: options.handlers?.onMessage ?? (() => {}),
      onInvocationProgress: options.handlers?.onInvocationProgress ?? (() => {}),
      onSignalNew: options.handlers?.onSignalNew ?? (() => {}),
      onApprovalUpdate: options.handlers?.onApprovalUpdate ?? (() => {}),
      onStatus: options.handlers?.onStatus ?? (() => {}),
      onError: options.handlers?.onError ?? (() => {}),
    }
    this.socket.on(EVENT_THREAD_MESSAGE, this.onThreadMessage)
    this.socket.on(EVENT_INVOCATION_PROGRESS, this.onInvocationProgress)
    this.socket.on(EVENT_SIGNAL_NEW, this.onSignalNew)
    this.socket.on(EVENT_APPROVAL_UPDATE, this.onApprovalUpdate)
    this.unsubscribes = [
      () => this.socket.off(EVENT_THREAD_MESSAGE, this.onThreadMessage),
      () => this.socket.off(EVENT_INVOCATION_PROGRESS, this.onInvocationProgress),
      () => this.socket.off(EVENT_SIGNAL_NEW, this.onSignalNew),
      () => this.socket.off(EVENT_APPROVAL_UPDATE, this.onApprovalUpdate),
    ]
    this.syncStatus()
    if (options.threadId) this.subscribeThread(options.threadId)
    if (this.userId) this.sendJoinRoom(userRoom(this.userId))
  }

  private readonly onThreadMessage = (payload: unknown): void => {
    this.handlers.onMessage(payload as BroadcastAgentMessage)
  }
  private readonly onInvocationProgress = (payload: unknown): void => {
    this.handlers.onInvocationProgress(payload as InvocationProgressPayload)
  }
  private readonly onSignalNew = (payload: unknown): void => {
    this.handlers.onSignalNew(payload as SignalNewPayload)
  }
  private readonly onApprovalUpdate = (payload: unknown): void => {
    this.handlers.onApprovalUpdate(payload as ApprovalUpdatePayload)
  }

  private syncStatus(): void {
    const next = this.socket.connected ? 'connected' : 'disconnected'
    if (next !== this.status) {
      this.status = next
      this.handlers.onStatus(next)
    }
  }

  /** 当前线程房间（本客户端正订阅的 `thread:<id>`；undefined = 未订阅）。 */
  get threadId(): string | undefined {
    return this.subscribedThread
  }

  /** 当前客户端本地连接状态。 */
  get statusValue(): RealtimeStatus {
    return this.status
  }

  /** 加入线程房间并离开上一个线程房间（若有）。 */
  subscribeThread(threadId: string): void {
    const prev = this.subscribedThread
    if (prev !== undefined && prev !== threadId) {
      this.socket.emit(CLIENT_EVENT_LEAVE_ROOM, buildLeaveRoom(threadRoom(prev)))
    }
    if (threadId !== prev) {
      this.subscribedThread = threadId
      this.sendJoinRoom(threadRoom(threadId))
    }
  }

  /** 离开线程房间（切到会话列表/未选中线程时）。 */
  leaveThread(threadId: string): void {
    if (this.subscribedThread !== threadId) return
    this.subscribedThread = undefined
    this.socket.emit(CLIENT_EVENT_LEAVE_ROOM, buildLeaveRoom(threadRoom(threadId)))
  }

  /** 面向服务端的原始动作透传（如 cancel_invocation 等后续契约）。 */
  emit(event: string, ...args: unknown[]): void {
    this.socket.emit(event, ...args)
  }

  /** 便捷：取消当前线程内一次 invocation。 */
  cancelInvocation(input: {
    readonly threadId?: string
    readonly invocationId?: string
    readonly actionId?: string
    readonly clientInstanceId?: string
  }): void {
    const payload: CancelInvocationPayload = buildCancelInvocation({
      threadId: input.threadId ?? this.subscribedThread ?? '',
      ...(input.invocationId !== undefined ? { invocationId: input.invocationId } : {}),
      ...(input.actionId !== undefined ? { actionId: input.actionId } : {}),
      ...(input.clientInstanceId !== undefined
        ? { clientInstanceId: input.clientInstanceId }
        : {}),
    })
    this.socket.emit('cancel_invocation', payload)
  }

  private sendJoinRoom(room: string): void {
    this.socket.emit(CLIENT_EVENT_JOIN_ROOM, buildJoinRoom(room))
  }

  /** 清理全部监听并断开连接。幂等。 */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const unsub of this.unsubscribes) unsub()
    this.socket.disconnect()
  }
}