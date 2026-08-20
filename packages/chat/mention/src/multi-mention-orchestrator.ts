/**
 * @flowforge/chat-mention — MultiMentionOrchestrator 内存态管理器（F086 M1，阶段5 批次5）。
 *
 * 移植 clowder-ai `MultiMentionOrchestrator.ts` 的纯状态面：请求创建（幂等）、
 * 响应归集（done/partial 判定）、超时/失败处理、dispatch 控制器 + 线程/槽级 abort。
 * 与 clowder 一致，依赖 Node 单线程事件循环保证线程安全。
 *
 * 纯类不做队列/网络 IO——dispatch 编排在 Cordis Service（`multi-mention-service.ts`）
 * 中通过 `ctx.catsInvocationQueue` 落地。
 *
 * @module @flowforge/chat-mention/multi-mention-orchestrator
 */

import { randomUUID } from 'node:crypto'
import {
  MAX_MULTI_MENTION_TARGETS,
  MAX_TIMEOUT_MINUTES,
  MIN_TIMEOUT_MINUTES,
  MULTI_MENTION_TERMINAL_STATES,
  type CatId,
  type MultiMentionRequest,
  type MultiMentionResponse,
  type MultiMentionResult,
  type MultiMentionStatus,
  type MultiMentionTriggerType,
} from '@flowforge/cats-shared'
import { isValidTransition } from './multi-mention-state-machine.ts'

export interface MultiMentionCreateParams {
  threadId: string
  initiator: CatId
  callbackTo: CatId
  targets: CatId[]
  question: string
  context?: string | undefined
  idempotencyKey?: string | undefined
  timeoutMinutes: number
  triggerType?: MultiMentionTriggerType | undefined
  searchEvidenceRefs?: string[] | undefined
  overrideReason?: string | undefined
}

interface OrchestratorEntry {
  request: MultiMentionRequest
  responses: Map<CatId, MultiMentionResponse>
}

export class MultiMentionOrchestrator {
  private readonly entries = new Map<string, OrchestratorEntry>()
  private readonly idempotencyIndex = new Map<string, string>() // "threadId:key" → requestId
  // "requestId:catId" → controller；线程级取消/删除可传播到单次 dispatch，
  // 避免 InvocationTracker 的单线程约束造成并发 dispatch 相互中断。
  private readonly dispatchControllers = new Map<string, AbortController>()

  create(params: MultiMentionCreateParams): MultiMentionRequest {
    if (params.targets.length === 0 || params.targets.length > MAX_MULTI_MENTION_TARGETS) {
      throw new Error(`targets must have 1-${MAX_MULTI_MENTION_TARGETS} entries, got ${params.targets.length}`)
    }
    if (params.timeoutMinutes < MIN_TIMEOUT_MINUTES || params.timeoutMinutes > MAX_TIMEOUT_MINUTES) {
      throw new Error(
        `timeout must be ${MIN_TIMEOUT_MINUTES}-${MAX_TIMEOUT_MINUTES} minutes, got ${params.timeoutMinutes}`,
      )
    }

    if (params.idempotencyKey) {
      const idemKey = `${params.threadId}:${params.idempotencyKey}`
      const existingId = this.idempotencyIndex.get(idemKey)
      if (existingId) {
        const existing = this.entries.get(existingId)
        if (existing) return existing.request
      }
    }

    const request: MultiMentionRequest = {
      id: randomUUID(),
      threadId: params.threadId,
      initiator: params.initiator,
      callbackTo: params.callbackTo,
      targets: [...params.targets],
      question: params.question,
      timeoutMinutes: params.timeoutMinutes,
      status: 'pending',
      createdAt: Date.now(),
      ...(params.context ? { context: params.context } : {}),
      ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
      ...(params.triggerType ? { triggerType: params.triggerType } : {}),
      ...(params.searchEvidenceRefs ? { searchEvidenceRefs: [...params.searchEvidenceRefs] } : {}),
      ...(params.overrideReason ? { overrideReason: params.overrideReason } : {}),
    }

    this.entries.set(request.id, { request, responses: new Map() })

    if (params.idempotencyKey) {
      this.idempotencyIndex.set(`${params.threadId}:${params.idempotencyKey}`, request.id)
    }

    return request
  }

  start(requestId: string): void {
    this.transition(requestId, 'running')
  }

  recordResponse(requestId: string, catId: CatId, content: string): MultiMentionStatus {
    const entry = this.entries.get(requestId)
    if (!entry) throw new Error(`Multi-mention request not found: ${requestId}`)

    if (MULTI_MENTION_TERMINAL_STATES.has(entry.request.status)) {
      return entry.request.status
    }
    if (!entry.request.targets.includes(catId)) {
      return entry.request.status
    }
    if (entry.responses.has(catId)) {
      return entry.request.status
    }

    entry.responses.set(catId, {
      catId,
      content,
      timestamp: Date.now(),
      status: 'received',
    })

    const receivedCount = entry.responses.size
    const targetCount = entry.request.targets.length

    if (receivedCount >= targetCount) {
      this.transition(requestId, 'done')
    } else if (entry.request.status === 'running') {
      this.transition(requestId, 'partial')
    }

    return entry.request.status
  }

  handleTimeout(requestId: string): void {
    const entry = this.entries.get(requestId)
    if (!entry) return
    if (MULTI_MENTION_TERMINAL_STATES.has(entry.request.status)) return

    for (const target of entry.request.targets) {
      if (!entry.responses.has(target)) {
        entry.responses.set(target, {
          catId: target,
          content: '',
          timestamp: Date.now(),
          status: 'timeout',
        })
      }
    }

    this.transition(requestId, 'timeout')
  }

  handleFailure(requestId: string, _reason: string): void {
    this.transition(requestId, 'failed')
  }

  getStatus(requestId: string): MultiMentionStatus {
    const entry = this.entries.get(requestId)
    if (!entry) throw new Error(`Multi-mention request not found: ${requestId}`)
    return entry.request.status
  }

  getResult(requestId: string): MultiMentionResult {
    const entry = this.entries.get(requestId)
    if (!entry) throw new Error(`Multi-mention request not found: ${requestId}`)

    return {
      request: entry.request,
      responses: [...entry.responses.values()],
    }
  }

  /** 反级联守卫：检查某 cat 是否为某线程正在运行的 multi-mention 靶点。 */
  isActiveTarget(threadId: string, catId: CatId): boolean {
    for (const entry of this.entries.values()) {
      if (
        entry.request.threadId === threadId &&
        !MULTI_MENTION_TERMINAL_STATES.has(entry.request.status) &&
        entry.request.status !== 'pending' &&
        entry.request.targets.includes(catId)
      ) {
        return true
      }
    }
    return false
  }

  findActiveByThread(threadId: string): MultiMentionRequest[] {
    const results: MultiMentionRequest[] = []
    for (const entry of this.entries.values()) {
      if (entry.request.threadId === threadId && !MULTI_MENTION_TERMINAL_STATES.has(entry.request.status)) {
        results.push(entry.request)
      }
    }
    return results
  }

  // ── Dispatch controller 生命周期 ──────────────────────────────────

  registerDispatch(requestId: string, catId: CatId, controller: AbortController): void {
    this.dispatchControllers.set(`${requestId}:${catId as string}`, controller)
  }

  unregisterDispatch(requestId: string, catId: CatId): void {
    this.dispatchControllers.delete(`${requestId}:${catId as string}`)
  }

  /** 中止线程下所有活跃 dispatch（stop 按钮/抢占/线程取消）。 */
  abortByThread(threadId: string): number {
    let aborted = 0
    for (const entry of this.entries.values()) {
      if (entry.request.threadId !== threadId) continue
      if (MULTI_MENTION_TERMINAL_STATES.has(entry.request.status)) continue
      for (const target of entry.request.targets) {
        const key = `${entry.request.id}:${target as string}`
        const controller = this.dispatchControllers.get(key)
        if (controller && !controller.signal.aborted) {
          controller.abort()
          aborted++
        }
      }
    }
    return aborted
  }

  /** F108: 中止线程内特定 cat 的 dispatch（槽级取消）。 */
  abortBySlot(threadId: string, catId: CatId): number {
    let aborted = 0
    for (const entry of this.entries.values()) {
      if (entry.request.threadId !== threadId) continue
      if (MULTI_MENTION_TERMINAL_STATES.has(entry.request.status)) continue
      const key = `${entry.request.id}:${catId as string}`
      const controller = this.dispatchControllers.get(key)
      if (controller && !controller.signal.aborted) {
        controller.abort()
        aborted++
      }
    }
    return aborted
  }

  /** 线程是否有进行中的 dispatch（删除守卫用）。 */
  hasActiveDispatches(threadId: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.request.threadId !== threadId) continue
      if (MULTI_MENTION_TERMINAL_STATES.has(entry.request.status)) continue
      for (const target of entry.request.targets) {
        const key = `${entry.request.id}:${target as string}`
        if (this.dispatchControllers.has(key)) return true
      }
    }
    return false
  }

  private transition(requestId: string, to: MultiMentionStatus): void {
    const entry = this.entries.get(requestId)
    if (!entry) throw new Error(`Multi-mention request not found: ${requestId}`)

    if (!isValidTransition(entry.request.status, to)) {
      throw new Error(`Invalid multi-mention transition: ${entry.request.status} → ${to}`)
    }
    entry.request.status = to
  }
}