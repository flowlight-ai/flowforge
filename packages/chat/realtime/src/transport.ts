/**
 * RealtimeTransport — 实时传输缝（替代 clowder-ai 对 socket.io Server 的直接依赖）。
 *
 * R13 一切皆插件：`@flowforge/chat-realtime` 不直接 import socket.io ——
 * 业务语义（房间 ACL / seq / 限速 / cancel 编排 / 事件词汇）全部住在
 * `ChatRealtimeService`，传输后端经本接口注入：
 * - `InMemoryRealtimeTransport`：进程内实现（默认 + 测试 mock io，双客户端收发）
 * - socket.io 适配器：组合根（typert WS 域）后续提供 —— clowder-ai 的
 *   CORS/allowRequest（F156 WebSocket 升级守卫，CVE-2026-25253）与 session
 *   身份派生（F077）属于传输适配层职责，不在本服务。
 *
 * 身份约束（F156）：userId 一律由传输层在连接时服务端判定（session/cookie），
 * 绝不信任客户端自报 —— `RealtimeServerSocket.userId` 即服务端判定结果。
 *
 * @module @flowforge/chat-realtime/transport
 */

import { randomUUID } from 'node:crypto'
import type { UserId } from '@flowforge/cats-shared'
import { ACK_BROADCAST_TIMEOUT_MS, USER_ROOM_PREFIX } from './invariant.ts'

/**
 * 服务端视角的已连接 socket —— ChatRealtimeService 对一条连接的全部可见面。
 */
export interface RealtimeServerSocket {
  /** 传输层连接标识（socket.io socket.id 语义）。 */
  readonly id: string
  /** 服务端判定的连接身份（F156/F077 —— 单用户模式恒为 default-user）。 */
  readonly userId: UserId
  /** 当前所属房间（含自动加入的 `user:<userId>`）。 */
  readonly rooms: ReadonlySet<string>
  join(room: string): void
  leave(room: string): void
  /** 服务端 → 客户端定向投递。 */
  emit(event: string, payload: unknown): void
  /** 客户端 → 服务端事件注册（join_room/leave_room/cancel_invocation）。 */
  on(event: string, handler: (payload: unknown) => void): void
}

/** 实时传输后端契约（socket.io Server 的业务子集）。 */
export interface RealtimeTransport {
  /** 连接建立回调注册（服务在构造时注册 handleConnection）。 */
  onConnection(handler: (socket: RealtimeServerSocket) => void): void
  /** 向房间内全部连接广播。 */
  emitToRoom(room: string, event: string, payload: unknown): void
  /**
   * 向房间广播并收集 ack 应答；超时（默认 1500ms）解析为已收到的部分应答
   * （clowder-ai broadcastToRoomWithAck 语义 —— best-effort，不抛错）。
   */
  emitToRoomWithAck(
    room: string,
    event: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<unknown[]>
  /** 定向某用户的全部连接（多标签页安全，F39）。 */
  emitToUser(userId: string, event: string, payload: unknown): void
  /** 关闭全部连接（优雅停机）。 */
  close(): void
}

/** 进程内传输的客户端视图（测试 mock io / 进程内默认后端）。 */
export interface InMemoryRealtimeClient {
  /** 服务端 socket 视图（房间操作/定向 emit）。 */
  readonly socket: RealtimeServerSocket
  /** 模拟客户端 → 服务端事件（如 send('join_room', 'thread:t1')）。 */
  send(event: string, payload?: unknown): void
  /** 服务端 → 客户端已投递事件（断言双客户端收发）。 */
  readonly received: readonly { event: string; payload: unknown }[]
  /** 注册 ack 应答器（broadcastToRoomWithAck 收集其返回值）。 */
  onAck(respond: (event: string, payload: unknown) => unknown): void
  /** 断开连接。 */
  disconnect(): void
}

/** 进程内 RealtimeTransport 实现。 */
class InMemoryServerSocket implements RealtimeServerSocket {
  readonly id: string
  readonly userId: UserId
  readonly rooms = new Set<string>()
  private readonly handlers = new Map<string, Array<(payload: unknown) => void>>()
  private readonly client: { received: { event: string; payload: unknown }[] }

  constructor(
    userId: UserId,
    client: { received: { event: string; payload: unknown }[] },
  ) {
    this.id = `sock-${randomUUID().slice(0, 8)}`
    this.userId = userId
    this.client = client
  }

  join(room: string): void {
    this.rooms.add(room)
  }

  leave(room: string): void {
    this.rooms.delete(room)
  }

  emit(event: string, payload: unknown): void {
    this.client.received.push({ event, payload })
  }

  on(event: string, handler: (payload: unknown) => void): void {
    let list = this.handlers.get(event)
    if (!list) {
      list = []
      this.handlers.set(event, list)
    }
    list.push(handler)
  }

  /** 客户端 → 服务端事件分发（测试模拟 socket.emit）。 */
  receive(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload)
    }
  }
}

/**
 * 进程内实时传输 —— 默认传输后端 + 测试 mock io。
 *
 * 房间模型与 socket.io 一致：socket.join(room) 加入房间，emitToRoom 向
 * 房间内全部 socket 的客户端视图投递；`user:<userId>` 房间由服务在
 * handleConnection 自动加入（本传输只提供机制，不内置业务策略）。
 */
export class InMemoryRealtimeTransport implements RealtimeTransport {
  private readonly connectionHandlers: Array<(socket: RealtimeServerSocket) => void> = []
  private readonly sockets = new Set<InMemoryServerSocket>()
  private readonly clients = new Map<
    InMemoryServerSocket,
    { ackResponder?: (event: string, payload: unknown) => unknown }
  >()
  private closed = false

  onConnection(handler: (socket: RealtimeServerSocket) => void): void {
    this.connectionHandlers.push(handler)
  }

  /**
   * 建立一条连接（测试/组合根模拟客户端接入）。返回客户端视图；
   * 服务端视图经 connection 回调交给 ChatRealtimeService。
   */
  connect(userId: UserId): InMemoryRealtimeClient {
    if (this.closed) throw new Error('InMemoryRealtimeTransport is closed')
    const received: { event: string; payload: unknown }[] = []
    const socket = new InMemoryServerSocket(userId, { received })
    const record: {
      socket: InMemoryServerSocket
      ackResponder?: (event: string, payload: unknown) => unknown
    } = { socket }
    const client: InMemoryRealtimeClient = {
      socket,
      send: (event, payload) => socket.receive(event, payload),
      received,
      onAck: (respond) => {
        record.ackResponder = respond
      },
      disconnect: () => {
        this.sockets.delete(socket)
        this.clients.delete(socket)
      },
    }
    this.sockets.add(socket)
    this.clients.set(socket, record)
    for (const handler of this.connectionHandlers) handler(socket)
    return client
  }

  emitToRoom(room: string, event: string, payload: unknown): void {
    if (this.closed) return
    for (const socket of this.sockets) {
      if (socket.rooms.has(room)) socket.emit(event, payload)
    }
  }

  emitToRoomWithAck(
    room: string,
    event: string,
    payload: unknown,
    timeoutMs = ACK_BROADCAST_TIMEOUT_MS,
  ): Promise<unknown[]> {
    void timeoutMs // 进程内无真实等待 —— 同步收集，语义与超时收敛 [] 一致
    if (this.closed) return Promise.resolve([])
    const responses: unknown[] = []
    for (const [socket, record] of this.clients) {
      if (!socket.rooms.has(room)) continue
      socket.emit(event, payload)
      // clowder-ai 语义：ack 应答缺失的客户端不阻塞广播结果
      if (record.ackResponder) {
        const response = record.ackResponder(event, payload)
        if (response !== undefined) responses.push(response)
      }
    }
    return Promise.resolve(responses)
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.emitToRoom(`${USER_ROOM_PREFIX}${userId}`, event, payload)
  }

  close(): void {
    this.closed = true
    this.sockets.clear()
    this.clients.clear()
  }

  /** 当前活跃连接数（诊断/测试）。 */
  get connectionCount(): number {
    return this.sockets.size
  }
}
