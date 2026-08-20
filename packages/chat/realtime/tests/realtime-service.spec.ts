/**
 * ChatRealtimeService 契约测试（阶段5 批次3，T5.11）：
 * - 连接/房间：user 房间自动加入（F39 多标签页）；join_room 白名单 +
 *   F156 user 房间 ACL；leave_room
 * - 广播面：thread:message seq/seqEpoch 注入（F183）+ 单调性 + override
 *   bumpTo；双客户端房间收发 + 非成员隔离；default 大厅；限速 choke point；
 *   broadcastToRoomWithAck ack 收集
 * - 事件词汇：invocation:progress（thread 房间）/ signal:new /
 *   approval:update（user 定向）
 * - cancel_invocation：F254 溯源拒绝路径（无 tracker/缺 threadId/无溯源/
 *   重复 action/未入房间）；F108 槽级取消（F-parallel-cancel 作用域广播 +
 *   兄弟槽保留）；cancel-all（逐 cat done + suppressAutoResume 精确
 *   executionId + 逐 cat abortBySlot）；他用户槽不误取消；会话锁强制释放
 *   + 锁恢复独立终态广播
 * - buildCancelMessages 纯函数
 *
 * @module @flowforge/chat-realtime/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import {
  MemoryInvocationTrackerService,
  MemorySessionMutexService,
} from '@flowforge/cats-invocation'
import { createCatId, createThreadId, createUserId } from '@flowforge/cats-shared'
import {
  buildCancelMessages,
  CancelRejectReason,
  ChatRealtimeService,
  EVENT_APPROVAL_UPDATE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_THREAD_MESSAGE,
  InMemoryRealtimeTransport,
} from '../src/index.ts'
import type {
  AgentMessage,
  BroadcastAgentMessage,
  CancelInvocationOutcome,
  CancelSlotCleanup,
  MentionAbort,
} from '../src/index.ts'
import type { InMemoryRealtimeClient } from '../src/index.ts'
import type { MemorySessionMutexService as Mutex } from '@flowforge/cats-invocation'
import type { MemoryInvocationTrackerService as Tracker } from '@flowforge/cats-invocation'

const ALICE = createUserId('alice')
const BOB = createUserId('bob')
const T1 = createThreadId('t1')
const CAT_A = createCatId('cat_a')
const CAT_B = createCatId('cat_b')

interface Harness {
  ctx: Context
  svc: ChatRealtimeService
  transport: InMemoryRealtimeTransport
  tracker?: Tracker | undefined
  mutex?: Mutex | undefined
}

function harness(opts: { withoutInvocation?: boolean } = {}): Harness {
  const ctx = new Context()
  const tracker = opts.withoutInvocation ? undefined : new MemoryInvocationTrackerService(ctx)
  const mutex = opts.withoutInvocation ? undefined : new MemorySessionMutexService(ctx)
  const transport = new InMemoryRealtimeTransport()
  const svc = new ChatRealtimeService(ctx, { transport })
  return { ctx, svc, transport, tracker, mutex }
}

function agentMessage(catId: string, content = 'hi'): AgentMessage {
  return { type: 'text', catId: createCatId(catId), content, timestamp: Date.now() }
}

function joinThreadRoom(client: InMemoryRealtimeClient, threadId: string): void {
  client.send('join_room', `thread:${threadId}`)
}

function threadMessages(client: InMemoryRealtimeClient): BroadcastAgentMessage[] {
  return client.received
    .filter((e) => e.event === EVENT_THREAD_MESSAGE)
    .map((e) => e.payload as BroadcastAgentMessage)
}

function events(client: InMemoryRealtimeClient, event: string): unknown[] {
  return client.received.filter((e) => e.event === event).map((e) => e.payload)
}

let actionSeq = 0
function cancelPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  actionSeq += 1
  return {
    threadId: 't1',
    origin: 'explicit_stop',
    actionId: `action-${actionSeq}`,
    clientInstanceId: 'client-instance-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Connection & room management
// ---------------------------------------------------------------------------

describe('ChatRealtimeService — connection & rooms', () => {
  it('auto-joins the user room on connect (F39 multi-tab emitToUser)', () => {
    const h = harness()
    const alice = h.transport.connect(ALICE)
    h.svc.emitToUser('alice', 'custom', { hello: 1 })
    expect(alice.received).toHaveLength(1)
    expect(alice.received[0]).toMatchObject({ event: 'custom', payload: { hello: 1 } })
  })

  it('rejects join_room with an invalid room prefix', () => {
    const h = harness()
    const alice = h.transport.connect(ALICE)
    expect(h.svc.handleJoinRoom(alice.socket, 'evil:room')).toBe(false)
    expect(alice.socket.rooms.has('evil:room')).toBe(false)
    // 非法房间从未加入 → 定向该房间的广播不可达
    h.svc.broadcastToRoom('evil:room', 'x', {})
    expect(alice.received).toHaveLength(0)
  })

  it('enforces user room ACL — cannot join another user room (F156)', () => {
    const h = harness()
    const alice = h.transport.connect(ALICE)
    expect(h.svc.handleJoinRoom(alice.socket, 'user:bob')).toBe(false)
    h.svc.emitToUser('bob', 'secret', {})
    expect(alice.received).toHaveLength(0) // alice 不可见 bob 的定向事件
  })

  it('accepts valid thread room joins and honors leave_room', () => {
    const h = harness()
    const alice = h.transport.connect(ALICE)
    expect(h.svc.handleJoinRoom(alice.socket, 'thread:t1')).toBe(true)
    expect(alice.socket.rooms.has('thread:t1')).toBe(true)
    alice.send('leave_room', 'thread:t1')
    expect(alice.socket.rooms.has('thread:t1')).toBe(false)
  })

  it('accepts global rooms for authenticated identities', () => {
    const h = harness()
    const alice = h.transport.connect(ALICE)
    expect(h.svc.handleJoinRoom(alice.socket, 'workspace:global')).toBe(true)
    expect(h.svc.handleJoinRoom(alice.socket, 'preview:global')).toBe(true)
    expect(h.svc.handleJoinRoom(alice.socket, 'workspace:navigate:ack')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Broadcast face
// ---------------------------------------------------------------------------

describe('ChatRealtimeService — broadcastAgentMessage', () => {
  it('delivers thread:message to every room member with monotonic seq + epoch', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    const c2 = h.transport.connect(BOB)
    const outsider = h.transport.connect(createUserId('carol'))
    joinThreadRoom(c1, 't1')
    joinThreadRoom(c2, 't1')

    h.svc.broadcastAgentMessage(agentMessage('cat_a', 'one'), 't1')
    h.svc.broadcastAgentMessage(agentMessage('cat_b', 'two'), 't1')

    const m1 = threadMessages(c1)
    const m2 = threadMessages(c2)
    expect(m1).toHaveLength(2)
    expect(m2).toHaveLength(2)
    expect(m1.map((m) => m.seq)).toEqual([1, 2]) // thread-scoped 单调
    expect(m1[0]).toMatchObject({
      threadId: 't1',
      type: 'text',
      content: 'one',
      seqEpoch: h.svc.sequencer.epoch,
    })
    expect(m1[1]!.seqEpoch).toBe(m1[0]!.seqEpoch) // epoch 终身稳定
    expect(threadMessages(outsider)).toHaveLength(0) // 非成员隔离（防跨线程泄露）
  })

  it('defaults to the default lobby thread when threadId omitted', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 'default')
    h.svc.broadcastAgentMessage(agentMessage('cat_a'))
    const m = threadMessages(c1)
    expect(m).toHaveLength(1)
    expect(m[0]!.threadId).toBe('default')
  })

  it('preserves a caller seq override and keeps subsequent seqs monotonic', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    h.svc.broadcastAgentMessage(agentMessage('cat_a'), 't1') // seq 1
    h.svc.broadcastAgentMessage({ ...agentMessage('cat_a'), seq: 100 }, 't1') // override
    h.svc.broadcastAgentMessage(agentMessage('cat_a'), 't1') // bumpTo 后续 101
    expect(threadMessages(c1).map((m) => m.seq)).toEqual([1, 100, 101])
  })

  it('records every broadcast in the per-thread rate monitor (choke point)', () => {
    const h = harness()
    for (let i = 0; i < 3; i++) h.svc.broadcastAgentMessage(agentMessage('cat_a'), 't1')
    h.svc.broadcastAgentMessage(agentMessage('cat_a'), 't2')
    expect(h.svc.getStats('t1').windowCount).toBe(3)
    expect(h.svc.getStats('t2').windowCount).toBe(1)
  })

  it('broadcastToRoomWithAck collects ack responses; absent responders resolve []', async () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    const c2 = h.transport.connect(BOB)
    joinThreadRoom(c1, 't1')
    joinThreadRoom(c2, 't1')
    c1.onAck(() => 'ack-1')
    c2.onAck(() => 'ack-2')
    const responses = await h.svc.broadcastToRoomWithAck('thread:t1', 'ping', {})
    expect(responses.sort()).toEqual(['ack-1', 'ack-2'])

    const c3 = h.transport.connect(createUserId('dave'))
    joinThreadRoom(c3, 't9')
    expect(await h.svc.broadcastToRoomWithAck('thread:t9', 'ping', {})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Event vocabulary（T5.11.3）
// ---------------------------------------------------------------------------

describe('ChatRealtimeService — event vocabulary', () => {
  it('emits invocation:progress to the thread room', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    h.svc.emitInvocationProgress({ threadId: 't1', kind: 'heartbeat', data: { at: 1 } })
    expect(events(c1, EVENT_INVOCATION_PROGRESS)).toEqual([
      { threadId: 't1', kind: 'heartbeat', data: { at: 1 } },
    ])
  })

  it('emits signal:new to the owning user only', () => {
    const h = harness()
    const alice = h.transport.connect(ALICE)
    const bob = h.transport.connect(BOB)
    h.svc.emitSignalNew({ userId: 'alice', kind: 'study', data: { topic: 'x' } })
    expect(events(alice, EVENT_SIGNAL_NEW)).toHaveLength(1)
    expect(events(bob, EVENT_SIGNAL_NEW)).toHaveLength(0)
  })

  it('emits approval:update to the proposal owner', () => {
    const h = harness()
    const alice = h.transport.connect(ALICE)
    const aliceTab2 = h.transport.connect(ALICE) // 多标签页
    const bob = h.transport.connect(BOB)
    h.svc.emitApprovalUpdate({ userId: 'alice', proposal: { id: 'p1', status: 'approved' } })
    expect(events(alice, EVENT_APPROVAL_UPDATE)).toHaveLength(1)
    expect(events(aliceTab2, EVENT_APPROVAL_UPDATE)).toHaveLength(1) // F39 多标签页
    expect(events(bob, EVENT_APPROVAL_UPDATE)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// cancel_invocation — rejection paths（F254）
// ---------------------------------------------------------------------------

describe('ChatRealtimeService — cancel rejections', () => {
  it('rejects with NO_TRACKER when the invocation backend is absent', () => {
    const h = harness({ withoutInvocation: true })
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    const outcome = h.svc.handleCancelInvocation(c1.socket, cancelPayload() as never)
    expect(outcome).toMatchObject({ status: 'rejected', reason: CancelRejectReason.NO_TRACKER })
  })

  it('rejects with MISSING_THREAD when threadId absent', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    const outcome = h.svc.handleCancelInvocation(
      c1.socket,
      cancelPayload({ threadId: undefined }) as never,
    )
    expect(outcome).toMatchObject({ status: 'rejected', reason: CancelRejectReason.MISSING_THREAD })
  })

  it('rejects unattributed cancels without explicit Stop provenance (F254)', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    for (const bad of [
      {}, // 全缺
      { origin: 'explicit_stop' }, // 缺 actionId/clientInstanceId
      { origin: 'toolbar_click', actionId: 'a', clientInstanceId: 'c' }, // 非显式来源
      { origin: 'explicit_stop', actionId: '', clientInstanceId: 'c' }, // 空 actionId
      { origin: 'explicit_stop', actionId: 'x'.repeat(201), clientInstanceId: 'c' }, // 超长
    ]) {
      const outcome = h.svc.handleCancelInvocation(c1.socket, bad as never)
      expect(outcome).toMatchObject({ status: 'rejected', reason: CancelRejectReason.UNATTRIBUTED })
    }
  })

  it('rejects duplicate cancel actions on the same socket', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    const payload = cancelPayload()
    expect(h.svc.handleCancelInvocation(c1.socket, payload as never).status).toBe('accepted')
    const dup = h.svc.handleCancelInvocation(c1.socket, payload as never)
    expect(dup).toMatchObject({ status: 'rejected', reason: CancelRejectReason.DUPLICATE_ACTION })
  })

  it('rejects cancels from sockets outside the target thread room', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE) // 未 join thread:t1
    const outcome = h.svc.handleCancelInvocation(c1.socket, cancelPayload() as never)
    expect(outcome).toMatchObject({ status: 'rejected', reason: CancelRejectReason.NOT_IN_ROOM })
  })
})

// ---------------------------------------------------------------------------
// cancel_invocation — scoped slot cancel（F108 + F-parallel-cancel）
// ---------------------------------------------------------------------------

describe('ChatRealtimeService — scoped slot cancel', () => {
  it('broadcasts cancel feedback scoped to the requested cat only', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    // 同 thread 两个并发槽；catA 的槽记录整个批次 [catA, catB]
    h.tracker!.start(T1, CAT_A, ALICE, [CAT_A, CAT_B])
    h.tracker!.start(T1, CAT_B, ALICE, [CAT_B])

    const outcome = h.svc.handleCancelInvocation(
      c1.socket,
      cancelPayload({ catId: 'cat_a' }) as never,
    )
    expect(outcome).toMatchObject({ status: 'accepted', cancelled: true, catIds: ['cat_a'] })

    const messages = threadMessages(c1)
    expect(messages).toHaveLength(2) // system_info + 单条 done
    expect(messages[0]).toMatchObject({ type: 'system_info', content: '⏹ 已取消', catId: 'cat_a' })
    expect(messages[1]).toMatchObject({ type: 'done', isFinal: true, catId: 'cat_a' })
    // F-parallel-cancel：兄弟槽不受影响
    expect(h.tracker!.has(T1, CAT_B)).toBe(true)
  })

  it('drives slot cleanup and multi-mention abort wiring', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    h.tracker!.start(T1, CAT_A, ALICE, [CAT_A, CAT_B])

    const slotCleanup: CancelSlotCleanup = {
      canReleaseSlotForUser: vi.fn(() => true),
      clearPause: vi.fn(),
      releaseSlot: vi.fn(),
      suppressAutoResume: vi.fn(),
    }
    const mentionAbort: MentionAbort = {
      abortByThread: vi.fn(() => 0),
      abortBySlot: vi.fn(() => 0),
    }
    h.svc.setSlotCleanup(slotCleanup)
    h.svc.setMentionAbort(mentionAbort)

    h.svc.handleCancelInvocation(c1.socket, cancelPayload({ catId: 'cat_a' }) as never)
    expect(slotCleanup.clearPause).toHaveBeenCalledWith('t1', 'cat_a')
    expect(slotCleanup.releaseSlot).toHaveBeenCalledWith('t1', 'cat_a')
    expect(mentionAbort.abortBySlot).toHaveBeenCalledWith('t1', 'cat_a')
  })

  it('does not cancel a slot owned by another user', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    h.tracker!.start(T1, CAT_A, BOB, [CAT_A]) // bob 的槽

    const outcome = h.svc.handleCancelInvocation(
      c1.socket,
      cancelPayload({ catId: 'cat_a' }) as never,
    )
    expect(outcome).toMatchObject({ status: 'accepted', cancelled: false, catIds: [] })
    expect(threadMessages(c1)).toHaveLength(0) // 无任何取消广播
    expect(h.tracker!.has(T1, CAT_A)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// cancel_invocation — cancel-all
// ---------------------------------------------------------------------------

describe('ChatRealtimeService — cancel-all', () => {
  it('broadcasts per-cat done + system_info and suppresses auto-resume per execution', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    h.tracker!.start(T1, CAT_A, ALICE, [CAT_A], 'exec-a')
    h.tracker!.start(T1, CAT_B, ALICE, [CAT_B], 'exec-b')

    const slotCleanup: CancelSlotCleanup = {
      canReleaseSlotForUser: vi.fn(() => true),
      clearPause: vi.fn(),
      releaseSlot: vi.fn(),
      suppressAutoResume: vi.fn(),
    }
    const mentionAbort: MentionAbort = { abortByThread: vi.fn(() => 0), abortBySlot: vi.fn(() => 0) }
    h.svc.setSlotCleanup(slotCleanup)
    h.svc.setMentionAbort(mentionAbort)

    const outcome = h.svc.handleCancelInvocation(c1.socket, cancelPayload() as never)
    expect(outcome).toMatchObject({
      status: 'accepted',
      cancelled: true,
      catIds: ['cat_a', 'cat_b'],
    })

    const messages = threadMessages(c1)
    expect(messages).toHaveLength(3) // system_info + done(catA) + done(catB)
    const dones = messages.filter((m) => m.type === 'done')
    expect(dones.map((m) => m.catId as string).sort()).toEqual(['cat_a', 'cat_b'])

    // 精确 executionId 抑制（cancel_all 语义 —— 防自动恢复风暴）
    expect(slotCleanup.suppressAutoResume).toHaveBeenCalledWith('t1', 'cat_a', ['exec-a'])
    expect(slotCleanup.suppressAutoResume).toHaveBeenCalledWith('t1', 'cat_b', ['exec-b'])
    // F156 P1-fix：逐 cat abortBySlot（非 abortByThread 全杀）
    expect(mentionAbort.abortBySlot).toHaveBeenCalledWith('t1', 'cat_a')
    expect(mentionAbort.abortBySlot).toHaveBeenCalledWith('t1', 'cat_b')
    expect(mentionAbort.abortByThread).not.toHaveBeenCalled()
    expect(h.tracker!.has(T1)).toBe(false) // 全槽清理
  })

  it('accepts a cancel-all with no active slots as a no-op', () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    const outcome = h.svc.handleCancelInvocation(c1.socket, cancelPayload() as never)
    expect(outcome).toMatchObject({ status: 'accepted', cancelled: false, catIds: [] })
    expect(threadMessages(c1)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Session mutex integration（卡死锁恢复）
// ---------------------------------------------------------------------------

describe('ChatRealtimeService — session mutex recovery', () => {
  it('force-releases a stuck session lock and broadcasts the terminal done', async () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    // 无 tracker 槽，但存在卡死的 agent 会话锁（recovered-lock-only 路径）
    await h.mutex!.acquire({
      sessionId: 's1',
      threadId: T1,
      userId: ALICE,
      catId: CAT_A,
      acquiredAt: Date.now(),
    })
    expect(h.mutex!.isHeld('s1')).toBe(true)

    const outcome = h.svc.handleCancelInvocation(
      c1.socket,
      cancelPayload({ catId: 'cat_a' }) as never,
    )
    expect(outcome).toMatchObject({ status: 'accepted', cancelled: true, catIds: ['cat_a'] })
    expect(h.mutex!.isHeld('s1')).toBe(false) // 卡死锁被强制释放
    const messages = threadMessages(c1)
    expect(messages).toHaveLength(2) // 锁恢复本身是成功终态 → 同样的 done 信号
    expect(messages[1]).toMatchObject({ type: 'done', catId: 'cat_a' })
  })

  it('preserves the live-cancelled holder lock (abort cleanup owns release)', async () => {
    const h = harness()
    const c1 = h.transport.connect(ALICE)
    joinThreadRoom(c1, 't1')
    h.tracker!.start(T1, CAT_A, ALICE, [CAT_A], 'exec-a')
    await h.mutex!.acquire({
      sessionId: 's2',
      threadId: T1,
      userId: ALICE,
      catId: CAT_A,
      executionId: 'exec-a',
      acquiredAt: Date.now(),
    })

    const outcome = h.svc.handleCancelInvocation(
      c1.socket,
      cancelPayload({ catId: 'cat_a' }) as never,
    )
    expect(outcome).toMatchObject({ status: 'accepted', cancelled: true, catIds: ['cat_a'] })
    // 活跃取消：被 abort 的 runner 在 finally 中自行释放锁 ——
    // forceReleaseByScope 以 preserveHolderExecutionIds 防双重释放竞争。
    expect(h.mutex!.isHeld('s2')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildCancelMessages（纯函数）
// ---------------------------------------------------------------------------

describe('buildCancelMessages', () => {
  it('returns nothing when not cancelled', () => {
    expect(buildCancelMessages({ cancelled: false, catIds: ['cat_a'] })).toEqual([])
  })

  it('falls back to the default cat when catIds is empty', () => {
    const messages = buildCancelMessages({ cancelled: true, catIds: [] })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ type: 'system_info', catId: 'opus' }) // 单条取消合唱抑制
    expect(messages[1]).toMatchObject({ type: 'done', isFinal: true, catId: 'opus' })
  })

  it('emits one system_info plus per-cat done to clear every loading state', () => {
    const messages = buildCancelMessages({ cancelled: true, catIds: ['cat_a', 'cat_b'] })
    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ type: 'system_info', content: '⏹ 已取消', catId: 'cat_a' })
    expect(messages[1]).toMatchObject({ type: 'done', catId: 'cat_a', isFinal: true })
    expect(messages[2]).toMatchObject({ type: 'done', catId: 'cat_b', isFinal: true })
  })
})

// ---------------------------------------------------------------------------
// Outcome shape sanity（供路由层消费的结构化契约）
// ---------------------------------------------------------------------------

describe('CancelInvocationOutcome shape', () => {
  it('rejected and accepted variants are disjoint', () => {
    const rejected: CancelInvocationOutcome = { status: 'rejected', reason: 'NOT_IN_ROOM' }
    const accepted: CancelInvocationOutcome = { status: 'accepted', cancelled: true, catIds: ['cat_a'] }
    expect(rejected.status).toBe('rejected')
    expect(accepted.status).toBe('accepted')
  })
})
