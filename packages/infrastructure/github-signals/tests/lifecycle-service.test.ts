/**
 * GitHubWaitLifecycleService 契约：observe / cancel / ownerChanged / recover 端到端路径，
 * 使用真实的内存端口实现（关键路径不作伪造）。
 *
 * @flowforge/infrastructure-github-signals/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { GitHubWaitLifecycleService } from '../src/GitHubWaitLifecycleService.ts'
import type { GitHubWaitFacts } from '../src/GitHubWaitPredicateCatalog.ts'
import { MemoryTaskStore } from '../src/ports/ITaskStore.ts'
import { MemoryConnectorDelivery } from '../src/ports/ConnectorDelivery.ts'
import { MemoryWaitLifecycleEventLog } from '../src/ports/IWaitLifecycleEventLog.ts'
import type { WaitRuntimeState } from '../src/wait-state-machine.ts'
import { makeIssueTask, makePrTask } from './fixtures.ts'

function setup() {
  const taskStore = new MemoryTaskStore()
  const delivery = new MemoryConnectorDelivery()
  const eventLog = new MemoryWaitLifecycleEventLog()
  const info = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()
  const service = new GitHubWaitLifecycleService({
    taskStore,
    deliveryDeps: delivery,
    eventLog,
    now: () => 1000,
    log: { info, warn, error },
  })
  return { service, taskStore, delivery, eventLog, info, warn, error }
}

function prAdvance(): GitHubWaitFacts {
  return {
    headSha: 'aaaaaaa',
    review: { decisionCursor: 6, decision: 'APPROVED', reviewer: 'korra' },
  }
}

describe('GitHubWaitLifecycleService.observe — 谓词匹配 → 通知', () => {
  it('terminalizes and delivers a matched PR pending outcome', async () => {
    const { service, taskStore, delivery, eventLog } = setup()
    taskStore.seed(makePrTask())
    const result = await service.observe({ taskId: 'task-pr-1', facts: prAdvance() })
    expect(result.kind).toBe('notified')
    if (result.kind !== 'notified') return
    expect(result.outcome.reason).toBe('matched')
    expect(result.outcome.delivery).toBe('pending') // pre-delivery outcome carried on the result
    expect(delivery.delivered).toHaveLength(1)
    const events = await eventLog.read('task-pr-1')
    expect(events).toHaveLength(1)
    expect(events[0]!.reason).toBe('matched')
    const stored = taskStore.get('task-pr-1')!
    expect(stored.automationState?.await).toBeUndefined()
    expect(stored.automationState?.waitOutcome?.delivery).toBe('delivered')
  })

  it('returns state_only when no predicate matches before expiry', async () => {
    const { service, taskStore } = setup()
    taskStore.seed(makePrTask())
    const result = await service.observe({
      taskId: 'task-pr-1',
      facts: { headSha: 'aaaaaaa', review: { decisionCursor: 5 } },
    })
    expect(result.kind).toBe('state_only')
  })
})

describe('GitHubWaitLifecycleService.observe — subject_terminal', () => {
  it('terminalizes a PR as merged and notifies', async () => {
    const { service, taskStore, delivery } = setup()
    taskStore.seed(makePrTask())
    const result = await service.observe({ taskId: 'task-pr-1', facts: {}, subjectState: 'merged' })
    expect(result.kind).toBe('notified')
    if (result.kind !== 'notified') return
    expect(result.outcome.reason).toBe('subject_terminal')
    expect(result.outcome.terminalSubjectState).toBe('merged')
    expect(delivery.delivered).toHaveLength(1)
  })

  it('marks the task done when subject is terminal but no active wait exists', async () => {
    const { service, taskStore } = setup()
    taskStore.seed({ ...makeIssueTask(), automationState: undefined })
    const result = await service.observe({
      taskId: 'task-issue-1',
      facts: { issue: { state: 'open', comments: [] } },
      subjectState: 'closed',
    })
    expect(result.kind).toBe('state_only')
    expect(taskStore.get('task-issue-1')!.status).toBe('done')
  })
})

describe('GitHubWaitLifecycleService.observe — not tracked / no active wait', () => {
  it('returns not_tracked for a missing task', async () => {
    const { service } = setup()
    const result = await service.observe({ taskId: 'missing', facts: {} })
    expect(result.kind).toBe('not_tracked')
  })

  it('returns state_only when there is no active wait', async () => {
    const { service, taskStore } = setup()
    taskStore.seed({ ...makeIssueTask(), automationState: undefined })
    const result = await service.observe({
      taskId: 'task-issue-1',
      facts: { issue: { state: 'open', comments: [] } },
    })
    expect(result.kind).toBe('state_only')
  })
})

describe('GitHubWaitLifecycleService.cancel / ownerChanged', () => {
  it('cancels an active wait with a user actor', async () => {
    const { service, taskStore, eventLog } = setup()
    taskStore.seed(makeIssueTask())
    const result = await service.cancel('task-issue-1', { kind: 'user', userId: 'user-2' }, 500)
    expect(result.kind).toBe('state_only')
    const stored = taskStore.get('task-issue-1')!
    expect(stored.automationState?.await).toBeUndefined()
    expect(stored.automationState?.waitOutcome?.reason).toBe('user_cancel')
    const events = await eventLog.read('task-issue-1')
    expect(events[0]?.actor).toEqual({ kind: 'user', userId: 'user-2' })
  })

  it('ownerChanged terminalizes with an owner_changed reason', async () => {
    const { service, taskStore } = setup()
    const bumped: WaitRuntimeState = {
      await: { ...makePrTask().automationState!.await!, ownerFence: { kind: 'containing_task', generation: 2 } },
    }
    taskStore.seed({ ...makePrTask(), automationState: bumped })
    const result = await service.ownerChanged('task-pr-1', 700)
    expect(result.kind).toBe('state_only')
    expect(taskStore.get('task-pr-1')!.automationState?.waitOutcome?.reason).toBe('owner_changed')
  })
})

describe('GitHubWaitLifecycleService.recoverOutcome', () => {
  it('recovers and delivers a pending outcome on an already-terminalized task', async () => {
    const { service, taskStore, delivery } = setup()
    const pending: WaitRuntimeState = {
      waitOutcome: {
        v: 1,
        outcomeId: 'wait:pr:acme/omega#7:g1:matched',
        generation: 1,
        subjectRef: 'pr:acme/omega#7',
        ownerFence: { kind: 'containing_task', generation: 1 },
        reason: 'matched',
        at: 600,
        delivery: 'pending',
        matched: [{ kind: 'pr_review_decision_changed', delta: 'APPROVED' }],
      },
    }
    taskStore.seed({ ...makePrTask(), automationState: pending })
    const result = await service.recoverOutcome('task-pr-1')
    expect(result.kind).toBe('notified')
    expect(delivery.delivered).toHaveLength(1)
    expect(taskStore.get('task-pr-1')!.automationState?.waitOutcome?.delivery).toBe('delivered')
  })

  it('returns state_only when there is nothing to recover', async () => {
    const { service, taskStore } = setup()
    taskStore.seed(makePrTask())
    const result = await service.recoverOutcome('task-pr-1')
    expect(result.kind).toBe('state_only')
  })
})