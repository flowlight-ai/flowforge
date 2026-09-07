/**
 * SocketIoRealtimeTransport 测试（批次56 T8.2）：结构化 socket.io 桩验证
 * 连接注册/user 房间自动加入/emitToRoom/emitToRoomWithAck 超时语义/emitToUser/close。
 * 与 RealtimeService 的对接语义沿用 InMemory 测试矩阵的子集。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId } from '@flowforge/cats-shared'
import { ChatRealtimeService } from '../src/index.ts'
import {
  SocketIoRealtimeTransport,
  type SocketIoServerLike,
  type SocketIoServerSocketLike,
} from '../src/socket-io-transport.ts'

/** 最小 socket.io 服务端桩：记录 connection 回调，暴露手动触发挂接的 socket。
 * ackResult 控制 to().timeout().emit() 回调行为（模拟 ack 收集/超时错误路径）。 */
function makeStubServer(ackResult: { err?: unknown; responses?: unknown[] } = { responses: [] }): {
  server: SocketIoServerLike
  emitServerSocket: (socket: SocketIoServerSocketLike) => void
  toCalls: Array<{ rooms: string | string[]; event: string; payload: unknown }>
} {
  const toCalls: Array<{ rooms: string | string[]; event: string; payload: unknown }> = []
  let connectionHandler: ((socket: SocketIoServerSocketLike) => void) | null = null
  const server: SocketIoServerLike = {
    on(event, handler) {
      if (event === 'connection') connectionHandler = handler
      return server
    },
    to(rooms) {
      return {
        emit: (event, payload) => {
          toCalls.push({ rooms, event, payload })
        },
        timeout: () => ({
          emit: (_event, _payload, callback) => {
            callback(ackResult.err, ackResult.responses ?? [])
          },
        }),
      }
    },
    in(rooms) {
      return server.to(rooms)
    },
    fetchSockets: async () => [],
    disconnectSockets: () => {},
  }
  return {
    server,
    emitServerSocket: (socket) => {
      if (connectionHandler === null) throw new Error('connection handler not registered')
      connectionHandler(socket)
    },
    toCalls,
  }
}

function makeStubSocket(id: string, data: Record<string, unknown> = {}): SocketIoServerSocketLike {
  const outgoing: Array<{ event: string; payload: unknown }> = []
  return {
    id,
    data,
    join: () => {},
    leave: () => {},
    emit: (event, payload) => {
      outgoing.push({ event, payload })
    },
    timeout: () => ({
      emit: (_event, _payload, callback) => {
        callback(undefined, ['ack-payload'])
      },
    }),
    on: () => {},
    onAnyOutgoing: () => {},
    disconnect: () => {},
  }
}

describe('SocketIoRealtimeTransport（批次56 T8.2）', () => {
  it('connection → 包装 RealtimeServerSocket 并自动加入 user:<userId> 房间', () => {
    const { server, emitServerSocket } = makeStubServer()
    const transport = new SocketIoRealtimeTransport(server)
    const onConnection = vi.fn()
    transport.onConnection(onConnection)

    const raw = makeStubSocket('sock-1', { userId: 'user-9' })
    emitServerSocket(raw)

    expect(onConnection).toHaveBeenCalledTimes(1)
    const wrapped = onConnection.mock.calls[0]?.[0] as { id: string; userId: string; rooms: Set<string> }
    expect(wrapped.id).toBe('sock-1')
    expect(wrapped.userId).toBe('user-9')
    expect(wrapped.rooms.has('user:user-9')).toBe(true)
  })

  it('单用户模式缺省：无 auth userId → default-user（F156/F077）', () => {
    const { server, emitServerSocket } = makeStubServer()
    const transport = new SocketIoRealtimeTransport(server)
    const onConnection = vi.fn()
    transport.onConnection(onConnection)
    emitServerSocket(makeStubSocket('sock-2'))
    expect(onConnection.mock.calls[0]?.[0]?.userId).toBe('default-user')
  })

  it('resolveUserId 注入：握手 auth 缺失时按注入策略判定身份', () => {
    const { server, emitServerSocket } = makeStubServer()
    const transport = new SocketIoRealtimeTransport(server, {
      resolveUserId: (socket) => `session-${socket.id}` as never,
    })
    const onConnection = vi.fn()
    transport.onConnection(onConnection)
    emitServerSocket(makeStubSocket('sock-2b'))
    expect(onConnection.mock.calls[0]?.[0]?.userId).toBe('session-sock-2b')
  })

  it('emitToRoom / emitToUser 走 socket.io to() 语义', () => {
    const { server, emitServerSocket, toCalls } = makeStubServer()
    const transport = new SocketIoRealtimeTransport(server)
    emitServerSocket(makeStubSocket('sock-3', { userId: 'u1' }))

    transport.emitToRoom('thread:t1', 'thread:message', { text: 'hi' })
    transport.emitToUser('u1', 'invocation:progress', { pct: 50 })

    expect(toCalls.some((c) => c.rooms === 'thread:t1' && c.event === 'thread:message')).toBe(true)
    expect(toCalls.some((c) => c.rooms === 'user:u1' && c.event === 'invocation:progress')).toBe(true)
  })

  it('emitToRoomWithAck：ack 应答收集；超时 best-effort 解析空数组', async () => {
    const { server } = makeStubServer({ responses: ['ack-payload'] })
    const transport = new SocketIoRealtimeTransport(server)
    // 桩的 timeout().emit() 回调返回 ['ack-payload']
    const acked = await transport.emitToRoomWithAck('room-1', 'gather', {}, 100)
    expect(acked).toEqual(['ack-payload'])

    const errServer = makeStubServer({ err: new Error('timeout') })
    const errTransport = new SocketIoRealtimeTransport(errServer.server)
    const failed = await errTransport.emitToRoomWithAck('room-2', 'gather', {}, 5)
    expect(failed).toEqual([])
  })

  it('close：断开全部连接并拒绝后续连接', () => {
    const { server, emitServerSocket } = makeStubServer()
    const transport = new SocketIoRealtimeTransport(server)
    transport.close()
    const onConnection = vi.fn()
    transport.onConnection(onConnection)
    emitServerSocket(makeStubSocket('sock-5'))
    expect(onConnection).not.toHaveBeenCalled()
  })

  it('对接 ChatRealtimeService：SocketIo 传输替换 InMemory 装配（ctx.chatRealtime）', () => {
    const { server, toCalls } = makeStubServer()
    const transport = new SocketIoRealtimeTransport(server)
    const ctx = new Context()
    const svc = new ChatRealtimeService(ctx, { transport })

    // 经服务广播 → seq 注入（F183）+ socket.io to() 收到 thread:message
    svc.broadcastAgentMessage(
      { type: 'text', catId: createCatId('cat-1'), content: 'hello', timestamp: Date.now() },
      't1',
    )
    const call = toCalls.find((c) => c.event === 'thread:message')
    expect(call?.rooms).toBe('thread:t1')
    expect((call?.payload as { content?: string }).content).toBe('hello')
    expect((call?.payload as { seq?: number }).seq).toBe(1)
  })
})
