/**
 * @flowforge/canary — canary deployment framework (F24): staged rollout,
 * observation windows, health checks, auto rollback and pause/resume.
 * Mapped from flowforge Python legacy `core/canary.py`.
 *
 * @module @flowforge/canary
 */

export type { CanaryDeploymentConfig, CanaryStageConfig } from './config.ts'
export { CanaryDeploymentRegistry, parseDeploymentConfig } from './config.ts'
export type {
  CanaryEventBus,
  CanaryExecution,
  CanaryExecutionState,
  CanaryExecutorOptions,
  CanaryHttpClient,
  CanaryMetricsCollector,
  CanaryStageResult,
  HealthCheckResult,
  TrafficRouter,
} from './executor.ts'
export { CANARY_EVENTS, CanaryExecutor } from './executor.ts'
