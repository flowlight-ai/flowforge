/**
 * Canary executor: drives the staged rollout — route traffic, observe,
 * health-check, then advance / roll back. Mapped from flowforge Python
 * legacy `core/canary.py` `CanaryExecutor` (F24); every dependency
 * (registry, HTTP probe, metrics, events, sleep, clock) is injected, so
 * tests run without timers or sockets.
 *
 * @module @flowforge/canary/executor
 */

import type { CanaryDeploymentRegistry, CanaryStageConfig } from './config.ts'

/** Execution lifecycle of one canary deployment. */
export type CanaryExecutionState = 'pending' | 'running' | 'paused' | 'succeeded' | 'rolled_back' | 'failed'

/** Canary lifecycle events (emitted through the injected event bus). */
export const CANARY_EVENTS = {
  executionStarted: 'canary.execution.started',
  executionSucceeded: 'canary.execution.succeeded',
  executionPaused: 'canary.execution.paused',
  executionResumed: 'canary.execution.resumed',
  executionRolledBack: 'canary.execution.rolled_back',
  executionFailed: 'canary.execution.failed',
  stageStarted: 'canary.stage.started',
  stageCompleted: 'canary.stage.completed',
  stageFailed: 'canary.stage.failed',
} as const

/** One stage's outcome. */
export interface CanaryStageResult {
  readonly stageIndex: number
  readonly percentage: number
  readonly state: 'succeeded' | 'failed'
  readonly durationSeconds: number
  readonly healthCheckPassed: boolean
  readonly metricsSnapshot: Readonly<Record<string, number>>
  readonly error: string
}

/** Whole-execution state snapshot. */
export interface CanaryExecution {
  readonly deploymentName: string
  state: CanaryExecutionState
  currentStageIndex: number
  readonly stagesResults: CanaryStageResult[]
  totalDurationSeconds: number
  autoRollbackTriggered: boolean
  rollbackReason: string
  readonly metadata: Readonly<Record<string, unknown>>
}

/** Health-check probe outcome. */
export interface HealthCheckResult {
  passed: boolean
  statusCode: number
  responseTimeMs: number
  errorRate: number
  latencyP99Ms: number
  error: string
}

/** Minimal HTTP probe contract (hosts inject fetch-style clients). */
export interface CanaryHttpClient {
  get(url: string, timeoutMs: number): Promise<{ statusCode: number; body?: unknown }>
}

/** Optional event sink, e.g. the session event bus. */
export interface CanaryEventBus {
  emit(taskId: string, eventType: string, payload: Record<string, unknown>): void
}

/** Optional metrics sink (getCanaryMetrics feeds health checks when the body has none). */
export interface CanaryMetricsCollector {
  getCanaryMetrics?(): { errorRate?: number; latencyP99Ms?: number }
  incCounter?(name: string, labels?: Record<string, string>): void
}

export interface CanaryExecutorOptions {
  readonly registry: CanaryDeploymentRegistry
  readonly httpClient?: CanaryHttpClient
  readonly eventBus?: CanaryEventBus
  readonly metricsCollector?: CanaryMetricsCollector
  /** Observation sleeper — tests inject () => Promise.resolve(). */
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

/** Traffic routing callback: receives the new canary percentage. */
export type TrafficRouter = (percentage: number) => void | Promise<void>

const TERMINAL_STATES: readonly CanaryExecutionState[] = ['succeeded', 'rolled_back', 'failed']

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve = (): void => undefined
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

export class CanaryExecutor {
  private readonly registry: CanaryExecutorOptions['registry']
  private readonly httpClient: CanaryHttpClient | undefined
  private readonly eventBus: CanaryEventBus | undefined
  private readonly metricsCollector: CanaryMetricsCollector | undefined
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  private readonly executions = new Map<string, CanaryExecution>()
  private readonly history: CanaryExecution[] = []
  private readonly paused = new Map<string, boolean>()
  private readonly gates = new Map<string, Deferred>()
  private readonly trafficRouters = new Map<string, TrafficRouter | undefined>()

  constructor(options: CanaryExecutorOptions) {
    this.registry = options.registry
    this.httpClient = options.httpClient
    this.eventBus = options.eventBus
    this.metricsCollector = options.metricsCollector
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? (() => Date.now())
  }

  /**
   * Run one full canary rollout. Stages advance in order; a failed health
   * check rolls back (traffic to 0%) when autoRollback is on, otherwise
   * the execution fails in place. Resumes a paused execution from its
   * current stage.
   */
  async execute(deploymentName: string, trafficRouter?: TrafficRouter): Promise<CanaryExecution> {
    const config = this.registry.get(deploymentName)
    if (config === undefined) {
      throw new Error(
        `canary deployment '${deploymentName}' not found. Available: ${this.registry.listDeployments().join(', ')}`,
      )
    }

    const existing = this.executions.get(deploymentName)
    const execution: CanaryExecution = existing !== undefined && !TERMINAL_STATES.includes(existing.state)
      ? existing
      : {
          deploymentName,
          state: 'pending',
          currentStageIndex: -1,
          stagesResults: [],
          totalDurationSeconds: 0,
          autoRollbackTriggered: false,
          rollbackReason: '',
          metadata: { ...config.metadata },
        }
    this.executions.set(deploymentName, execution)
    this.trafficRouters.set(deploymentName, trafficRouter)
    this.gates.set(deploymentName, this.gates.get(deploymentName) ?? createDeferred())
    if (!this.paused.get(deploymentName)) this.gates.get(deploymentName)?.resolve()

    const startedAt = this.now()
    execution.state = 'running'
    this.emit(CANARY_EVENTS.executionStarted, deploymentName, {
      deployment_name: deploymentName,
      stages: config.stages.length,
    })

    let stageIndex = execution.currentStageIndex + 1
    while (stageIndex < config.stages.length) {
      // Cooperative pause: wait until resume_execution() opens the gate.
      if (this.paused.get(deploymentName)) {
        execution.state = 'paused'
        this.emit(CANARY_EVENTS.executionPaused, deploymentName, { deployment_name: deploymentName, stage_index: stageIndex })
        await this.gates.get(deploymentName)?.promise
        execution.state = 'running'
        this.emit(CANARY_EVENTS.executionResumed, deploymentName, { deployment_name: deploymentName, stage_index: stageIndex })
      }

      execution.currentStageIndex = stageIndex
      const stageConfig = config.stages[stageIndex]
      if (stageConfig === undefined) {
        throw new Error(`canary deployment '${deploymentName}' has no stage ${stageIndex}`)
      }
      this.emit(CANARY_EVENTS.stageStarted, deploymentName, {
        deployment_name: deploymentName,
        stage_index: stageIndex,
        percentage: stageConfig.percentage,
      })

      let stageResult: CanaryStageResult
      try {
        stageResult = await this.executeStage(execution, stageIndex, trafficRouter)
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure)
        stageResult = {
          stageIndex,
          percentage: stageConfig.percentage,
          state: 'failed',
          durationSeconds: 0,
          healthCheckPassed: false,
          metricsSnapshot: {},
          error: `stage execution error: ${message}`,
        }
        this.emit(CANARY_EVENTS.stageFailed, deploymentName, {
          deployment_name: deploymentName,
          stage_index: stageIndex,
          error: message,
        })
        execution.stagesResults.push(stageResult)
        return this.finish(execution, startedAt, config.autoRollback, `stage ${stageIndex} raised: ${message}`)
      }

      execution.stagesResults.push(stageResult)
      this.emit(CANARY_EVENTS.stageCompleted, deploymentName, {
        deployment_name: deploymentName,
        stage_index: stageIndex,
        percentage: stageConfig.percentage,
        health_check_passed: stageResult.healthCheckPassed,
      })

      if (!stageResult.healthCheckPassed) {
        return this.finish(
          execution,
          startedAt,
          config.autoRollback,
          `stage ${stageIndex} health check failed: ${stageResult.error}`,
        )
      }
      stageIndex += 1
    }

    execution.state = 'succeeded'
    execution.totalDurationSeconds = (this.now() - startedAt) / 1000
    this.emit(CANARY_EVENTS.executionSucceeded, deploymentName, {
      deployment_name: deploymentName,
      total_duration_seconds: execution.totalDurationSeconds,
    })
    this.history.push(execution)
    return execution
  }

  /** Request a cooperative pause before the next stage. */
  async pauseExecution(deploymentName: string): Promise<boolean> {
    if (!this.executions.has(deploymentName)) return false
    this.paused.set(deploymentName, true)
    const gate = this.gates.get(deploymentName)
    if (gate !== undefined) this.gates.set(deploymentName, createDeferred())
    const execution = this.executions.get(deploymentName)
    if (execution !== undefined && execution.state === 'running') execution.state = 'paused'
    return true
  }

  /** Resume a paused execution. */
  async resumeExecution(deploymentName: string): Promise<boolean> {
    if (!this.executions.has(deploymentName)) return false
    this.paused.set(deploymentName, false)
    this.gates.get(deploymentName)?.resolve()
    const execution = this.executions.get(deploymentName)
    if (execution !== undefined && execution.state === 'paused') execution.state = 'running'
    return true
  }

  getExecution(deploymentName: string): CanaryExecution | undefined {
    return this.executions.get(deploymentName)
  }

  listExecutions(): ReadonlyMap<string, CanaryExecution> {
    return this.executions
  }

  /** Execution history, newest last, optionally filtered by deployment. */
  getExecutionHistory(deploymentName?: string, limit = 20): CanaryExecution[] {
    const window = this.history.slice(-limit)
    if (deploymentName === undefined) return [...window]
    return window.filter(entry => entry.deploymentName === deploymentName)
  }

  private async executeStage(
    execution: CanaryExecution,
    stageIndex: number,
    trafficRouter: TrafficRouter | undefined,
  ): Promise<CanaryStageResult> {
    const config = this.registry.get(execution.deploymentName)
    if (config === undefined) throw new Error(`canary deployment '${execution.deploymentName}' vanished`)
    const stageConfig = config.stages[stageIndex]
    if (stageConfig === undefined) {
      throw new Error(`canary deployment '${execution.deploymentName}' has no stage ${stageIndex}`)
    }
    const startedAt = this.now()

    if (trafficRouter !== undefined) await trafficRouter(stageConfig.percentage)
    if (config.observationSeconds > 0) await this.sleep(config.observationSeconds * 1000)

    const health = await this.healthCheck(stageConfig)
    return {
      stageIndex,
      percentage: stageConfig.percentage,
      state: health.passed ? 'succeeded' : 'failed',
      durationSeconds: (this.now() - startedAt) / 1000,
      healthCheckPassed: health.passed,
      metricsSnapshot: {
        status_code: health.statusCode,
        response_time_ms: health.responseTimeMs,
        error_rate: health.errorRate,
        latency_p99_ms: health.latencyP99Ms,
      },
      error: health.error,
    }
  }

  /**
   * Probe one stage: HTTP 200, then error-rate and p99-latency thresholds.
   * Metrics come from the response body first, then the metrics collector.
   */
  private async healthCheck(stageConfig: CanaryStageConfig): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      passed: true,
      statusCode: 0,
      responseTimeMs: 0,
      errorRate: 0,
      latencyP99Ms: 0,
      error: '',
    }

    if (stageConfig.healthCheckUrl !== undefined) {
      if (this.httpClient === undefined) {
        result.passed = false
        result.error = 'health check URL declared but no http client injected'
        return result
      }
      try {
        const startedAt = this.now()
        const response = await this.httpClient.get(stageConfig.healthCheckUrl, 10_000)
        result.responseTimeMs = this.now() - startedAt
        result.statusCode = response.statusCode
        if (response.statusCode !== 200) {
          result.passed = false
          result.error = `health check returned status ${response.statusCode}`
        } else if (typeof response.body === 'object' && response.body !== null) {
          const body = response.body as Record<string, unknown>
          if (typeof body.error_rate === 'number') result.errorRate = body.error_rate
          if (typeof body.latency_p99_ms === 'number') result.latencyP99Ms = body.latency_p99_ms
        }
      } catch (failure) {
        result.passed = false
        result.statusCode = 0
        result.error = `health check request failed: ${failure instanceof Error ? failure.message : String(failure)}`
      }
    }

    if (this.metricsCollector !== undefined && result.errorRate === 0 && result.latencyP99Ms === 0) {
      const metrics = this.metricsCollector.getCanaryMetrics?.()
      if (metrics !== undefined) {
        result.errorRate = metrics.errorRate ?? 0
        result.latencyP99Ms = metrics.latencyP99Ms ?? 0
      }
    }

    if (result.errorRate > stageConfig.errorRateThreshold) {
      result.passed = false
      result.error = `error_rate ${result.errorRate.toFixed(4)} exceeds threshold ${stageConfig.errorRateThreshold.toFixed(4)}`
    }
    if (result.latencyP99Ms > stageConfig.latencyP99ThresholdMs) {
      result.passed = false
      if (result.error === '') {
        result.error = `latency_p99 ${result.latencyP99Ms.toFixed(1)}ms exceeds threshold ${stageConfig.latencyP99ThresholdMs}ms`
      }
    }
    return result
  }

  /** Terminal bookkeeping: roll traffic back when allowed, else fail in place. */
  private finish(
    execution: CanaryExecution,
    startedAt: number,
    autoRollback: boolean,
    reason: string,
  ): CanaryExecution {
    if (autoRollback) {
      const router = this.trafficRouters.get(execution.deploymentName)
      if (router !== undefined) {
        // Fire-and-forget rollback routing; a failing router must not mask the rollback.
        void Promise.resolve(router(0)).catch(() => undefined)
      }
      execution.state = 'rolled_back'
      execution.autoRollbackTriggered = true
      execution.rollbackReason = reason
      this.metricsCollector?.incCounter?.('flowforge_canary_rollback_total', {
        deployment_name: execution.deploymentName,
      })
      this.emit(CANARY_EVENTS.executionRolledBack, execution.deploymentName, {
        deployment_name: execution.deploymentName,
        reason,
      })
    } else {
      execution.state = 'failed'
      this.emit(CANARY_EVENTS.executionFailed, execution.deploymentName, {
        deployment_name: execution.deploymentName,
        error: reason,
      })
    }
    execution.totalDurationSeconds = (this.now() - startedAt) / 1000
    this.history.push(execution)
    return execution
  }

  private emit(eventType: string, deploymentName: string, payload: Record<string, unknown>): void {
    try {
      this.eventBus?.emit(deploymentName, eventType, payload)
    } catch {
      // A broken event sink must never break a rollout.
    }
  }
}
