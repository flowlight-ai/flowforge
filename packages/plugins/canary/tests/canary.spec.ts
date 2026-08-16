/**
 * Contract suite: YAML config parsing, staged rollout success path,
 * health-check thresholds (status/error-rate/p99), auto rollback vs
 * fail-in-place, metrics-collector fallback, and cooperative pause/resume.
 */

import { describe, expect, it } from 'vitest'
import {
  CANARY_EVENTS,
  CanaryDeploymentRegistry,
  CanaryExecutor,
  type CanaryHttpClient,
} from '../src/index.ts'

const YAML = `
name: web-rollout
observation_seconds: 1
stages:
  - percentage: 10
    duration_seconds: 0
    health_check_url: https://svc/health
  - percentage: 100
    duration_seconds: 0
    health_check_url: https://svc/health
`

function healthyClient(body: Record<string, unknown> = {}): CanaryHttpClient {
  return { get: async () => ({ statusCode: 200, body }) }
}

function makeExecutor(client?: CanaryHttpClient, extra?: { sleep?: (ms: number) => Promise<void> }) {
  const registry = new CanaryDeploymentRegistry()
  registry.loadFromYamlText(YAML)
  const events: Array<{ type: string; payload: Record<string, unknown> }> = []
  const executor = new CanaryExecutor({
    registry,
    ...(client ? { httpClient: client } : {}),
    eventBus: { emit: (_taskId, type, payload) => events.push({ type, payload }) },
    sleep: extra?.sleep ?? (async () => undefined),
  })
  return { registry, executor, events }
}

describe('config registry (R17 YAML)', () => {
  it('parses stages and defaults from YAML', () => {
    const registry = new CanaryDeploymentRegistry()
    const config = registry.loadFromYamlText(YAML)
    expect(config.name).toBe('web-rollout')
    expect(config.stages.map(stage => stage.percentage)).toEqual([10, 100])
    expect(config.stages[0]?.errorRateThreshold).toBe(0.01)
    expect(config.autoRollback).toBe(true)
    expect(registry.listDeployments()).toEqual(['web-rollout'])
  })

  it('falls back to the 10/50/100 default stage table', () => {
    const registry = new CanaryDeploymentRegistry()
    const config = registry.loadFromYamlText('name: bare')
    expect(config.stages.map(stage => stage.percentage)).toEqual([10, 50, 100])
  })

  it('rejects documents without a name', () => {
    const registry = new CanaryDeploymentRegistry()
    expect(() => registry.loadFromYamlText('stages: []')).toThrow(/name/)
  })
})

describe('execute', () => {
  it('rolls through every stage, routing traffic, to SUCCEEDED', async () => {
    const { executor } = makeExecutor(healthyClient())
    const routed: number[] = []
    const execution = await executor.execute('web-rollout', percentage => {
      routed.push(percentage)
    })
    expect(execution.state).toBe('succeeded')
    expect(routed).toEqual([10, 100])
    expect(execution.stagesResults.map(stage => stage.healthCheckPassed)).toEqual([true, true])
    expect(executor.getExecutionHistory('web-rollout')).toHaveLength(1)
  })

  it('throws for unknown deployments', async () => {
    const { executor } = makeExecutor()
    await expect(executor.execute('ghost')).rejects.toThrow(/not found/)
  })

  it('auto-rolls back (traffic to 0) when a health check fails', async () => {
    const client: CanaryHttpClient = { get: async () => ({ statusCode: 500 }) }
    const { executor, events } = makeExecutor(client)
    const routed: number[] = []
    const execution = await executor.execute('web-rollout', percentage => {
      routed.push(percentage)
    })
    expect(execution.state).toBe('rolled_back')
    expect(execution.autoRollbackTriggered).toBe(true)
    expect(execution.rollbackReason).toContain('health check failed')
    expect(routed[0]).toBe(10)
    await new Promise(resolve => setTimeout(resolve, 0)) // fire-and-forget router(0)
    expect(routed).toContain(0)
    expect(events.map(event => event.type)).toContain(CANARY_EVENTS.executionRolledBack)
  })

  it('fails in place when autoRollback is off', async () => {
    const registry = new CanaryDeploymentRegistry()
    registry.loadFromYamlText(`${YAML}auto_rollback: false`)
    const executor = new CanaryExecutor({
      registry,
      httpClient: { get: async () => ({ statusCode: 500 }) },
      sleep: async () => undefined,
    })
    const execution = await executor.execute('web-rollout')
    expect(execution.state).toBe('failed')
    expect(execution.autoRollbackTriggered).toBe(false)
  })

  it('enforces error-rate and latency thresholds from the response body', async () => {
    const { executor } = makeExecutor(healthyClient({ error_rate: 0.2 }))
    const execution = await executor.execute('web-rollout')
    expect(execution.state).toBe('rolled_back')
    expect(execution.stagesResults[0]?.error).toContain('error_rate')

    const slow = makeExecutor(healthyClient({ latency_p99_ms: 9999 }))
    const slowExecution = await slow.executor.execute('web-rollout')
    expect(slowExecution.stagesResults[0]?.error).toContain('latency_p99')
  })

  it('falls back to the metrics collector when the body carries no metrics', async () => {
    const registry = new CanaryDeploymentRegistry()
    registry.loadFromYamlText(YAML)
    const executor = new CanaryExecutor({
      registry,
      httpClient: healthyClient(),
      metricsCollector: { getCanaryMetrics: () => ({ errorRate: 0.5 }) },
      sleep: async () => undefined,
    })
    const execution = await executor.execute('web-rollout')
    expect(execution.state).toBe('rolled_back')
    expect(execution.stagesResults[0]?.metricsSnapshot.error_rate).toBe(0.5)
  })

  it('supports cooperative pause before the next stage and resume', async () => {
    let sleepCalls = 0
    const { executor } = makeExecutor(healthyClient(), {
      sleep: async () => {
        sleepCalls += 1
        if (sleepCalls === 1) void executor.pauseExecution('web-rollout')
      },
    })
    const promise = executor.execute('web-rollout')
    for (let tick = 0; tick < 50 && executor.getExecution('web-rollout')?.state !== 'paused'; tick++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(executor.getExecution('web-rollout')?.state).toBe('paused')
    expect(await executor.resumeExecution('web-rollout')).toBe(true)
    const execution = await promise
    expect(execution.state).toBe('succeeded')
    expect(execution.stagesResults).toHaveLength(2)
  })
})
