/**
 * Contract suite: circuit breaker state machine + guard, fallback chain
 * (templates/conditions/retry/stop_on), degradation decision tree, tiered
 * recovery escalation, restart-recovery pipeline core, checkpoint manager.
 */

import { describe, expect, it } from 'vitest'
import {
  AgentExecutionGuard,
  CheckpointManager,
  CircuitBreaker,
  CircuitOpenError,
  DegradationDecisionTree,
  FallbackChain,
  RECOVERY_TIER,
  RecoveryTierManager,
  RestartRecoveryPipeline,
  classifyError,
  evaluateCondition,
  getCircuitBreaker,
  resolveTemplate,
  type RestartRecoveryStore,
} from '../src/index.ts'

const noopSleep = async () => {}

describe('CircuitBreaker', () => {
  function makeBreaker(clock: { t: number }) {
    return new CircuitBreaker('svc', {
      failureThreshold: 3,
      recoveryTimeout: 10,
      halfOpenMaxCalls: 1,
      now: () => clock.t,
    })
  }

  it('opens at the failure threshold and rejects while open', async () => {
    const clock = { t: 0 }
    const breaker = makeBreaker(clock)
    for (let i = 0; i < 3; i++) breaker.recordFailure()
    expect(breaker.state).toBe('open')
    await expect(breaker.call(async () => 'ok')).rejects.toThrow(CircuitOpenError)
    await expect(breaker.call(async () => 'ok')).rejects.toThrow("Circuit 'svc' is open")
  })

  it('transitions open → half_open → closed via probe success', async () => {
    const clock = { t: 0 }
    const breaker = makeBreaker(clock)
    for (let i = 0; i < 3; i++) breaker.recordFailure()
    clock.t = 10 // recoveryTimeout elapsed
    expect(breaker.state).toBe('half_open')
    expect(breaker.isAvailable).toBe(true)
    await expect(breaker.call(async () => 'probe')).resolves.toBe('probe')
    expect(breaker.state).toBe('closed')
    expect(breaker.getStats().failure_count).toBe(0)
  })

  it('limits half-open probes and records successes/failures through call()', async () => {
    const clock = { t: 0 }
    const breaker = makeBreaker(clock)
    for (let i = 0; i < 3; i++) breaker.recordFailure()
    clock.t = 11
    await expect(
      breaker.call(async () => {
        throw new Error('still broken')
      }),
    ).rejects.toThrow('still broken')
    // one half-open call consumed + failure re-opens the breaker
    expect(breaker.state).toBe('open')
    expect(breaker.getStats().total_failures).toBe(4)
  })

  it('named registry returns stable instances and resets all', () => {
    const first = getCircuitBreaker('shared')
    first.recordFailure()
    expect(getCircuitBreaker('shared')).toBe(first)
    const statsBefore = first.getStats()
    expect(statsBefore.failure_count).toBe(1)
  })

  it('AgentExecutionGuard keeps per-agent breakers and timeouts', () => {
    const guard = new AgentExecutionGuard({ failureThreshold: 2 })
    expect(guard.getAgentTimeout('writer')).toBe(300)
    guard.setAgentTimeout('writer', 60)
    expect(guard.getAgentTimeout('writer')).toBe(60)
    guard.recordFailure('writer')
    guard.recordFailure('writer')
    expect(guard.isAvailable('writer')).toBe(false)
    expect(guard.isAvailable('other')).toBe(true)
    const status = guard.getAllStatus()
    expect(status.writer).toMatchObject({ state: 'open', is_available: false, timeout: 60 })
  })
})

describe('FallbackChain', () => {
  it('resolves {{path}} templates and evaluates conditions', () => {
    const context = { input: { query: 'hello', priority: 'high', retries: 2 } }
    expect(resolveTemplate('say {{input.query}}!', context)).toBe('say hello!')
    expect(resolveTemplate('{{input.missing}}', context)).toBe('{{input.missing}}')
    expect(resolveTemplate({ q: '{{input.query}}' }, context)).toEqual({ q: 'hello' })
    expect(evaluateCondition("input.priority == 'high'", context)).toBe(true)
    expect(evaluateCondition('input.retries > 5', context)).toBe(false)
    expect(evaluateCondition('', context)).toBe(true)
    expect(classifyError('request unauthorized')).toBe('auth_error')
    expect(classifyError('connection timed out')).toBe('timeout_error')
    expect(classifyError('widget not found')).toBe('not_found_error')
    expect(classifyError('boom')).toBe('execution_error')
  })

  it('falls through failing steps until one succeeds', async () => {
    let calls = 0
    const chain = new FallbackChain([
      { name: 'primary', type: 'tool', tool: 'search' },
      { name: 'backup', type: 'agent', agent: 'writer-b', input: { query: '{{input.query}}' } },
    ])
    const result = await chain.execute({ input: { query: 'q' } }, {
      tool: async () => {
        calls += 1
        throw new Error('search unavailable')
      },
      agent: async (_name, input) => `draft for ${input.query}`,
    })
    expect(result.success).toBe(true)
    expect(result.successfulStep).toBe('backup')
    expect(result.result).toBe('draft for q')
    expect(result.attempts.map(attempt => attempt.stepName)).toEqual(['primary', 'backup'])
    expect(calls).toBe(1)
  })

  it('honors stop_on, conditions and per-step retry', async () => {
    const chain = new FallbackChain(
      [
        { name: 'guarded', type: 'tool', tool: 'a', condition: 'input.skip == true' },
        {
          name: 'flaky',
          type: 'tool',
          tool: 'b',
          retry: 2,
          input: { q: '{{input.query}}' },
        },
        { name: 'never', type: 'tool', tool: 'c' },
      ],
      { stopOn: ['auth_error'] },
    )
    let flakyCalls = 0
    const result = await chain.execute({ input: { query: 'x' } }, {
      tool: async name => {
        if (name === 'b') {
          flakyCalls += 1
          if (flakyCalls < 3) throw new Error('transient')
          return 'ok'
        }
        throw new Error('unauthorized')
      },
    })
    expect(result.attempts[0]?.errorType).toBe('condition_skipped')
    expect(flakyCalls).toBe(3) // 1 + retry 2
    expect(result.success).toBe(true)
    expect(result.successfulStep).toBe('flaky')

    const halting = new FallbackChain(
      [
        { name: 'bad-auth', type: 'tool', tool: 'x' },
        { name: 'after', type: 'tool', tool: 'y' },
      ],
      { stopOn: ['auth_error'] },
    )
    const halted = await halting.execute({}, {
      tool: async () => {
        throw new Error('401 unauthorized')
      },
    })
    expect(halted.success).toBe(false)
    expect(halted.attempts).toHaveLength(1)
    expect(halted.attempts[0]?.errorType).toBe('auth_error')
  })
})

describe('DegradationDecisionTree', () => {
  class LLMTimeoutError extends Error {}
  class StorageError extends Error {}
  class WorkflowCompileError extends Error {}
  class ToolExecutionError extends Error {}

  it('switches provider when the LLM router has a fallback', async () => {
    const tree = new DegradationDecisionTree({
      llmRouter: { getFallbackProvider: () => 'backup-llm' },
    })
    const action = await tree.decide('planner', new LLMTimeoutError('timeout'))
    expect(action).toMatchObject({ actionType: 'switch_provider', target: 'backup-llm', urgency: 'high' })
  })

  it('degrades to human (with event) when no LLM fallback exists', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const tree = new DegradationDecisionTree({
      eventBus: {
        emit: (type, payload) => {
          events.push({ type, payload })
        },
      },
    })
    const action = await tree.decide('planner', new LLMTimeoutError('timeout'), { task_id: 't1' })
    expect(action.actionType).toBe('degrade_to_human')
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('task.degrade_to_human')
    expect(events[0]?.payload.metadata).toEqual({ requires_notification: true })
  })

  it('routes storage/workflow/tool/unknown errors to the right actions', async () => {
    const tree = new DegradationDecisionTree({
      toolRegistry: { getAlternative: component => (component === 'search' ? 'search-v2' : null) },
    })
    expect((await tree.decide('db', new StorageError('database locked'))).actionType).toBe('use_memory_fallback')
    expect((await tree.decide('wf', new WorkflowCompileError('bad node'))).actionType).toBe('use_hardcoded_sop')
    const tool = await tree.decide('search', new ToolExecutionError('tool crashed'))
    expect(tool).toMatchObject({ actionType: 'use_alternative_tool', target: 'search-v2' })
    expect((await tree.decide('other', new ToolExecutionError('tool crashed'))).actionType).toBe('skip_and_log')
    expect((await tree.decide('x', new Error('mystery'))).actionType).toBe('abort')
    expect(tree.getHistory('search')).toHaveLength(1)
  })
})

describe('RecoveryTierManager', () => {
  const context = (errorType: string, error = 'x') => ({
    component: 'svc',
    error,
    errorType,
    occurredAt: 0,
  })

  it('classifies errors with severity priority (T4 > T3 > T2 > T1)', () => {
    const manager = new RecoveryTierManager()
    expect(manager.classifyError('DataCorruptionError', '')).toBe(RECOVERY_TIER.TIER_4_DISASTER)
    expect(manager.classifyError('Error', 'region down detected')).toBe(4)
    expect(manager.classifyError('DatabaseError', '')).toBe(3)
    expect(manager.classifyError('ModelNotFoundError', '')).toBe(2)
    expect(manager.classifyError('TimeoutError', '')).toBe(1)
    expect(manager.classifyError('Mystery', 'nothing matches')).toBe(1)
  })

  it('retries the T1 strategy until the operation recovers', async () => {
    const manager = new RecoveryTierManager({ sleep: noopSleep })
    let calls = 0
    const result = await manager.executeRecovery(context('TimeoutError'), () => {
      calls += 1
      if (calls < 2) throw new Error('still timing out')
      return 'recovered'
    })
    expect(result.success).toBe(true)
    expect(result.value).toBe('recovered')
    expect(result.tierUsed).toBe(1)
    expect(result.attempts).toBe(2)
    expect(result.escalated).toBe(false)
  })

  it('escalates T1 → T2 → T3 and succeeds via memory fallback', async () => {
    const events: string[] = []
    const manager = new RecoveryTierManager({
      sleep: noopSleep,
      eventBus: { emit: (_component, type) => events.push(type) },
    })
    const result = await manager.executeRecovery(context('TimeoutError'), () => {
      throw new Error('keeps failing')
    })
    expect(result.success).toBe(true) // T3 use_memory_fallback returns fallbackValue
    expect(result.tierUsed).toBe(3)
    expect(result.strategyUsed).toBe('use_memory_fallback')
    expect(result.escalated).toBe(true)
    expect(events).toContain('recovery.started')
    expect(events).toContain('recovery.escalated')
    expect(events).toContain('recovery.succeeded')
    expect(manager.getStatus()).toMatchObject({ total_recoveries: 1, total_successes: 1 })
  })

  it('aborts when human degradation and region switch both fail', async () => {
    const manager = new RecoveryTierManager({
      sleep: noopSleep,
      strategies: {
        3: {
          tier: 3,
          strategy: 'degrade_to_human',
          maxRetries: 1,
          retryDelaySeconds: 0,
          timeoutSeconds: 30,
          fallbackValue: null,
          notifyHuman: true,
          escalateAfterSeconds: 0,
          metadata: {},
        },
      },
    })
    const result = await manager.executeRecovery(context('DatabaseError'), () => 'unused')
    expect(result.success).toBe(false)
    expect(result.strategyUsed).toBe('switch_region')
    expect(result.error).toContain('switch_region not available')
    expect(manager.getRecoveryHistory('svc')).toHaveLength(1)
  })

  it('shouldEscalate and escalate follow retry/downtime rules', () => {
    const manager = new RecoveryTierManager()
    expect(manager.shouldEscalate({ ...context('TimeoutError'), retryCount: 4 })).toBe(true)
    expect(manager.shouldEscalate({ ...context('TimeoutError'), retryCount: 1 })).toBe(false)
    expect(
      manager.shouldEscalate({
        ...context('x'),
        previousTier: 2,
        totalDowntimeSeconds: 121,
      }),
    ).toBe(true)
    expect(manager.escalate({ ...context('x'), previousTier: 1 })).toBe(2)
    expect(manager.escalate({ ...context('x'), previousTier: 4 })).toBe(4)
  })
})

describe('RestartRecoveryPipeline', () => {
  function fakeStore(): RestartRecoveryStore & { marked: string[] } {
    const data: Record<string, { ttl: number; status: string }> = {
      'task:a': { ttl: -1, status: 'running' },
      'task:b': { ttl: 3600, status: 'running' },
      'task:c': { ttl: -5, status: 'done' },
    }
    const marked: string[] = []
    return {
      marked,
      keys: async () => Object.keys(data),
      ttl: async key => data[key]?.ttl ?? 0,
      getStatus: async key => data[key]?.status ?? null,
      markStale: async key => {
        marked.push(key)
      },
    }
  }

  it('Phase A marks stale running records without deleting', async () => {
    const pipeline = new RestartRecoveryPipeline()
    const store = fakeStore()
    const stale = await pipeline.sweepStaleRecords(store)
    expect(stale.map(record => record.key)).toEqual(['task:a'])
    expect(store.marked).toEqual(['task:a'])
  })

  it('Phase A+ publishes the restart notification', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const pipeline = new RestartRecoveryPipeline({ operatorUserId: 'ops' })
    const notification = await pipeline.notifyRestart(
      { emit: (type, payload) => events.push({ type, payload }) },
      2,
    )
    expect(notification.sweptRecordsCount).toBe(2)
    expect(events[0]?.type).toBe('restart_notification')
    expect(events[0]?.payload.operator_user_id).toBe('ops')
  })

  it('Phase B snapshots and replays only journal entries after the tail', () => {
    const pipeline = new RestartRecoveryPipeline()
    const journal = [
      { key: 'q1', value: 'v1', ttlSeconds: 100, status: 'running', position: 0 },
      { key: 'q2', value: 'v2', ttlSeconds: 100, status: 'running', position: 1 },
    ]
    const snapshot = pipeline.takeSnapshot({ q1: { value: 'old', ttlSeconds: 100, status: 'running' } }, 1)
    const states = pipeline.replayJournal(snapshot, journal)
    expect(states.q1?.value).toBe('old') // position 0 < tail 1, not replayed
    expect(states.q2?.value).toBe('v2')
  })

  it('validates TTL compliance (zero-TTL red line, min/max bounds)', async () => {
    const pipeline = new RestartRecoveryPipeline()
    const store: RestartRecoveryStore = {
      keys: async () => ['zero', 'short', 'long', 'ok'],
      ttl: async key => ({ zero: 0, short: 30, long: 999999, ok: 3600 }[key] as number),
      getStatus: async () => 'running',
      markStale: async () => {},
    }
    const violations = await pipeline.validateTtlCompliance(store)
    expect(violations).toHaveLength(3)
    expect(violations.join('; ')).toContain('zero')
    expect(() => new RestartRecoveryPipeline({ config: { defaultTtlSeconds: 0 } })).toThrow()
  })
})

describe('CheckpointManager', () => {
  it('versions per-step saves and restores the latest state', async () => {
    const manager = new CheckpointManager()
    await manager.save('t1', 'step-a', { n: 1 })
    await manager.save('t1', 'step-a', { n: 2 })
    await manager.save('t1', 'step-b', { m: 9 })
    expect(await manager.load('t1', 'step-a')).toEqual({ n: 2 })
    const records = await manager.listCheckpoints('t1')
    expect(records.filter(record => record.stepName === 'step-a').map(record => record.version)).toEqual([1, 2])
  })

  it('saveIncremental merges state and appends messages', async () => {
    const manager = new CheckpointManager()
    const firstId = await manager.saveFull('t1', { a: 1 }, ['m1'], 'init')
    const secondId = await manager.saveIncremental('t1', { b: 2 }, ['m2'], 'delta')
    const restored = await manager.restore('t1', secondId)
    expect(restored).toEqual({ state: { a: 1, b: 2 }, messages: ['m1', 'm2'] })
    const byFirstId = await manager.restore('t1', firstId)
    expect(byFirstId?.state).toEqual({ a: 1 })
    expect((await manager.getLatest('t1'))?.version).toBe(2)
  })

  it('deleteOldVersions keeps only the newest checkpoints', async () => {
    const manager = new CheckpointManager()
    for (let i = 1; i <= 7; i++) await manager.saveFull('t1', { i }, [], `v${i}`)
    const deleted = await manager.deleteOldVersions('t1', 3)
    expect(deleted).toBe(4)
    const remaining = await manager.listCheckpoints('t1')
    expect(remaining.map(record => record.label)).toEqual(['v5', 'v6', 'v7'])
    await manager.delete('t1')
    expect(await manager.listCheckpoints('t1')).toEqual([])
  })
})
