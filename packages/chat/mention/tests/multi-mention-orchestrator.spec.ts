/**
 * multi-mention-orchestrator — F086 M1 多 @ 并发编排契约验证（阶段5 批次5，T5.3.2）。
 *
 * 覆盖 clowder-ai `MultiMentionOrchestrator.ts` / `multi-mention-state-machine.ts`：
 * - 状态机：pending→running→partial→done/timeout/failed 合法转移 + 非法转移抛错
 * - create：目标数/超时分钟边界校验 + idempotencyKey 幂等重放
 * - recordResponse：done/partial 判定、非目标忽略、重复响应忽略、终态忽略
 * - handleTimeout：缺失目标准时标记 + timeout 转移
 * - 反级联 isActiveTarget + abortByThread/abortBySlot 取消传播
 *
 * @module @flowforge/chat-mention/tests
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_MULTI_MENTION_TARGETS,
  MIN_TIMEOUT_MINUTES,
  MAX_TIMEOUT_MINUTES,
  type CatId,
} from '@flowforge/cats-shared'
import {
  getAllowedTransitions,
  isValidTransition,
  MultiMentionOrchestrator,
  type MultiMentionCreateParams,
} from '../src/index.ts'

const catA = 'cat-a' as CatId
const catB = 'cat-b' as CatId
const catC = 'cat-c' as CatId

function params(overrides: Partial<MultiMentionCreateParams> = {}): MultiMentionCreateParams {
  return {
    threadId: 't1',
    initiator: catA,
    callbackTo: catA,
    targets: [catB, catC],
    question: '谁来做？',
    timeoutMinutes: 8,
    ...overrides,
  }
}

function freshOrchestrator(): MultiMentionOrchestrator {
  return new MultiMentionOrchestrator()
}

describe('multi-mention-state-machine', () => {
  it('合法转移通过', () => {
    expect(isValidTransition('pending', 'running')).toBe(true)
    expect(isValidTransition('running', 'done')).toBe(true)
    expect(isValidTransition('running', 'partial')).toBe(true)
    expect(isValidTransition('partial', 'timeout')).toBe(true)
  })

  it('非法转移被拒绝', () => {
    expect(isValidTransition('pending', 'done')).toBe(false)
    expect(isValidTransition('done', 'partial')).toBe(false)
    expect(isValidTransition('running', 'pending')).toBe(false)
    expect(isValidTransition('timeout', 'done')).toBe(false)
  })

  it('getAllowedTransitions 返回该状态出边', () => {
    expect(getAllowedTransitions('pending').sort()).toEqual(['failed', 'running'])
    expect(getAllowedTransitions('done')).toEqual([])
  })
})

describe('create', () => {
  it('生成 pending 请求并带初始字段', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    expect(req.status).toBe('pending')
    expect(req.threadId).toBe('t1')
    expect(req.initiator).toBe(catA)
    expect(req.targets).toEqual([catB, catC])
    expect(req.timeoutMinutes).toBe(8)
  })

  it('目标数为 0 或超上限抛错', () => {
    const orch = freshOrchestrator()
    expect(() => orch.create(params({ targets: [] }))).toThrow(/targets must have 1-3/)
    const tooMany = Array.from({ length: MAX_MULTI_MENTION_TARGETS + 1 }).map((_, i) => `cat-${i}` as CatId)
    expect(() => orch.create(params({ targets: tooMany }))).toThrow(/targets must have 1-3/)
  })

  it('超时分钟越界抛错', () => {
    const orch = freshOrchestrator()
    expect(() => orch.create(params({ timeoutMinutes: MIN_TIMEOUT_MINUTES - 1 }))).toThrow(/timeout must be 3-20/)
    expect(() => orch.create(params({ timeoutMinutes: MAX_TIMEOUT_MINUTES + 1 }))).toThrow(/timeout must be 3-20/)
  })

  it('idempotencyKey 幂等重放返回同一请求', () => {
    const orch = freshOrchestrator()
    const a = orch.create(params({ idempotencyKey: 'k1' }))
    const b = orch.create(params({ idempotencyKey: 'k1' }))
    const c = orch.create(params({ idempotencyKey: 'k2' }))
    expect(b.id).toBe(a.id)
    expect(c.id).not.toBe(a.id)
  })

  it('可选字段按 presence 展开', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params({ context: 'ctx', triggerType: 'high-impact', overrideReason: 'override' }))
    expect(req.context).toBe('ctx')
    expect(req.triggerType).toBe('high-impact')
    expect(req.overrideReason).toBe('override')
  })
})

describe('start + recordResponse', () => {
  it('start 将 pending 置于 running', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    expect(orch.getStatus(req.id)).toBe('running')
  })

  it('全部回复 → done，部分回复 → partial', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    expect(orch.recordResponse(req.id, catB, 'x')).toBe('partial')
    expect(orch.recordResponse(req.id, catC, 'y')).toBe('done')
  })

  it('非目标 cat 响应被忽略', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    expect(orch.recordResponse(req.id, catA, 'x')).toBe('running')
  })

  it('同一 cat 重复响应被忽略', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    orch.recordResponse(req.id, catB, 'x')
    expect(orch.recordResponse(req.id, catB, 'y')).toBe('partial')
    expect(orch.getResult(req.id).responses.filter((r) => r.catId === catB)[0]?.content).toBe('x')
  })

  it('终态后响应被忽略', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    orch.recordResponse(req.id, catB, 'x')
    orch.recordResponse(req.id, catC, 'y')
    expect(orch.recordResponse(req.id, catB, 'z')).toBe('done')
  })

  it('不存在的 requestId 抛错', () => {
    const orch = freshOrchestrator()
    expect(() => orch.recordResponse('nope', catB, 'x')).toThrow(/not found/)
    expect(() => orch.getStatus('nope')).toThrow(/not found/)
  })
})

describe('handleTimeout / handleFailure', () => {
  it('超时标记缺失目标并转移 timeout', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    orch.recordResponse(req.id, catB, 'x')
    orch.handleTimeout(req.id)
    expect(orch.getStatus(req.id)).toBe('timeout')
    const result = orch.getResult(req.id)
    const missing = result.responses.find((r) => r.catId === catC)
    expect(missing?.status).toBe('timeout')
  })

  it('终态不再被 handleTimeout 覆盖', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    orch.recordResponse(req.id, catB, 'x')
    orch.recordResponse(req.id, catC, 'y')
    orch.handleTimeout(req.id)
    expect(orch.getStatus(req.id)).toBe('done')
  })

  it('handleFailure 转移 failed', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    orch.handleFailure(req.id, 'boom')
    expect(orch.getStatus(req.id)).toBe('failed')
  })

  it('pending 直接 failed 合法（状态机允许）', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.handleFailure(req.id, 'boom')
    expect(orch.getStatus(req.id)).toBe('failed')
  })
})

describe('cancel（abort）/ 反级联', () => {
  it('isActiveTarget 在运行/部分态为 true', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    expect(orch.isActiveTarget('t1', catB)).toBe(true)
    expect(orch.isActiveTarget('t1', catC)).toBe(true)
    orch.recordResponse(req.id, catB, 'x')
    orch.recordResponse(req.id, catC, 'y')
    expect(orch.isActiveTarget('t1', catB)).toBe(false)
  })

  it('pending 非活跃靶点（防级联排除 pending）', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    void req
    expect(orch.isActiveTarget('t1', catB)).toBe(false)
  })

  it('abortByThread 中止线程下所有活跃 dispatch', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    const c1 = new AbortController()
    const c2 = new AbortController()
    orch.registerDispatch(req.id, catB, c1)
    orch.registerDispatch(req.id, catC, c2)
    const aborted = orch.abortByThread('t1')
    expect(aborted).toBe(2)
    expect(c1.signal.aborted).toBe(true)
    expect(c2.signal.aborted).toBe(true)
  })

  it('abortBySlot 只中止指定 cat（F108）', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    const c1 = new AbortController()
    const c2 = new AbortController()
    orch.registerDispatch(req.id, catB, c1)
    orch.registerDispatch(req.id, catC, c2)
    const aborted = orch.abortBySlot('t1', catB)
    expect(aborted).toBe(1)
    expect(c1.signal.aborted).toBe(true)
    expect(c2.signal.aborted).toBe(false)
  })

  it('unregisterDispatch 后 abort 不再命中', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    const c1 = new AbortController()
    orch.registerDispatch(req.id, catB, c1)
    orch.unregisterDispatch(req.id, catB)
    expect(orch.abortByThread('t1')).toBe(0)
    expect(c1.signal.aborted).toBe(false)
  })

  it('hasActiveDispatches 反映是否有未完成 dispatch', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    expect(orch.hasActiveDispatches('t1')).toBe(false)
    orch.registerDispatch(req.id, catB, new AbortController())
    expect(orch.hasActiveDispatches('t1')).toBe(true)
  })

  it('findActiveByThread 返回某线程非终态请求', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    expect(orch.findActiveByThread('t1').map((r) => r.id)).toEqual([req.id])
    expect(orch.findActiveByThread('other')).toEqual([])
  })
})

describe('getResult 聚合', () => {
  it('返回 request + responses 快照', () => {
    const orch = freshOrchestrator()
    const req = orch.create(params())
    orch.start(req.id)
    orch.recordResponse(req.id, catB, 'b')
    orch.handleTimeout(req.id)
    const result = orch.getResult(req.id)
    expect(result.request.status).toBe('timeout')
    expect(result.responses.map((r) => r.status).sort()).toEqual(['received', 'timeout'])
  })
})