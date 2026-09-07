/**
 * SocketIoRealtimeTransport — socket.io 服务端适配器（批次56 T8.2）。
 *
 * 将 socket.io Server（HTTP upgrade 挂载于宿主 webserver）适配为
 * {@link RealtimeTransport} 契约，供 RealtimeService 消费——浏览器端经
 * socket.io-client 连接同一命名空间，事件名对齐 chat-realtime 常量
 * （thread:message / invocation:progress / signal:new / approval:update）。
 *
 * 解耦设计：不直接 import `socket.io` 类型（宿主组合根负责传入实例），
 * 以结构化最小面 `SocketIoServerLike` / `SocketIoServerSocketLike` 描述依赖，
 * 避免 chat-realtime 引入 socket.io 运行时依赖（R16 最小依赖策略）。
 *
 * 语义对齐 InMemoryRealtimeTransport：
 *   - 连接时自动加入 `user:<userId>` 房间（userId 由客户端握手 auth 提供或
 *     注入的 resolveUserId 决定；单用户模式恒为 default-user）
 *   - emitToRoomWithAck：socket.io 原生 ack + 超时收集部分应答（best-effort）
 *
 * @module @flowforge/chat-realtime/socket-io-transport
 */

import type { UserId } from '@flowforge/cats-shared'
import type {
  RealtimeServerSocket,
  RealtimeTransport,
} from './transport.ts'

/** socket.io 客户端 socket 的结构化最小面（对齐 socket.io Server socket）。 */
export interface SocketIoServerSocketLike {
  readonly id: string
  readonly data: Record<string, unknown>
  join(room: string): this | void
  leave(room: string): this | void
  emit(event: string, payload: unknown): boolean | void
  timeout(milliseconds: number): {
    emit(event: string, payload: unknown, callback: (err: unknown, responses: unknown[]) => void): void
  }
  on(event: string, handler: (...args: never[]) => void): this | void
  onAnyOutgoing(listener: (event: string, ...args: unknown[]) => void): this | void
  disconnect(close?: boolean): this | void
}

/** socket.io Server 的结构化最小面（`io.of(namespace)` 语义）。 */
export interface SocketIoServerLike {
  on(
    event: 'connection',
    handler: (socket: SocketIoServerSocketLike) => void,
  ): this | void
  to(rooms: string | string[]): {
    emit(event: string, payload: unknown): boolean | void
    timeout(milliseconds: number): {
      emit(event: string, payload: unknown, callback: (err: unknown, responses: unknown[]) => void): void
    }
  }
  in(rooms: string | string[]): {
    emit(event: string, payload: unknown): boolean | void
    timeout(milliseconds: number): {
      emit(event: string, payload: unknown, callback: (err: unknown, responses: unknown[]) => void): void
    }
  }
  fetchSockets(): Promise<Array<{ id: string; data: Record<string, unknown> }>>
  disconnectSockets(close?: boolean): void
}

export interface SocketIoRealtimeTransportOptions {
  /** 连接身份解析（缺省单用户模式：恒为 default-user，F156/F077）。 */
  readonly resolveUserId?: ((socket: SocketIoServerSocketLike) => UserId) | undefined
}

const DEFAULT_USER_ID = 'default-user' as UserId

class SocketIoServerSocketAdapter implements RealtimeServerSocket {
  readonly rooms = new Set<string>()

  constructor(
    readonly raw: SocketIoServerSocketLike,
    readonly userId: UserId,
  ) {
    this.rooms.add(`user:${userId}`)
    raw.join(`user:${userId}`)
  }

  get id(): string {
    return this.raw.id
  }

  join(room: string): void {
    this.rooms.add(room)
    this.raw.join(room)
  }

  leave(room: string): void {
    this.rooms.delete(room)
    this.raw.leave(room)
  }

  emit(event: string, payload: unknown): void {
    this.raw.emit(event, payload)
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.raw.on(event, handler as never)
  }
}

export class SocketIoRealtimeTransport implements RealtimeTransport {
  private readonly connectionHandlers: Array<(socket: RealtimeServerSocket) => void> = []
  private readonly sockets = new Map<string, SocketIoServerSocketAdapter>()
  private closed = false

  constructor(
    private readonly server: SocketIoServerLike,
    options: SocketIoRealtimeTransportOptions = {},
  ) {
    const resolveUserId =
      options.resolveUserId ??
      ((socket: SocketIoServerSocketLike): UserId => {
        const authUserId = socket.data['userId']
        return (typeof authUserId === 'string' && authUserId !== '' ? authUserId : DEFAULT_USER_ID) as UserId
      })

    this.server.on('connection', (raw) => {
      if (this.closed) return
      const adapter = new SocketIoServerSocketAdapter(raw, resolveUserId(raw))
      this.sockets.set(raw.id, adapter)
      for (const handler of this.connectionHandlers) {
        handler(adapter)
      }
    })
  }

  onConnection(handler: (socket: RealtimeServerSocket) => void): void {
    this.connectionHandlers.push(handler)
  }

  emitToRoom(room: string, event: string, payload: unknown): void {
    this.server.to(room).emit(event, payload)
  }

  emitToRoomWithAck(room: string, event: string, payload: unknown, timeoutMs = 1500): Promise<unknown[]> {
    return new Promise((resolve) => {
      // best-effort：超时收集部分应答，不抛错（对齐 InMemory 语义）
      const timer = setTimeout(() => resolve([]), timeoutMs)
      this.server
        .to(room)
        .timeout(timeoutMs)
        .emit(event, payload, (err: unknown, responses: unknown[]) => {
          clearTimeout(timer)
          resolve(err !== undefined && err !== null ? [] : (responses ?? []))
        })
    })
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload)
  }

  close(): void {
    this.closed = true
    this.sockets.clear()
    this.server.disconnectSockets()
  }
}
