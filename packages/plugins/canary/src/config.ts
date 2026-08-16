/**
 * Canary deployment configuration: stage tables, rollback thresholds and
 * the deployment registry. Mapped from flowforge Python legacy
 * `core/canary.py` config models (F24); YAML assembly follows R17.
 *
 * @module @flowforge/canary/config
 */

import { load } from 'js-yaml'

/** One progressive-release stage. */
export interface CanaryStageConfig {
  readonly percentage: number
  readonly durationSeconds: number
  readonly healthCheckUrl?: string | undefined
  readonly successThreshold: number
  readonly errorRateThreshold: number
  readonly latencyP99ThresholdMs: number
}

/** A full canary deployment declaration (one YAML document). */
export interface CanaryDeploymentConfig {
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  readonly stages: readonly CanaryStageConfig[]
  readonly autoRollback: boolean
  readonly rollbackOnErrorRate: number
  readonly rollbackOnLatencyMultiplier: number
  readonly healthCheckIntervalSeconds: number
  readonly healthCheckTimeoutSeconds: number
  readonly observationSeconds: number
  readonly metadata: Readonly<Record<string, unknown>>
}

const DEFAULT_STAGES: ReadonlyArray<Pick<CanaryStageConfig, 'percentage' | 'durationSeconds'>> = [
  { percentage: 10, durationSeconds: 300 },
  { percentage: 50, durationSeconds: 300 },
  { percentage: 100, durationSeconds: 0 },
]

function stageDefaults(): CanaryStageConfig[] {
  return DEFAULT_STAGES.map(stage => ({
    percentage: stage.percentage,
    durationSeconds: stage.durationSeconds,
    successThreshold: 0.99,
    errorRateThreshold: 0.01,
    latencyP99ThresholdMs: 2000,
  }))
}

function parseStage(record: Record<string, unknown>): CanaryStageConfig {
  return {
    percentage: typeof record.percentage === 'number' ? record.percentage : 10,
    durationSeconds: typeof record.duration_seconds === 'number' ? record.duration_seconds : 300,
    healthCheckUrl: typeof record.health_check_url === 'string' ? record.health_check_url : undefined,
    successThreshold: typeof record.success_threshold === 'number' ? record.success_threshold : 0.99,
    errorRateThreshold: typeof record.error_rate_threshold === 'number' ? record.error_rate_threshold : 0.01,
    latencyP99ThresholdMs: typeof record.latency_p99_threshold_ms === 'number' ? record.latency_p99_threshold_ms : 2000,
  }
}

/** Build a config from an untrusted parsed record (YAML/JSON). Throws on missing name. */
export function parseDeploymentConfig(record: Record<string, unknown>): CanaryDeploymentConfig {
  if (typeof record.name !== 'string' || record.name.length === 0) {
    throw new Error('canary config requires a non-empty "name"')
  }
  const stages = Array.isArray(record.stages) && record.stages.length > 0
    ? record.stages.map(stage => parseStage(stage as Record<string, unknown>))
    : stageDefaults()
  return {
    name: record.name,
    description: typeof record.description === 'string' ? record.description : '',
    enabled: record.enabled !== false,
    stages,
    autoRollback: record.auto_rollback !== false,
    rollbackOnErrorRate: typeof record.rollback_on_error_rate === 'number' ? record.rollback_on_error_rate : 0.05,
    rollbackOnLatencyMultiplier:
      typeof record.rollback_on_latency_multiplier === 'number' ? record.rollback_on_latency_multiplier : 2.0,
    healthCheckIntervalSeconds:
      typeof record.health_check_interval_seconds === 'number' ? record.health_check_interval_seconds : 30,
    healthCheckTimeoutSeconds:
      typeof record.health_check_timeout_seconds === 'number' ? record.health_check_timeout_seconds : 10,
    observationSeconds: typeof record.observation_seconds === 'number' ? record.observation_seconds : 300,
    metadata: typeof record.metadata === 'object' && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : {},
  }
}

/** Registry of canary deployment configs, keyed by deployment name. */
export class CanaryDeploymentRegistry {
  private readonly configs = new Map<string, CanaryDeploymentConfig>()

  register(name: string, config: CanaryDeploymentConfig | Record<string, unknown>): void {
    this.configs.set(name, 'name' in config && 'stages' in config
      ? (config as CanaryDeploymentConfig)
      : parseDeploymentConfig({ ...config, name }))
  }

  /** Load one YAML deployment document; returns the parsed config. */
  loadFromYamlText(text: string): CanaryDeploymentConfig {
    const parsed = load(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('canary YAML must be a mapping')
    }
    const config = parseDeploymentConfig(parsed as Record<string, unknown>)
    this.configs.set(config.name, config)
    return config
  }

  get(name: string): CanaryDeploymentConfig | undefined {
    return this.configs.get(name)
  }

  listDeployments(): string[] {
    return [...this.configs.keys()]
  }

  getAll(): ReadonlyMap<string, CanaryDeploymentConfig> {
    return this.configs
  }
}
