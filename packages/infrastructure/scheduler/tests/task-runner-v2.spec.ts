/**
 * TaskRunnerV2 / executeTaskPipeline 运行时测试（批次51 C33 收尾）。
 *
 * 覆盖：治理检查（AC-D1）+ 手动触发旁路、任务级重叠守卫、gate→execute→ledger 管线、
 * 超时与取消感知（invokeTrigger 边界语义）、自回声抑制（AC-D2）、once 退役/F280
 * 取消栅栏、动态任务 hydrate/missed-window、pre-fire defer（F167 Phase M）、
 * 任务摘要（AC-E2）、cron 槽位边界竞态守卫。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../src/schema.ts'
import { DynamicTaskStore, EmissionStore, GlobalControlStore, RunLedger } from '../src/stores.ts'
import { executeTaskPipeline, type PipelineContext } from '../src/execute-pipeline.ts'
import {
  TaskRunnerV2,
  computeSubjectPreview,
  type TaskRunnerV2Options,
} from '../src/task-runner-v2.ts'
import { computeNextCronSlot, countAdditionalDueCronSlots } from '../src/cron-utils.ts'
import type {
  DynamicTaskDef,
  GateResult,
  RunLedgerRow,
  TaskSpec_P1,
  TriggerSpec,
} from '../src/types.ts'

function makeDb() {
  const db = openDatabase(':memory:')
  return { db, ledger: new RunLedger(db), emissions: new EmissionStore(db), control: new GlobalControlStore(db), dynamic: new DynamicTaskStore(db) }
}

function makeSpec(overrides: Partial<TaskSpec_P1> & { id?: string } = {}): TaskSpec_P1 {
  const trigger: TriggerSpec = overrides.trigger ?? { type: 'interval', ms: 60_000 }
  return {
    id: overrides.id ?? 'task-1',
    profile: 'poller',
    trigger,
    admission: {
      gate: async () => ({ run: true, workItems: [{ signal: 'sig', subjectKey: 'pr:o/r#1' }] }) satisfies GateResult,
    },
    run: {
      overlap: 'skip',
      timeoutMs: 1000,
      execute: async () => {},
    },
    state: { runLedger: 'sqlite' },
    outcome: { whenNoSignal: 'record' },
    enabled: () => true,
    ...overrides,
  } as TaskSpec_P1
}

function makeRunner(overrides: Partial<TaskRunnerV2Options> = {}, dbDeps?: ReturnType<typeof makeDb>): { runner: TaskRunnerV2; deps: ReturnType<typeof makeDb>; logs: string[] } {
  const deps = dbDeps ?? makeDb()
  const logs: string[] = []
  const runner = new TaskRunnerV2({
    logger: { info: (m) => logs.push(m), error: (m) => logs.push(m) },
    ledger: deps.ledger,
    globalControlStore: deps.control,
    emissionStore: deps.emissions,
    dynamicTaskStore: deps.dynamic,
    ...overrides,
  })
  return { runner, deps, logs }
}

function rows(deps: ReturnType<typeof makeDb>, taskId = 'task-1') {
  return deps.ledger.query(taskId, 50)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('executeTaskPipeline 治理与守卫', () => {
  it('enabled=false 直接返回，无台账行', async () => {
    const { runner, deps } = makeRunner()
    const spec = makeSpec({ enabled: () => false })
    await executeTaskPipeline({ task: spec, ledger: deps.ledger, logger: console, running: new Map(), tickCounts: new Map(), lastRunAt: new Map() })
    expect(rows(deps)).toHaveLength(0)
    expect(runner).toBeDefined()
  })

  it('全局暂停 → SKIP_GLOBAL_PAUSE；手动触发旁路治理检查', async () => {
    const deps = makeDb()
    deps.control.setGlobalEnabled(false, 'pause', 'tester')
    const ctx = (manual?: boolean): PipelineContext => ({
      task: makeSpec(),
      ledger: deps.ledger,
      logger: { info: () => {}, error: () => {} },
      running: new Map(),
      tickCounts: new Map(),
      lastRunAt: new Map(),
      globalControlStore: deps.control,
      isManualTrigger: manual,
    })
    await executeTaskPipeline(ctx())
    expect(rows(deps)[0]?.outcome).toBe('SKIP_GLOBAL_PAUSE')
    await executeTaskPipeline(ctx(true))
    // ledger.query 按 id DESC 返回（最新在前）
    expect(rows(deps)[0]?.outcome).toBe('RUN_DELIVERED')
    expect(rows(deps)[0]?.trigger_kind).toBe('manual')
    expect(rows(deps)[1]?.outcome).toBe('SKIP_GLOBAL_PAUSE')
  })

  it('任务级 override 禁用 → SKIP_TASK_OVERRIDE', async () => {
    const deps = makeDb()
    deps.control.setTaskOverride('task-1', false, 'tester')
    await executeTaskPipeline({ task: makeSpec(), ledger: deps.ledger, logger: { info: () => {}, error: () => {} }, running: new Map(), tickCounts: new Map(), lastRunAt: new Map(), globalControlStore: deps.control })
    expect(rows(deps)[0]?.outcome).toBe('SKIP_TASK_OVERRIDE')
  })

  it('任务级重叠守卫 → SKIP_OVERLAP', async () => {
    const deps = makeDb()
    const running = new Map<string, boolean>([['task-1', true]])
    await executeTaskPipeline({ task: makeSpec(), ledger: deps.ledger, logger: { info: () => {}, error: () => {} }, running, tickCounts: new Map(), lastRunAt: new Map() })
    expect(rows(deps)[0]?.outcome).toBe('SKIP_OVERLAP')
  })

  it('gate 不放行：whenNoSignal=record 记 SKIP_NO_SIGNAL，drop 则无行', async () => {
    const deps = makeDb()
    const base = { ledger: deps.ledger, logger: { info: () => {}, error: () => {} }, running: new Map(), tickCounts: new Map(), lastRunAt: new Map() }
    const specRecord = makeSpec({ admission: { gate: async () => ({ run: false, reason: 'no signal' }) } })
    await executeTaskPipeline({ ...base, task: specRecord })
    expect(rows(deps)[0]?.outcome).toBe('SKIP_NO_SIGNAL')
    const specDrop = makeSpec({ outcome: { whenNoSignal: 'drop' }, admission: { gate: async () => ({ run: false, reason: 'no signal' }) } })
    await executeTaskPipeline({ ...base, task: specDrop })
    expect(rows(deps)).toHaveLength(1)
  })
})

describe('executeTaskPipeline 执行与台账', () => {
  it('成功执行：RUN_DELIVERED + actor 解析 + signal_summary 截断', async () => {
    const deps = makeDb()
    const seen: Array<{ signal: unknown; subjectKey: string }> = []
    const spec = makeSpec({
      actor: { role: 'repo-watcher', costTier: 'cheap' },
      admission: { gate: async () => ({ run: true, workItems: [{ signal: { big: 'x'.repeat(300) }, subjectKey: 'pr:o/r#2' }] }) },
      run: { overlap: 'skip', timeoutMs: 1000, execute: async (signal, subjectKey) => { seen.push({ signal, subjectKey }) } },
    })
    await executeTaskPipeline({
      task: spec, ledger: deps.ledger, logger: { info: () => {}, error: () => {} },
      running: new Map(), tickCounts: new Map(), lastRunAt: new Map(),
      actorResolver: (role, tier) => `${role}:${tier}:cat-7`,
    })
    const row = rows(deps, 'task-1')[0]
    expect(row?.outcome).toBe('RUN_DELIVERED')
    expect(row?.assigned_cat_id).toBe('repo-watcher:cheap:cat-7')
    expect(row?.signal_summary).toHaveLength(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.subjectKey).toBe('pr:o/r#2')
  })

  it('execute 抛错 → RUN_FAILED + error_summary', async () => {
    const deps = makeDb()
    const spec = makeSpec({ run: { overlap: 'skip', timeoutMs: 1000, execute: async () => { throw new Error('boom') } } })
    await executeTaskPipeline({ task: spec, ledger: deps.ledger, logger: { info: () => {}, error: () => {} }, running: new Map(), tickCounts: new Map(), lastRunAt: new Map() })
    expect(rows(deps)[0]?.outcome).toBe('RUN_FAILED')
    expect(rows(deps)[0]?.error_summary).toBe('boom')
  })

  it('执行超时 → RUN_FAILED 且 execute 收到 abort 信号', async () => {
    const deps = makeDb()
    const signals: Array<boolean> = []
    const spec = makeSpec({
      run: {
        overlap: 'skip',
        timeoutMs: 20,
        execute: async (_signal, _subjectKey, ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 500))
          signals.push(ctx.signal.aborted)
        },
      },
    })
    const pipeline = executeTaskPipeline({ task: spec, ledger: deps.ledger, logger: { info: () => {}, error: () => {} }, running: new Map(), tickCounts: new Map(), lastRunAt: new Map() })
    await vi.advanceTimersByTimeAsync(600)
    await pipeline
    expect(rows(deps)[0]?.outcome).toBe('RUN_FAILED')
    expect(rows(deps)[0]?.error_summary).toContain('timed out')
    expect(signals[0]).toBe(true)
  })

  it('自回声抑制（AC-D2）：抑制期内 SKIP_SELF_ECHO，成功后写入 emission', async () => {
    const deps = makeDb()
    deps.emissions.record({ originTaskId: 'task-1', threadId: 't1', messageId: 'm0', suppressionMs: 60_000 })
    const spec = makeSpec({ admission: { gate: async () => ({ run: true, workItems: [{ signal: 's', subjectKey: 'thread-t1' }] }) } })
    const ctx = (): PipelineContext => ({ task: spec, ledger: deps.ledger, logger: { info: () => {}, error: () => {} }, running: new Map(), tickCounts: new Map(), lastRunAt: new Map(), emissionStore: deps.emissions })
    await executeTaskPipeline(ctx())
    expect(rows(deps)[0]?.outcome).toBe('SKIP_SELF_ECHO')
    await vi.advanceTimersByTimeAsync(61_000)
    await executeTaskPipeline(ctx())
    expect(rows(deps)[0]?.outcome).toBe('RUN_DELIVERED')
    expect(rows(deps)[1]?.outcome).toBe('SKIP_SELF_ECHO')
    // 成功执行写入新 emission（interval 触发器 → suppressionMs = max(ms*2, 60s) = 120s，仍活跃）
    expect(deps.emissions.listActive()).toHaveLength(1)
    // cleanup 只删过期行：第一条（60s）已过期被清，第二条（120s）保留
    expect(deps.emissions.cleanup()).toBe(1)
    expect(deps.emissions.listActive()).toHaveLength(1)
  })

  it('取消感知 invokeTrigger：已投递 messageId 的触发允许结算，无关触发 fail-fast', async () => {
    const deps = makeDb()
    const triggerResults: Array<'ok' | 'thrown'> = []
    const invokeTrigger = {
      trigger: async (_threadId: string, _catId: string, _userId: string, _message: string, messageId: string) => {
        return messageId === 'mine' ? ('dispatched' as const) : Promise.reject(new Error('late trigger'))
      },
    }
    const spec = makeSpec({
      run: {
        overlap: 'skip',
        timeoutMs: 20,
        execute: async (_signal, _subjectKey, ctx) => {
          // 超时前投递：messageId 'mine' 进入 deliveredMessageIds
          const delivered = await ctx.deliver?.({ threadId: 'th', content: 'c', userId: 'u' })
          await new Promise((resolve) => setTimeout(resolve, 500))
          // 超时后结算：同一 work item 已投递消息的触发是投递的有界完成
          try {
            await ctx.invokeTrigger?.trigger('th', 'cat', 'user', 'msg', delivered ?? '')
            triggerResults.push('ok')
          } catch {
            triggerResults.push('thrown')
          }
          try {
            await ctx.invokeTrigger?.trigger('th', 'cat', 'user', 'msg', 'other')
            triggerResults.push('ok')
          } catch {
            triggerResults.push('thrown')
          }
        },
      },
    })
    const pipeline = executeTaskPipeline({
      task: spec, ledger: deps.ledger, logger: { info: () => {}, error: () => {} },
      running: new Map(), tickCounts: new Map(), lastRunAt: new Map(), invokeTrigger,
      deliver: async () => 'mine',
    })
    await vi.advanceTimersByTimeAsync(600)
    await pipeline
    expect(triggerResults).toEqual(['ok', 'thrown'])
    expect(rows(deps)[0]?.outcome).toBe('RUN_FAILED')
  })
})

describe('TaskRunnerV2', () => {
  it('重复注册抛错；unregister 清理', () => {
    const { runner } = makeRunner()
    runner.register(makeSpec({ id: 'a' }))
    expect(() => runner.register(makeSpec({ id: 'a' }))).toThrow('duplicate task id')
    expect(runner.getRegisteredTasks()).toEqual(['a'])
    expect(runner.unregister('a')).toBe(true)
    expect(runner.unregister('a')).toBe(false)
  })

  it('once 任务触发后自动退役并移除持久化 def', async () => {
    const { runner, deps } = makeRunner()
    deps.dynamic.insert({
      id: 'once-1', templateId: 'reminder', trigger: { type: 'once', fireAt: Date.now() + 10 },
      params: {}, display: { label: 'L', category: 'system', subjectKind: 'none' },
      deliveryThreadId: null, enabled: true, createdBy: 'user', createdAt: new Date().toISOString(),
    })
    runner.registerDynamic(makeSpec({ id: 'once-1', trigger: { type: 'once', fireAt: Date.now() + 10 } }), 'once-1')
    runner.start()
    await vi.advanceTimersByTimeAsync(50)
    expect(rows(deps, 'once-1')[0]?.outcome).toBe('RUN_DELIVERED')
    expect(runner.getRegisteredTasks()).not.toContain('once-1')
    expect(deps.dynamic.getById('once-1')).toBeNull()
  })

  it('F280 取消栅栏：reserved 后 triggerNow 返回 cancellation_pending，release 后重排', async () => {
    const { runner, deps } = makeRunner()
    runner.register(makeSpec({ id: 'once-2', trigger: { type: 'once', fireAt: Date.now() + 5_000 } }))
    const reservation = runner.reserveOnceCancellation('once-2')
    expect(reservation).toMatchObject({ outcome: 'reserved' })
    runner.start()
    await expect(runner.triggerNow('once-2')).resolves.toBe('cancellation_pending')
    expect(rows(deps, 'once-2')).toHaveLength(0)
    expect(runner.releaseOnceCancellation('once-2', reservation.outcome === 'reserved' ? reservation.token : -1)).toBe(true)
    // 错误 token 拒绝；释放后栅栏清空，可重新预约
    expect(runner.releaseOnceCancellation('once-2', 999_999)).toBe(false)
    expect(runner.reserveOnceCancellation('once-2').outcome).toBe('reserved')
  })

  it('hydrateDynamic：加载启用 def；过期 once 记 SKIP_MISSED_WINDOW 并退役 + missed-window 通知', async () => {
    const notifications: Array<Record<string, unknown>> = []
    const { runner, deps } = makeRunner()
    const missed: DynamicTaskDef = {
      id: 'missed-1', templateId: 'reminder', trigger: { type: 'once', fireAt: Date.now() - 60_000 },
      params: { triggerUserId: 'u1' }, display: { label: '错过', category: 'system', subjectKind: 'none' },
      deliveryThreadId: 'th-1', enabled: true, createdBy: 'user', createdAt: new Date().toISOString(),
    }
    const live: DynamicTaskDef = {
      id: 'live-1', templateId: 'reminder', trigger: { type: 'interval', ms: 60_000 },
      params: {}, display: { label: '活着', category: 'system', subjectKind: 'none' },
      deliveryThreadId: null, enabled: true, createdBy: 'user', createdAt: new Date().toISOString(),
    }
    deps.dynamic.insert(missed)
    deps.dynamic.insert(live)
    const loaded = runner.hydrateDynamic(deps.dynamic, {
      get: (templateId) => templateId === 'reminder'
        ? {
            templateId: 'reminder', label: '提醒', category: 'system', description: '', subjectKind: 'none',
            defaultTrigger: { type: 'interval', ms: 60_000 },
            paramSchema: {},
            createSpec: (instanceId) => makeSpec({ id: instanceId }),
          }
        : null,
    })
    expect(loaded).toBe(1)
    expect(runner.getRegisteredTasks()).toEqual(['live-1'])
    expect(rows(deps, 'missed-1')[0]?.outcome).toBe('SKIP_MISSED_WINDOW')
    expect(deps.dynamic.getById('missed-1')).toBeNull()
    // missed-window 的 toast 通知路径：单独 runner 挂 notifyLifecycle 再 hydrate
    deps.dynamic.insert(missed)
    const runner2 = new TaskRunnerV2({
      logger: { info: () => {}, error: () => {} },
      ledger: deps.ledger,
      notifyLifecycle: (n) => notifications.push(n as unknown as Record<string, unknown>),
    })
    runner2.hydrateDynamic(deps.dynamic, { get: () => null })
    expect(notifications).toHaveLength(1)
    const toast = notifications[0]?.toast as Record<string, unknown>
    expect(toast?.lifecycleEvent).toBe('missed_window')
    expect(notifications[0]?.userId).toBe('u1')
  })

  it('pre-fire defer：忙线程重排，maxDefers 耗尽后强发', async () => {
    const { runner, deps } = makeRunner()
    const busy = true
    runner.setBusyChecker(() => busy)
    runner.register(makeSpec({
      id: 'defer-1',
      trigger: { type: 'once', fireAt: Date.now() + 10 },
      firePolicy: { deferWhileThreadBusy: true, threadId: 'th', deferIntervalMs: 10, maxDefers: 2 },
    }))
    runner.start()
    // maxDefers=2：前两次 defer（10ms/20ms），第三次（30ms）达到上限强发——忙线程也执行
    await vi.advanceTimersByTimeAsync(100)
    expect(rows(deps, 'defer-1')).toHaveLength(1)
    expect(rows(deps, 'defer-1')[0]?.outcome).toBe('RUN_DELIVERED')
    expect(busy).toBe(true)
  })

  it('triggerNow 手动触发 + 任务摘要 effectiveEnabled/subjectPreview', async () => {
    const { runner, deps } = makeRunner()
    deps.control.setGlobalEnabled(false, 'paused', 'tester')
    runner.register(makeSpec({
      id: 'sum-1',
      display: { label: 'PR 守望', category: 'pr', subjectKind: 'pr' },
      admission: { gate: async () => ({ run: true, workItems: [{ signal: 's', subjectKey: 'pr:o/r#42' }] }) },
    }))
    runner.start()
    await expect(runner.triggerNow('sum-1', { manual: true })).resolves.toBe('executed')
    const summary = runner.getTaskSummaries()[0]
    expect(summary?.enabled).toBe(true)
    expect(summary?.effectiveEnabled).toBe(false) // 全局暂停生效
    expect(summary?.source).toBe('builtin')
    expect(summary?.subjectPreview).toBe('o/r#42')
    expect(computeSubjectPreview('thread', { ...makeLedgerRow(), subject_key: 'thread-abcdef12' })).toBe('Thread abcdef12…')
    expect(computeSubjectPreview('none', makeLedgerRow())).toBeNull()
  })

  it('运行级失败通知：每 tick 一条（#415 P2）', async () => {
    const toasts: Array<Record<string, unknown>> = []
    const { runner, deps } = makeRunner({
      notifyLifecycle: (n) => toasts.push(n as unknown as Record<string, unknown>),
    })
    deps.dynamic.insert({
      id: 'notify-1', templateId: 'custom', trigger: { type: 'interval', ms: 60_000 },
      params: { triggerUserId: 'u9' }, display: { label: '通知任务', category: 'system', subjectKind: 'none' },
      deliveryThreadId: 'th-9', enabled: true, createdBy: 'user', createdAt: new Date().toISOString(),
    })
    runner.registerDynamic(makeSpec({
      id: 'notify-1',
      run: { overlap: 'skip', timeoutMs: 1000, execute: async () => { throw new Error(' explodes ') } },
    }), 'notify-1')
    await runner.triggerNow('notify-1')
    expect(toasts).toHaveLength(1)
    const toast = (toasts[0]?.toast as Record<string, unknown>)
    expect(toast?.type).toBe('error')
    expect(toast?.lifecycleEvent).toBe('failed')
  })
})

function makeLedgerRow(): RunLedgerRow {
  return {
    task_id: 't', subject_key: 'pr:o/r#1', outcome: 'RUN_DELIVERED', signal_summary: 's',
    duration_ms: 1, started_at: 0, assigned_cat_id: null, error_summary: null,
  }
}

describe('cron-utils 边界竞态守卫', () => {
  it('computeNextCronSlot 严格越过 lastFiredSlotMs', () => {
    const now = Date.UTC(2026, 8, 5, 12, 0, 30)
    const first = computeNextCronSlot('* * * * *', undefined, now, undefined)
    expect(first % 60_000).toBe(0)
    const next = computeNextCronSlot('* * * * *', undefined, now, first)
    expect(next).toBe(first + 60_000)
  })

  it('非法表达式抛错；脏的远期 lastFired 触发迭代上限', () => {
    const now = Date.UTC(2026, 8, 5, 12, 0, 30)
    expect(() => computeNextCronSlot('not-a-cron', undefined, now, undefined)).toThrow()
    const dirty = now + 100 * 365 * 24 * 3600 * 1000
    expect(() => computeNextCronSlot('* * * * *', undefined, now, dirty)).toThrow('iterations')
  })

  it('countAdditionalDueCronSlots 记账合并槽位数', () => {
    const scheduled = Date.UTC(2026, 8, 5, 12, 0, 0)
    const fired = scheduled + 3 * 60_000 + 500
    expect(countAdditionalDueCronSlots('* * * * *', undefined, scheduled, fired)).toBe(3)
    expect(countAdditionalDueCronSlots('* * * * *', undefined, scheduled, scheduled)).toBe(0)
  })
})
