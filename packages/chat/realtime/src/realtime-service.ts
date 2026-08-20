/**
 * ChatRealtimeService — 实时事件面 Cordis 服务（阶段5 批次3，ctx.chatRealtime）。
 *
 * 移植自 clowder-ai `SocketManager.ts`（R13 一切皆插件改造）：socket.io
 * 模块单例的全部业务语义提取为服务层 ——
 * - 连接处理：自动加入 `user:<userId>` 房间（F39 多标签页）+ join_room/
 *   leave_room 房间白名单校验（F156 ACL：user: 房间身份隔离 + 全局房间鉴权）
 * - 广播面：broadcastAgentMessage（thread:message + F183 seq/seqEpoch 注入 +
 *   BroadcastRateMonitor 限速观测）/ broadcastToRoom / broadcastToRoomWithAck /
 *   emitToUser / 事件词汇面（invocation:progress / signal:new / approval:update）
 * - cancel_invocation 编排（F254 显式溯源 + F108 槽级取消 + F-parallel-cancel
 *   作用域广播 + 会话锁强制释放 + 队列槽清理 + 多 @ 编排中止）
 *
 * 传输经 `RealtimeTransport` 缝注入（默认 InMemoryRealtimeTransport；socket.io
 * 适配器由组合根 typert WS 域提供 —— CORS/allowRequest 属传输层）。
 * tracker/mutex 经 `ctx.get(..., false)` 惰性解析（可选依赖，未装载时取消
 * 编排降级为 NO_TRACKER 拒绝），避免 hard inject 阻塞纯事件面部署。
 *
 * @module @flowforge/chat-realtime/service
 */

import { Context, Service } from '@flowforge/cordis'
import type { InvocationTrackerService } from '@flowforge/cats-invocation'
import type { SessionMutexService } from '@flowforge/cats-invocation'
import type { CancelResult } from '@flowforge/cats-invocation'
import type { CatId, UserId } from '@flowforge/cats-shared'
import { createCatId, createThreadId } from '@flowforge/cats-shared'
import {
  ACK_BROADCAST_TIMEOUT_MS,
  CancelRejectReason,
  CANCEL_ORIGIN_EXPLICIT_STOP,
  CANCEL_PROVENANCE_MAX_LENGTH,
  CANCEL_REASON_CANCEL_ALL,
  CANCEL_REASON_USER_CANCEL,
  CANCEL_FEEDBACK_TEXT,
  DEFAULT_THREAD_ID,
  EVENT_APPROVAL_UPDATE,
  EVENT_INVOCATION_PROGRESS,
  EVENT_SIGNAL_NEW,
  EVENT_THREAD_MESSAGE,
  GLOBAL_ROOMS,
  ROOM_PREFIX_PATTERN,
  THREAD_ROOM_PREFIX,
  USER_ROOM_PREFIX,
} from './invariant.ts'
import type { CancelRejectReasonValue } from './invariant.ts'
import type {
  AgentMessage,
  ApprovalUpdatePayload,
  BroadcastAgentMessage,
  InvocationProgressPayload,
  SignalNewPayload,
} from './events.ts'
import { BroadcastRateMonitor } from './rate-monitor.ts'
import type { BroadcastRateMonitorOptions } from './rate-monitor.ts'
import { ThreadSequencer } from './thread-sequencer.ts'
import type { RealtimeServerSocket, RealtimeTransport } from './transport.ts'
import { InMemoryRealtimeTransport } from './transport.ts'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** cancel_invocation 客户端载荷（clowder-ai WS 事件契约）。 */
export interface CancelInvocationInput {
  readonly threadId?: string
  readonly catId?: string
  readonly origin?: string
  readonly actionId?: string
  readonly clientInstanceId?: string
}

/** cancel_invocation 处理结果（结构化拒绝原因，供路由层/测试断言）。 */
export type CancelInvocationOutcome =
  | { readonly status: 'rejected'; readonly reason: CancelRejectReasonValue }
  | { readonly status: 'accepted'; readonly cancelled: boolean; readonly catIds: readonly string[] }

/**
 * 队列槽清理协作方（clowder-ai QueueProcessorLike）。
 * 批次3.6+ 具体 QueueProcessor 装载后经 setSlotCleanup 接线 ——
 * 循环依赖（processor 反向依赖 realtime 广播）以 late-wiring 解开。
 */
export interface CancelSlotCleanup {
  canReleaseSlotForUser(threadId: string, catId: string, userId: string): boolean
  clearPause(threadId: string, catId?: string): void
  releaseSlot(threadId: string, catId: string): void
  suppressAutoResume(threadId: string, catId: string, executionIds?: readonly string[]): void
}

/** 多 @ 编排中止协作方（批次5 MultiMentionOrchestrator 接线点）。 */
export interface MentionAbort {
  abortByThread(threadId: string): number
  abortBySlot?(threadId: string, catId: string): number
}

/** Constructor options — 协作方保持在 Cordis inject 之外。 */
export interface ChatRealtimeServiceOptions {
  /** 传输后端；缺省进程内实现（socket.io 适配器由组合根注入）。 */
  readonly transport?: RealtimeTransport
  /** 广播限速观测配置（阈值/窗口/去抖/时钟注入）。 */
  readonly rateMonitorOptions?: BroadcastRateMonitorOptions
  /** sequencer epoch 覆盖（确定性测试）。 */
  readonly epochOverride?: string
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat realtime event face — mounted by `@flowforge/chat-realtime`. */
    chatRealtime: ChatRealtimeService
  }
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** buildCancelMessages 输入（CancelResult 的结构子集 —— catIds 宽为 string）。 */
export interface CancelMessagesInput {
  readonly cancelled: boolean
  readonly catIds: readonly string[]
}

/**
 * 成功取消后广播的 AgentMessage 序列（纯函数，抽出以便测试）。
 * 单条 system_info 避免"取消合唱"；逐 cat done 确保每个灵智体的
 * loading 状态被前端清理。
 */
export function buildCancelMessages(result: CancelMessagesInput): AgentMessage[] {
  if (!result.cancelled) return []
  const catIds = result.catIds.length > 0 ? result.catIds : ['opus']
  const primaryCatId = catIds[0] ?? 'opus'
  const now = Date.now()
  const messages: AgentMessage[] = []

  messages.push({
    type: 'system_info',
    catId: createCatId(primaryCatId),
    content: CANCEL_FEEDBACK_TEXT,
    timestamp: now,
  })
  for (const catId of catIds) {
    messages.push({
      type: 'done',
      catId: createCatId(catId),
      isFinal: true,
      timestamp: now,
    })
  }
  return messages
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Cordis service exposing the chat realtime event face at `ctx.chatRealtime`.
 */
export class ChatRealtimeService extends Service {
  private readonly transport: RealtimeTransport
  /** F183 Phase C — thread-scoped monotonic sequencer + boot epoch。 */
  readonly sequencer: ThreadSequencer
  /** F183 Phase C2/C3 — per-thread emit rate monitor（观测-only，不丢事件）。 */
  readonly rateMonitor: BroadcastRateMonitor
  /** Late-wired collaborators（循环依赖解开，对齐 clowder setQueueProcessor）。 */
  private slotCleanup: CancelSlotCleanup | null = null
  private mentionAbort: MentionAbort | null = null
  /** F254: per-socket 去重已见 cancel actionId。 */
  private readonly cancelActionsBySocket = new Map<string, Set<string>>()
  private readonly logger: { info: (msg: string) => void; warn: (msg: string) => void }

  constructor(ctx: Context, options: ChatRealtimeServiceOptions = {}) {
    super(ctx, 'chatRealtime')
    this.transport = options.transport ?? new InMemoryRealtimeTransport()
    this.sequencer = new ThreadSequencer(options.epochOverride)
    this.rateMonitor = new BroadcastRateMonitor({
      ...(options.rateMonitorOptions ?? {}),
      onWarn:
        options.rateMonitorOptions?.onWarn ??
        ((event) => {
          this.logger.warn(
            `broadcast_rate_warn threadId=${event.threadId} windowCount=${event.windowCount} ` +
              `threshold=${event.threshold} windowMs=${event.windowMs}`,
          )
        }),
    })
    const logger = ctx.logger('chatRealtime')
    this.logger = { info: (m) => logger.info(m), warn: (m) => logger.warn(m) }
    this.transport.onConnection((socket) => this.handleConnection(socket))
    ctx.effect(() => () => this.close(), 'chatRealtime.transportClose')
  }

  // -------------------------------------------------------------------------
  // Connection & room management
  // -------------------------------------------------------------------------

  /** 连接建立：自动加入 user 房间 + 注册 join_room/leave_room/cancel 处理器。 */
  handleConnection(socket: RealtimeServerSocket): void {
    // F39: 自动加入 user-scoped 房间（emitToUser 多标签页支持）。
    // F156: userId 由传输层服务端判定，自动加入无条件执行。
    socket.join(`${USER_ROOM_PREFIX}${socket.userId}`)
    this.logger.info(`client connected socketId=${socket.id} userId=${socket.userId}`)

    socket.on('join_room', (payload: unknown) => {
      if (typeof payload !== 'string') return
      this.handleJoinRoom(socket, payload)
    })
    socket.on('leave_room', (payload: unknown) => {
      if (typeof payload !== 'string') return
      socket.leave(payload)
    })
    socket.on('cancel_invocation', (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return
      this.handleCancelInvocation(socket, payload as CancelInvocationInput)
    })
  }

  /**
   * join_room 白名单校验（F156 房间 ACL）：
   * - 仅允许已知前缀（thread: / worktree: / preview:global / workspace:* / user:）
   * - `user:` 房间身份隔离 —— 不可加入他人房间
   * - 全局房间要求已鉴权身份（单用户模式 userId 恒存在；F077 多用户扩展点）
   * 返回是否接受（clowder-ai 仅记录 warn 并忽略，此处结构化返回供测试断言）。
   */
  handleJoinRoom(socket: RealtimeServerSocket, room: string): boolean {
    if (!ROOM_PREFIX_PATTERN.test(room)) {
      this.logger.warn(
        `join_room rejected: invalid room prefix socketId=${socket.id} room=${room}`,
      )
      return false
    }
    if (room.startsWith(USER_ROOM_PREFIX) && room !== `${USER_ROOM_PREFIX}${socket.userId}`) {
      this.logger.warn(
        `join_room rejected: user room ACL socketId=${socket.id} room=${room} userId=${socket.userId}`,
      )
      return false
    }
    if (GLOBAL_ROOMS.includes(room) && !socket.userId) {
      this.logger.warn(`join_room rejected: global room requires auth socketId=${socket.id} room=${room}`)
      return false
    }
    socket.join(room)
    this.logger.info(`joined room socketId=${socket.id} room=${room}`)
    return true
  }

  // -------------------------------------------------------------------------
  // Broadcast face
  // -------------------------------------------------------------------------

  /**
   * 向 thread 房间广播灵智体消息（唯一 choke point —— 限速观测在此记录）。
   * 无 threadId 时落 default 大厅房间；绝不全局广播（防跨线程泄露）。
   *
   * F183：注入 thread-scoped 单调 seq + sequencer epoch。调用方提供 seq>0
   * 时作为 transport 提示保留（确定性测试夹具），并将 sequencer bump 到
   * max(current, override) 保证后续自动分配仍单调；epoch 恒被服务端覆盖
   * （调用方无法伪造 epoch）。生产调用方应留空 seq 让 sequencer 分配。
   */
  broadcastAgentMessage(message: AgentMessage, threadId?: string): void {
    const tid = threadId ?? DEFAULT_THREAD_ID
    const room = `${THREAD_ROOM_PREFIX}${tid}`
    const seqOverride = message.seq
    let seq: number
    if (typeof seqOverride === 'number' && seqOverride > 0) {
      seq = seqOverride
      this.sequencer.bumpTo(tid, seqOverride)
    } else {
      seq = this.sequencer.next(tid)
    }
    const payload: BroadcastAgentMessage = {
      ...message,
      threadId: tid,
      seq,
      seqEpoch: this.sequencer.epoch,
    }
    this.rateMonitor.record(tid)
    this.transport.emitToRoom(room, EVENT_THREAD_MESSAGE, payload)
  }

  /** 任意房间任意事件广播（clowder-ai broadcastToRoom 透传面）。 */
  broadcastToRoom(room: string, event: string, data: unknown): void {
    this.transport.emitToRoom(room, event, data)
  }

  /** 房间广播 + ack 收集（best-effort：超时收敛为已收到的部分应答）。 */
  broadcastToRoomWithAck(
    room: string,
    event: string,
    data: unknown,
    timeoutMs = ACK_BROADCAST_TIMEOUT_MS,
  ): Promise<unknown[]> {
    return this.transport.emitToRoomWithAck(room, event, data, timeoutMs)
  }

  /** 定向某用户全部连接（F39 多标签页安全）。 */
  emitToUser(userId: string, event: string, data: unknown): void {
    this.transport.emitToUser(userId, event, data)
  }

  /** invocation:progress —— thread 房间进度事件（heartbeat/intent_mode/queue 族）。 */
  emitInvocationProgress(payload: InvocationProgressPayload): void {
    this.transport.emitToRoom(
      `${THREAD_ROOM_PREFIX}${payload.threadId}`,
      EVENT_INVOCATION_PROGRESS,
      payload,
    )
  }

  /** signal:new —— 用户定向新信号通知。 */
  emitSignalNew(payload: SignalNewPayload): void {
    this.transport.emitToUser(payload.userId, EVENT_SIGNAL_NEW, payload)
  }

  /** approval:update —— 提案/审批生命周期更新（定向提案 owner）。 */
  emitApprovalUpdate(payload: ApprovalUpdatePayload): void {
    this.transport.emitToUser(payload.userId, EVENT_APPROVAL_UPDATE, payload)
  }

  /** Per-thread 广播速率统计（admin/test 洞察）。 */
  getStats(threadId: string) {
    return this.rateMonitor.getStats(threadId)
  }

  // -------------------------------------------------------------------------
  // Cancel orchestration（clowder-ai cancel_invocation 全量语义）
  // -------------------------------------------------------------------------

  /**
   * Late-wire 队列槽清理（批次3.6+ QueueProcessor 装载后调用，
   * 对齐 clowder setQueueProcessor —— 解开 processor ↔ realtime 循环依赖）。
   */
  setSlotCleanup(slotCleanup: CancelSlotCleanup): void {
    this.slotCleanup = slotCleanup
  }

  /** Late-wire 多 @ 编排中止（批次5 MultiMentionOrchestrator 接线点）。 */
  setMentionAbort(mentionAbort: MentionAbort): void {
    this.mentionAbort = mentionAbort
  }

  /**
   * cancel_invocation 处理（F254 显式溯源 + F108 槽级/全线程取消）。
   *
   * 拒绝路径（结构化 reason，溯源信任边界先行）：
   * - NO_TRACKER：tracker 服务未装载（纯事件面部署）
   * - UNATTRIBUTED：无显式 Stop 溯源（F254 —— 拒绝无法归因的取消）
   * - MISSING_THREAD：载荷缺 threadId
   * - DUPLICATE_ACTION：同一 socket 重复 actionId（重连风暴去重）
   * - NOT_IN_ROOM：未加入目标 thread 房间（最小权限）
   */
  handleCancelInvocation(socket: RealtimeServerSocket, data: CancelInvocationInput): CancelInvocationOutcome {
    const tracker = this.resolveTracker()
    if (!tracker) return { status: 'rejected', reason: CancelRejectReason.NO_TRACKER }

    // F254: 仅接受显式 Stop 溯源（origin + actionId + clientInstanceId）。
    // 溯源是信任边界 —— 先于一切载荷语义校验（含 threadId 缺失），无法
    // 归因的取消不进入后续处理。
    const hasExplicitProvenance =
      data?.origin === CANCEL_ORIGIN_EXPLICIT_STOP &&
      typeof data.actionId === 'string' &&
      data.actionId.length > 0 &&
      data.actionId.length <= CANCEL_PROVENANCE_MAX_LENGTH &&
      typeof data.clientInstanceId === 'string' &&
      data.clientInstanceId.length > 0 &&
      data.clientInstanceId.length <= CANCEL_PROVENANCE_MAX_LENGTH
    if (!hasExplicitProvenance) {
      this.logger.warn(
        `f254_unattributed_cancel_rejected socketId=${socket.id} threadId=${data?.threadId}`,
      )
      return { status: 'rejected', reason: CancelRejectReason.UNATTRIBUTED }
    }
    if (!data.threadId) return { status: 'rejected', reason: CancelRejectReason.MISSING_THREAD }

    let seen = this.cancelActionsBySocket.get(socket.id)
    if (!seen) {
      seen = new Set()
      this.cancelActionsBySocket.set(socket.id, seen)
    }
    if (seen.has(data.actionId)) {
      this.logger.warn(
        `duplicate cancel action rejected socketId=${socket.id} actionId=${data.actionId}`,
      )
      return { status: 'rejected', reason: CancelRejectReason.DUPLICATE_ACTION }
    }
    seen.add(data.actionId)

    // 最小权限：仅允许已加入目标 thread 房间的连接发起取消。
    const room = `${THREAD_ROOM_PREFIX}${data.threadId}`
    if (!socket.rooms.has(room)) {
      this.logger.warn(
        `cancel without room membership socketId=${socket.id} threadId=${data.threadId}`,
      )
      return { status: 'rejected', reason: CancelRejectReason.NOT_IN_ROOM }
    }

    if (data.catId) {
      return this.cancelSlot(socket, tracker, data.threadId, data.catId)
    }
    return this.cancelAll(socket, tracker, data.threadId)
  }

  /** F108 槽级取消：作用域广播 + 槽清理严格限定请求的 cat（F-parallel-cancel）。 */
  private cancelSlot(
    socket: RealtimeServerSocket,
    tracker: InvocationTrackerService,
    threadId: string,
    catId: string,
  ): CancelInvocationOutcome {
    const userId = socket.userId
    const result = tracker.cancel(
      createThreadId(threadId),
      createCatId(catId),
      userId,
      CANCEL_REASON_USER_CANCEL,
    )
    const lockRelease = this.resolveMutex()?.forceReleaseByScope(
      { threadId: createThreadId(threadId), userId, catId: createCatId(catId) },
      { preserveHolderExecutionIds: result.executionIds ?? [] },
    )
    const recoveredLockOnly =
      ((lockRelease?.releasedHolders ?? 0) > 0 || (lockRelease?.rejectedWaiters ?? 0) > 0) &&
      this.canReleaseSlotForUser(threadId, catId, userId)
    if (result.cancelled || recoveredLockOnly) {
      // F-parallel-cancel：result.catIds 携带整个 startAll 批次，广播作用域
      // 必须收敛到请求的 cat —— 否则兄弟灵智体 UI 被误清（"取消一只两只
      // 一起取消"根因）。锁恢复本身是成功终态，即使 tracker 条目已消失。
      const scopedResult: CancelResult = { ...result, cancelled: true, catIds: [createCatId(catId)] }
      for (const msg of buildCancelMessages(scopedResult)) {
        this.broadcastAgentMessage(msg, threadId)
      }
      this.slotCleanup?.clearPause(threadId, catId)
      this.slotCleanup?.releaseSlot(threadId, catId)
    }
    // F108 + F086: 中止该 cat 的多 @ 编排分发
    this.mentionAbort?.abortBySlot?.(threadId, catId)
    return {
      status: 'accepted',
      cancelled: result.cancelled || recoveredLockOnly,
      catIds: result.cancelled || recoveredLockOnly ? [catId] : result.catIds.map(String),
    }
  }

  /**
   * 全线程取消：cancel_all（非 user_cancel —— QueueProcessor 据此区分
   * "全停"与单 cat 取消，仅 cancel_all 触发 suppressAutoResume）。
   */
  private cancelAll(
    socket: RealtimeServerSocket,
    tracker: InvocationTrackerService,
    threadId: string,
  ): CancelInvocationOutcome {
    const userId = socket.userId
    const cancelAllResult = tracker.cancelAll(
      createThreadId(threadId),
      userId,
      CANCEL_REASON_CANCEL_ALL,
    )
    const cancelledCatIds = cancelAllResult.catIds
    const lockRelease = this.resolveMutex()?.forceReleaseByScope(
      { threadId: createThreadId(threadId), userId },
      { preserveHolderExecutionIds: cancelAllResult.executionIds },
    )
    // 锁恢复覆盖的 cat 中，仅清理已无活跃槽归属者（与 clowder-ai 一致）。
    const recoveredCatIds = (lockRelease?.catIds ?? []).filter((cid) =>
      this.canReleaseSlotForUser(threadId, cid, userId),
    )
    const terminalCatIds = [...new Set([...cancelledCatIds, ...recoveredCatIds])]

    if (terminalCatIds.length > 0) {
      for (const msg of buildCancelMessages({ cancelled: true, catIds: terminalCatIds })) {
        this.broadcastAgentMessage(msg, threadId)
      }
      for (const catId of terminalCatIds) {
        this.slotCleanup?.clearPause(threadId, catId)
        this.slotCleanup?.releaseSlot(threadId, catId)
        // 双路径抑制自动恢复：排队路径 executeEntry 也会设置 suppress
        // （belt-and-suspenders）；直发路径（messages）仅此处覆盖。
        const executionId = cancelAllResult.executionIdByCatId[catId]
        this.slotCleanup?.suppressAutoResume(threadId, catId, executionId ? [executionId] : [])
        // F156 P1-fix：逐 cat abortBySlot 而非 abortByThread ——
        // 后者会误杀其他用户的多 @ 编排分发。
        this.mentionAbort?.abortBySlot?.(threadId, catId)
      }
    }
    return {
      status: 'accepted',
      cancelled: terminalCatIds.length > 0,
      catIds: terminalCatIds.map(String),
    }
  }

  /**
   * 槽可释放判定：优先 slotCleanup 协作方；退化到 tracker 归属检查
   * （无活跃槽，或槽属当前用户）。
   */
  private canReleaseSlotForUser(threadId: string, catId: string, userId: UserId): boolean {
    if (this.slotCleanup) {
      return this.slotCleanup.canReleaseSlotForUser(threadId, catId, userId)
    }
    const tracker = this.resolveTracker()
    if (!tracker) return false
    const tid = createThreadId(threadId)
    const cid = createCatId(catId)
    return !tracker.has(tid, cid) || tracker.getUserId(tid, cid) === userId
  }

  /** 惰性解析 tracker（可选依赖 —— 纯事件面部署未装载时返回 undefined）。 */
  private resolveTracker(): InvocationTrackerService | undefined {
    return this.ctx.get('catsInvocationTracker', false) as InvocationTrackerService | undefined
  }

  /** 惰性解析会话锁（同 tracker —— 可选依赖）。 */
  private resolveMutex(): SessionMutexService | undefined {
    return this.ctx.get('catsInvocationMutex', false) as SessionMutexService | undefined
  }

  /** 关闭传输（优雅停机；幂等）。 */
  close(): void {
    this.transport.close()
    this.cancelActionsBySocket.clear()
  }
}

// Re-export commonly used collaborator types for consumer convenience.
export type { CatId, RealtimeServerSocket, RealtimeTransport, UserId }
