/**
 * @flowforge/chat-mention — MultiMentionOrchestratorService（T5.3.2，阶段5 批次5，ctx.chatMention）。
 *
 * 包装 {@link MultiMentionOrchestrator}（F086 M1 内存态机）为 Cordis Service，并落地
 * callback-multi-mention 语义的并发编排：
 * - `create` / `start` / `recordResponse` / `handleTimeout` / `handleFailure` 状态面
 * - `dispatch`：经 `ctx.catsInvocationQueue` 逐目标入队（source:'agent'，callerCatId=发起者，
 *   幂等 key），懒解析队列服务（未装载时降级为轻量占位执行路径的调用约定）
 * - `abortByThread` / `abortBySlot`：与 `@flowforge/chat-realtime` 的 `MentionAbort` 结构兼容，
 *   由组合根 `setMentionAbort(chatMention)` 接线
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-invocation'    # mounts queue/tracker
 * - name: '@flowforge/chat-mention'
 * ```
 *
 * @module @flowforge/chat-mention/service
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, MultiMentionRequest, MultiMentionResult, MultiMentionStatus, UserId } from '@flowforge/cats-shared'
import { MultiMentionOrchestrator, type MultiMentionCreateParams } from './multi-mention-orchestrator.ts'

/** 单 target 入队结果（对齐 clowder enqueueMultiMentionTarget 的语义结果）。 */
export type MultiMentionDispatchOutcome = 'enqueued' | 'skipped' | 'full'

export interface DispatchInput {
  threadId: string
  userId: UserId
  question: string
  context?: string | undefined
  idempotencyKey?: string | undefined
  /** 发起方 cat（作为 callerCatId 写入队列条目）。 */
  callerCatId: CatId
}

/**
 * Orchestrator wrapper delegating the dispatch-controller lifecycle (register
 * per-target AbortController) so thread/slot aborts propagate to in-flight
 * dispatches.
 */
export class MultiMentionOrchestratorService extends Service {
  private readonly orchestrator = new MultiMentionOrchestrator()

  constructor(ctx: Context) {
    super(ctx, 'chatMention')
  }

  // ── 状态面 ─────────────────────────────────────────────────────────
  create(params: MultiMentionCreateParams): MultiMentionRequest {
    return this.orchestrator.create(params)
  }

  start(requestId: string): void {
    this.orchestrator.start(requestId)
  }

  recordResponse(requestId: string, catId: CatId, content: string): MultiMentionStatus {
    return this.orchestrator.recordResponse(requestId, catId, content)
  }

  handleTimeout(requestId: string): void {
    this.orchestrator.handleTimeout(requestId)
  }

  handleFailure(requestId: string, reason: string): void {
    this.orchestrator.handleFailure(requestId, reason)
  }

  getStatus(requestId: string): MultiMentionStatus {
    return this.orchestrator.getStatus(requestId)
  }

  getResult(requestId: string): MultiMentionResult {
    return this.orchestrator.getResult(requestId)
  }

  isActiveTarget(threadId: string, catId: CatId): boolean {
    return this.orchestrator.isActiveTarget(threadId, catId)
  }

  findActiveByThread(threadId: string): MultiMentionRequest[] {
    return this.orchestrator.findActiveByThread(threadId)
  }

  hasActiveDispatches(threadId: string): boolean {
    return this.orchestrator.hasActiveDispatches(threadId)
  }

  // ── Cancel（MentionAbort 结构兼容）─────────────────────────────────
  abortByThread(threadId: string): number {
    return this.orchestrator.abortByThread(threadId)
  }

  abortBySlot(threadId: string, catId: CatId): number {
    return this.orchestrator.abortBySlot(threadId, catId)
  }

  // ── Dispatch ───────────────────────────────────────────────────────
  /**
   * 为 multi-mention 逐 #985 target 生成消息内容。
   * 结构前缀让目标灵智体理解请求来自另一个灵智体而非用户。
   */
  static buildDispatchMessage(initiator: CatId, question: string, context?: string): string {
    return [`[Multi-Mention from ${initiator}]`, question, ...(context ? ['---', context] : [])].join('\n\n')
  }

  /**
   * 经 `ctx.catsInvocationQueue` 把 requestId 的每个 target 入队。
   * 队列服务懒解析（`ctx.get('catsInvocationQueue', false)`）：未装载时返回 'skipped'
   * 并在日志中标注，交由上层决定降级路径。
   *
   * @returns 每个目标门的入队结果 (catId → outcome)
   */
  dispatch(requestId: string, targets: readonly CatId[], input: DispatchInput): Record<string, MultiMentionDispatchOutcome> {
    // 结构化契约对齐 `@flowforge/cats-invocation/queue` 的 EnqueueInput/EnqueueResult，
    // 经懒解析避免编译期跨包耦合。
    type QueueLike = {
      enqueue(input: {
        threadId: string
        userId: string
        targetCatIds: readonly CatId[]
        source: 'user' | 'connector' | 'agent'
        sourceCategory?: string | undefined
        callerCatId?: CatId | undefined
        idempotencyKey?: string | undefined
      }): { outcome: 'created' | 'deduped' | 'full'; entry?: { id: string } | undefined }
    }
    const queue = this.ctx.get('catsInvocationQueue', false) as QueueLike | undefined

    const outcomes: Record<string, MultiMentionDispatchOutcome> = {}

    for (const catId of targets) {
      // 防级联：猫已是活跃靶点则跳过（高层在 create 前已用 isActiveTarget 拦）。
      if (this.orchestrator.isActiveTarget(input.threadId, catId) && catId !== input.callerCatId) {
        outcomes[catId] = 'skipped'
        continue
      }

      if (!queue) {
        // 队列未装载：注册一个本地 AbortController 供取消传播（无实际执行），
        // 标记 skipped —— 真实执行由装载队列服务的组合根接管。
        const controller = new AbortController()
        this.orchestrator.registerDispatch(requestId, catId, controller)
        outcomes[catId] = 'skipped'
        continue
      }

      const result = queue.enqueue({
        threadId: input.threadId,
        userId: input.userId,
        targetCatIds: [catId],
        source: 'agent',
        sourceCategory: 'a2a',
        callerCatId: input.callerCatId,
        ...(input.idempotencyKey ? { idempotencyKey: `mm-${requestId}-${catId}` } : {}),
      })

      const outcome: MultiMentionDispatchOutcome =
        result.outcome === 'created' ? 'enqueued' : result.outcome === 'full' ? 'full' : 'skipped'
      outcomes[catId] = outcome

      if (outcome === 'enqueued') {
        const controller = new AbortController()
        this.orchestrator.registerDispatch(requestId, catId, controller)
      }
    }

    return outcomes
  }

  /**
   * 单发派发完成时释放 dispatch 控制器（对齐 unregisterDispatch）。
   */
  releaseDispatch(requestId: string, catId: CatId): void {
    this.orchestrator.unregisterDispatch(requestId, catId)
  }
}

export type { MultiMentionCreateParams } from './multi-mention-orchestrator.ts'