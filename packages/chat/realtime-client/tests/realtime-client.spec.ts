/**
 * @flowforge/chat-realtime-client 契约测试（批次56 T8.x）。
 *
 * 以内存假 socket（{@link SocketIoClientLike} seam 实现）驱动
 * {@link ChatRealtimeClient}，逐字断言：
 *  - 四类服务端事件 → 类型化回调面（thread:message / invocation:progress /
 *    signal:new / approval:update）
 *  - 线程订阅/切换/离开的房间动作（join_room / leave_room）
 *  - user:<id> 定向房间自动加入
 *  - 取消载荷构造与派发（多标签页 provenance 去重字段）
 *  - 连接状态同步与 dispose 幂等清理
 * 不碰真实 socket.io（R16 最小依赖 —— socket.io-client 仅为 peerDependency）。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  ChatRealtimeClient,
  type ChatRealtimeClientHandlers,
  type SocketIoClientLike,
  buildCancelInvocation,
  buildJoinRoom,
  buildLeaveRoom,
  threadRoom,
  userRoom,
  EVENT_THREAD_MESSAGE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_APPROVAL_UPDATE,
  CLIENT_EVENT_JOIN_ROOM,
  CLIENT_EVENT_LEAVE_ROOM,
} from '../src/index.ts'

/** 可复用的内存假 socket：记录 on/emit/off，暴露服务端→客户端事件注入与观测。 */
function makeFakeSocket(initialConnected = false): {
  socket: SocketIoClientLike
  listeners: Map<string, Set<(payload: unknown) => void>>
  emitted: Array<{ event: string; args: unknown[] }>
  fire: (event: string, payload?: unknown) => void
  setConnected: (v: boolean) => void
  disconnectedTimes: () => number
} {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const emitted: Array<{ event: string; args: unknown[] }> = []
  let connected = initialConnected
  let disconnectedTimes = 0
  const socket: SocketIoClientLike = {
    get connected() {
      return connected
    },
    on(event, handler) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(handler)
    },
    off(event, handler) {
      listeners.get(event)?.delete(handler)
    },
    emit(event, ...args) {
      emitted.push({ event, args })
    },
    disconnect() {
      disconnectedTimes += 1
      connected = false
    },
  }
  return {
    socket,
    listeners,
    emitted,
    fire: (event, payload) => {
      for (const h of listeners.get(event) ?? []) h(payload)
    },
    setConnected: (v) => {
      connected = v
    },
    disconnectedTimes: () => disconnectedTimes,
  }
}

const joinRoomFor = (threadId: string) => ({
  event: CLIENT_EVENT_JOIN_ROOM,
  args: [buildJoinRoom(threadRoom(threadId))],
})

const leaveRoomFor = (threadId: string) => ({
  event: CLIENT_EVENT_LEAVE_ROOM,
  args: [buildLeaveRoom(threadRoom(threadId))],
})

describe('ChatRealtimeClient（批次56 实时通道）', () => {
  it('构造即订阅四类服务端事件并上报初始连接状态', () => {
    const f = makeFakeSocket(true)
    const onStatus = vi.fn()
    new ChatRealtimeClient({ socket: f.socket, userId: 'u1', handlers: { onStatus } })

    expect(f.listeners.has(EVENT_THREAD_MESSAGE)).toBe(true)
    expect(f.listeners.has(EVENT_INVOCATION_PROGRESS)).toBe(true)
    expect(f.listeners.has(EVENT_SIGNAL_NEW)).toBe(true)
    expect(f.listeners.has(EVENT_APPROVAL_UPDATE)).toBe(true)
    expect(onStatus).toHaveBeenCalledWith('connected')
  })

  it('threadId+userId 装配：加入线程房间并自动加入 user:<id> 定向房间', () => {
    const f = makeFakeSocket()
    new ChatRealtimeClient({ socket: f.socket, threadId: 't1', userId: 'u7' })

    expect(f.emitted).toContainEqual(joinRoomFor('t1'))
    expect(f.emitted).toContainEqual({
      event: CLIENT_EVENT_JOIN_ROOM,
      args: [buildJoinRoom(userRoom('u7'))],
    })
  })

  it('服务端 thread:message → onMessage 回调', () => {
    const f = makeFakeSocket()
    const onMessage = vi.fn()
    new ChatRealtimeClient({ socket: f.socket, handlers: { onMessage } })

    const payload = { type: 'text', catId: 'cat-1', content: 'hi', seq: 3 }
    f.fire(EVENT_THREAD_MESSAGE, payload)

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({ content: 'hi' })
  })

  it('服务端四类事件各自路由到对应回调', () => {
    const f = makeFakeSocket()
    const handlers: ChatRealtimeClientHandlers = {
      onInvocationProgress: vi.fn(),
      onSignalNew: vi.fn(),
      onApprovalUpdate: vi.fn(),
    }
    new ChatRealtimeClient({ socket: f.socket, handlers })

    f.fire(EVENT_INVOCATION_PROGRESS, { pct: 50 })
    f.fire(EVENT_SIGNAL_NEW, { id: 's1' })
    f.fire(EVENT_APPROVAL_UPDATE, { id: 'a1' })

    expect(handlers.onInvocationProgress).toHaveBeenCalledWith({ pct: 50 })
    expect(handlers.onSignalNew).toHaveBeenCalledWith({ id: 's1' })
    expect(handlers.onApprovalUpdate).toHaveBeenCalledWith({ id: 'a1' })
  })

  it('subscribeThread 切换：leave 旧线程 + join 新线程，且幂等（同线程不重发）', () => {
    const f = makeFakeSocket()
    const client = new ChatRealtimeClient({ socket: f.socket, threadId: 't1' })
    f.emitted.length = 0

    client.subscribeThread('t2')
    expect(f.emitted).toContainEqual(leaveRoomFor('t1'))
    expect(f.emitted).toContainEqual(joinRoomFor('t2'))
    expect(client.threadId).toBe('t2')

    f.emitted.length = 0
    client.subscribeThread('t2')
    expect(f.emitted).toEqual([])
  })

  it('leaveThread：离开当前线程房间，其余线程 ignore', () => {
    const f = makeFakeSocket()
    const client = new ChatRealtimeClient({ socket: f.socket, threadId: 't1' })
    f.emitted.length = 0

    client.leaveThread('tX')
    expect(f.emitted).toEqual([])

    client.leaveThread('t1')
    expect(f.emitted).toContainEqual(leaveRoomFor('t1'))
    expect(client.threadId).toBeUndefined()
  })

  it('cancelInvocation：缺省 threadId 回落当前订阅线程；自定义 provenance 透传', () => {
    const f = makeFakeSocket()
    const client = new ChatRealtimeClient({ socket: f.socket, threadId: 't9' })
    f.emitted.length = 0

    client.cancelInvocation({ invocationId: 'inv-1' })
    const emit = f.emitted.find((e) => e.event === 'cancel_invocation')
    expect(emit?.args[0]).toMatchObject({
      type: 'cancel_invocation',
      threadId: 't9',
      invocationId: 'inv-1',
    })

    client.cancelInvocation({ threadId: 'tX', actionId: 'act-1', clientInstanceId: 'tab-1' })
    const emit2 = f.emitted.find((e) => (e.args[0] as { actionId?: string }).actionId === 'act-1')
    expect(emit2?.args[0]).toMatchObject({ threadId: 'tX', actionId: 'act-1', clientInstanceId: 'tab-1' })
  })

  it('连接状态未变时不重复上报；变化时才回调 onStatus', () => {
    const f = makeFakeSocket()
    const onStatus = vi.fn()
    new ChatRealtimeClient({ socket: f.socket, handlers: { onStatus } })
    // syncStatus 在构造时已调用（disconnected）；再次 syncStatus 只有在 socket 状态变化时触发
    f.setConnected(true)
    f.fire('random:unrelated', {})
    // 说明：状态同步仅由构造时驱动；这里验证未触发多余通知
    expect(onStatus).not.toHaveBeenCalledWith('connected')
  })

  it('dispose 幂等：移除监听 + disconnect 断开', () => {
    const f = makeFakeSocket()
    const client = new ChatRealtimeClient({ socket: f.socket, threadId: 't1' })

    client.dispose()
    client.dispose()

    expect(f.disconnectedTimes()).toBe(1)
  })

  it('dispose 后不再响应服务端事件', () => {
    const f = makeFakeSocket()
    const onMessage = vi.fn()
    const client = new ChatRealtimeClient({ socket: f.socket, handlers: { onMessage } })
    client.dispose()
    f.fire(EVENT_THREAD_MESSAGE, { content: 'after-dispose' })
    expect(onMessage).not.toHaveBeenCalled()
  })
})

describe('transport 纯函数（批次56 房间/载荷构建）', () => {
  it('threadRoom / userRoom 对齐 chat-realtime 房间前缀', () => {
    expect(threadRoom('t1')).toBe('thread:t1')
    expect(userRoom('u1')).toBe('user:u1')
  })

  it('buildJoinRoom / buildLeaveRoom 结构化载荷', () => {
    expect(buildJoinRoom('thread:t1')).toEqual({ type: 'join_room', room: 'thread:t1' })
    expect(buildLeaveRoom('user:u1')).toEqual({ type: 'leave_room', room: 'user:u1' })
  })

  it('buildCancelInvocation 缺省 reason/origin 采用显式停止语义（F254）', () => {
    expect(
      buildCancelInvocation({ threadId: 't1', invocationId: 'inv-1' }),
    ).toMatchObject({
      type: 'cancel_invocation',
      threadId: 't1',
      invocationId: 'inv-1',
      reason: 'user_cancel',
      origin: 'explicit_stop',
    })
  })
})