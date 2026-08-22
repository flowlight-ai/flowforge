/**
 * Contract suite: T7.21 Cordis plugin — ResilienceService at ctx.forgeResilience
 * mounting breaker/fallback/degradation/recovery/checkpoint/restart cores.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import Plugin, {
  AgentExecutionGuard,
  CheckpointManager,
  CircuitBreaker,
  DegradationDecisionTree,
  FallbackChain,
  RecoveryTierManager,
  ResilienceExecutor,
  ResilienceService,
  RestartRecoveryPipeline,
  clearBreakerRegistry,
} from '../src/index.ts'

const noopSleep = async () => {}

async function makeCtx() {
  const ctx = new Context()
  await ctx.plugin(Plugin)
  return ctx
}

describe('plugin mount', () => {
  it('mounts ctx.forgeResilience with six components', async () => {
    const ctx = await makeCtx()
    expect(ctx.forgeResilience).toBeInstanceOf(ResilienceService)
    expect(ctx.forgeResilience.decisionTree).toBeInstanceOf(DegradationDecisionTree)
    expect(ctx.forgeResilience.recoveryManager).toBeInstanceOf(RecoveryTierManager)
    expect(ctx.forgeResilience.checkpoints).toBeInstanceOf(CheckpointManager)
    expect(ctx.forgeResilience.guard).toBeInstanceOf(AgentExecutionGuard)
    expect(ctx.forgeResilience.pipeline).toBeInstanceOf(RestartRecoveryPipeline)
  })
})

describe('breaker facades', () => {
  it('getBreaker returns a shared named breaker; resetAllBreakers resets', async () => {
    clearBreakerRegistry()
    const ctx = await makeCtx()
    const breaker = ctx.forgeResilience.getBreaker('svc-a', { failureThreshold: 1 })
    expect(breaker).toBeInstanceOf(CircuitBreaker)
    breaker.recordFailure()
    expect(breaker.state).toBe('open')
    expect(ctx.forgeResilience.getBreaker('svc-a')).toBe(breaker)
    ctx.forgeResilience.resetAllBreakers()
    expect(breaker.state).toBe('closed')
    clearBreakerRegistry()
  })
})

describe('executor + chain factories', () => {
  it('createExecutor merges service defaults and degrades via backup', async () => {
    const ctx = await makeCtx()
    const executor = ctx.forgeResilience.createExecutor('primary', ['backup-a'], {
      baseRetryDelay: 0,
      sleep: noopSleep,
    })
    expect(executor).toBeInstanceOf(ResilienceExecutor)
    const result = await executor.executeWithResilience(provider => {
      if (provider === 'primary') throw new Error('boom')
      return 'ok'
    })
    expect(result.providerUsed).toBe('backup-a')
    expect(result.fallbackUsed).toBe(true)
  })

  it('createFallbackChain executes steps in priority order', async () => {
    const ctx = await makeCtx()
    const chain = ctx.forgeResilience.createFallbackChain(
      [
        { name: 'fail-step', type: 'function', function: 'boom' },
        { name: 'ok-step', type: 'function', function: 'fine' },
      ],
      { name: 'test-chain' },
    )
    expect(chain).toBeInstanceOf(FallbackChain)
    const result = await chain.execute({ input: {} }, {
      function: async path => {
        if (path === 'boom') throw new Error('boom')
        return 'done'
      },
    })
    expect(result.success).toBe(true)
    expect(result.successfulStep).toBe('ok-step')
  })
})

describe('checkpoint + snapshot', () => {
  it('checkpointTemplate resolves production path variables', async () => {
    const ctx = await makeCtx()
    const config = ctx.forgeResilience.checkpointTemplate('production')
    expect(config.resolvePath({ data_dir: '/data' })).toBe('/data/checkpoints.db')
  })

  it('checkpoints facade persists and restores state', async () => {
    const ctx = await makeCtx()
    await ctx.forgeResilience.checkpoints.saveFull('task-1', { step: 1 }, ['m1'])
    const restored = await ctx.forgeResilience.checkpoints.restore('task-1')
    expect(restored?.state).toEqual({ step: 1 })
    expect(restored?.messages).toEqual(['m1'])
  })

  it('snapshot aggregates recovery/guard/degradation status', async () => {
    const ctx = await makeCtx()
    const snap = await ctx.forgeResilience.snapshot()
    expect(snap.recovery).toBeDefined()
    expect(snap.guard).toEqual({})
    expect(snap.degradation_history).toBe(0)
    expect(snap.checkpoint).toEqual({ dbPath: 'data/checkpoints.db' })
  })
})

describe('degradation wiring', () => {
  it('decision tree routes LLM timeout to human degradation', async () => {
    const ctx = await makeCtx()
    const action = await ctx.forgeResilience.decisionTree.decide('svc', new Error('request timeout'))
    expect(action.actionType).toBe('degrade_to_human')
    const snap = await ctx.forgeResilience.snapshot()
    expect(snap.degradation_history).toBe(1)
  })
})
