/**
 * Unified execution policy — cross-project standard.
 *
 * Maps flowforge Python legacy core/execution_policy.py (F25):
 * - OnErrorStrategy aligned with workflow_compiler (abort/skip/retry/
 *   fallback/reflexion_retry) plus OnAnomalyStrategy
 *   (reflect/retry/abort/escalate).
 * - ExecutionPolicy model (timeout 300 / retry 2 / retryDelay 2.0 /
 *   exponential backoff base 2 / on_error fallback / on_anomaly reflect),
 *   compute_delay, to_workflow_node_config.
 * - RetryPolicy & CheckpointPolicy dataclasses migrated from DevForge.
 * - Six predefined POLICY_TEMPLATES + get_policy / policy_from_config.
 */

export type OnErrorStrategy =
  | 'abort'
  | 'skip'
  | 'retry'
  | 'fallback'
  | 'reflexion_retry'

export type OnAnomalyStrategy = 'reflect' | 'retry' | 'abort' | 'escalate'

export type BackoffStrategy = 'fixed' | 'exponential'

const ON_ERROR_STRATEGIES: readonly OnErrorStrategy[] = [
  'abort',
  'skip',
  'retry',
  'fallback',
  'reflexion_retry',
]

const ON_ANOMALY_STRATEGIES: readonly OnAnomalyStrategy[] = [
  'reflect',
  'retry',
  'abort',
  'escalate',
]

// ---------------------------------------------------------------------------
// RetryPolicy & CheckpointPolicy (from DevForge)
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  maxAttempts: number
  backoffSeconds: number
  backoffMultiplier: number
  maxBackoffSeconds: number
  retryableErrors: string[]
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffSeconds: 2.0,
  backoffMultiplier: 2.0,
  maxBackoffSeconds: 60.0,
  retryableErrors: ['TimeoutError', 'ConnectionError', 'RateLimitError'],
}

export interface CheckpointPolicy {
  enabled: boolean
  /** sqlite | redis | file */
  backend: string
  path: string
  everyNSteps: number
  retentionMax: number
  /** Compact state automatically after N steps. */
  autoCompactAfter: number
}

export const DEFAULT_CHECKPOINT_POLICY: CheckpointPolicy = {
  enabled: true,
  backend: 'sqlite',
  path: 'checkpoints/',
  everyNSteps: 1,
  retentionMax: 100,
  autoCompactAfter: 50,
}

// ---------------------------------------------------------------------------
// ExecutionPolicy
// ---------------------------------------------------------------------------

export interface ExecutionPolicyOptions {
  /** Per-step timeout in seconds; 0 means unlimited. */
  timeout?: number
  /** Maximum retry count. */
  retry?: number
  /** Delay between retries in seconds. */
  retryDelay?: number
  /** fixed | exponential */
  backoffStrategy?: BackoffStrategy
  /** Base for exponential backoff. */
  backoffBase?: number
  onError?: OnErrorStrategy
  onAnomaly?: OnAnomalyStrategy
  /** Backup agent used when onError=fallback. */
  fallbackAgent?: string | null
  /** Backup tool used when onError=fallback. */
  fallbackTool?: string | null
  /** Unrecognized keys preserved (extra="allow" parity). */
  extra?: Record<string, unknown>
}

export class ExecutionPolicy {
  readonly timeout: number
  readonly retry: number
  readonly retryDelay: number
  readonly backoffStrategy: BackoffStrategy
  readonly backoffBase: number
  readonly onError: OnErrorStrategy
  readonly onAnomaly: OnAnomalyStrategy
  readonly fallbackAgent: string | null
  readonly fallbackTool: string | null
  readonly extra: Record<string, unknown>

  constructor(options: ExecutionPolicyOptions = {}) {
    this.timeout = options.timeout ?? 300
    this.retry = options.retry ?? 2
    this.retryDelay = options.retryDelay ?? 2.0
    this.backoffStrategy = options.backoffStrategy ?? 'exponential'
    this.backoffBase = options.backoffBase ?? 2
    this.onError = options.onError ?? 'fallback'
    this.onAnomaly = options.onAnomaly ?? 'reflect'
    this.fallbackAgent = options.fallbackAgent ?? null
    this.fallbackTool = options.fallbackTool ?? null
    this.extra = { ...options.extra }

    if (this.timeout < 0) throw new Error('timeout must be >= 0')
    if (this.retry < 0) throw new Error('retry must be >= 0')
    if (this.retryDelay < 0) throw new Error('retry_delay must be >= 0')
    if (this.backoffBase < 1) throw new Error('backoff_base must be >= 1')
    if (this.backoffStrategy !== 'fixed' && this.backoffStrategy !== 'exponential') {
      throw new Error(
        `backoff_strategy must be 'fixed' or 'exponential', got '${this.backoffStrategy}'`,
      )
    }
    if (!ON_ERROR_STRATEGIES.includes(this.onError)) {
      throw new Error(`invalid on_error strategy '${this.onError}'`)
    }
    if (!ON_ANOMALY_STRATEGIES.includes(this.onAnomaly)) {
      throw new Error(`invalid on_anomaly strategy '${this.onAnomaly}'`)
    }
  }

  /**
   * Wait time before the given retry attempt (1-based).
   * exponential: retryDelay * backoffBase^(attempt-1); fixed: retryDelay.
   */
  computeDelay(attempt: number): number {
    if (this.backoffStrategy === 'exponential') {
      return this.retryDelay * this.backoffBase ** (attempt - 1)
    }
    return this.retryDelay
  }

  /** Convert to a WorkflowNodeConfig-compatible record (snake_case). */
  toWorkflowNodeConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {
      timeout: this.timeout,
      retry_count: this.retry,
      retry_delay: this.retryDelay,
      on_error: this.onError,
    }
    if (this.fallbackAgent) {
      config.fallback_chain = [{ agent: this.fallbackAgent }]
    } else if (this.fallbackTool) {
      config.fallback_chain = [{ tool: this.fallbackTool }]
    }
    return config
  }

  /** Shallow copy with selective overrides. */
  copy(overrides: ExecutionPolicyOptions = {}): ExecutionPolicy {
    return new ExecutionPolicy({
      timeout: this.timeout,
      retry: this.retry,
      retryDelay: this.retryDelay,
      backoffStrategy: this.backoffStrategy,
      backoffBase: this.backoffBase,
      onError: this.onError,
      onAnomaly: this.onAnomaly,
      fallbackAgent: this.fallbackAgent,
      fallbackTool: this.fallbackTool,
      extra: this.extra,
      ...overrides,
    })
  }
}

// ---------------------------------------------------------------------------
// Predefined policy templates
// ---------------------------------------------------------------------------

export const POLICY_TEMPLATE_NAMES = [
  'default',
  'strict',
  'resilient',
  'content_creation',
  'novel_writing',
  'code_review',
] as const

const POLICY_TEMPLATES: Record<string, () => ExecutionPolicy> = {
  default: () => new ExecutionPolicy(),
  strict: () =>
    new ExecutionPolicy({
      timeout: 600,
      retry: 0,
      onError: 'abort',
      onAnomaly: 'abort',
    }),
  resilient: () =>
    new ExecutionPolicy({
      timeout: 300,
      retry: 5,
      backoffStrategy: 'exponential',
      onError: 'retry',
      onAnomaly: 'retry',
    }),
  content_creation: () =>
    new ExecutionPolicy({
      timeout: 600,
      retry: 3,
      onError: 'fallback',
      onAnomaly: 'reflect',
    }),
  novel_writing: () =>
    new ExecutionPolicy({
      timeout: 900,
      retry: 3,
      backoffStrategy: 'exponential',
      onError: 'reflexion_retry',
      onAnomaly: 'reflect',
    }),
  code_review: () =>
    new ExecutionPolicy({
      timeout: 300,
      retry: 2,
      onError: 'fallback',
      onAnomaly: 'escalate',
    }),
}

/**
 * Get a predefined policy template by name.
 * Unknown names fall back to 'default' (fresh instance each call).
 */
export function getPolicy(name = 'default'): ExecutionPolicy {
  const factory = POLICY_TEMPLATES[name]
  if (!factory) return new ExecutionPolicy()
  return factory()
}

/** Known policy field keys accepted by policyFromConfig (camelCase or snake_case). */
const POLICY_FIELD_ALIASES: Record<string, keyof ExecutionPolicyOptions> = {
  timeout: 'timeout',
  retry: 'retry',
  retry_delay: 'retryDelay',
  retrydelay: 'retryDelay',
  backoff_strategy: 'backoffStrategy',
  backoffstrategy: 'backoffStrategy',
  backoff_base: 'backoffBase',
  backoffbase: 'backoffBase',
  on_error: 'onError',
  onerror: 'onError',
  on_anomaly: 'onAnomaly',
  onanomaly: 'onAnomaly',
  fallback_agent: 'fallbackAgent',
  fallbackagent: 'fallbackAgent',
  fallback_tool: 'fallbackTool',
  fallbacktool: 'fallbackTool',
}

/**
 * Build an ExecutionPolicy from a config record: `template` selects a
 * predefined template (default 'default'), remaining non-null fields
 * override it. Unrecognized keys are preserved in `extra`.
 */
export function policyFromConfig(config: Record<string, unknown>): ExecutionPolicy {
  const templateName =
    typeof config.template === 'string' ? config.template : 'default'
  const base = getPolicy(templateName)

  const overrides: ExecutionPolicyOptions = {}
  const extra: Record<string, unknown> = {}
  let hasOverride = false
  for (const [key, value] of Object.entries(config)) {
    if (key === 'template' || value === null || value === undefined) continue
    const field = POLICY_FIELD_ALIASES[key.toLowerCase()]
    if (field) {
      ;(overrides as Record<string, unknown>)[field] = value
      hasOverride = true
    } else {
      extra[key] = value
    }
  }
  if (!hasOverride && Object.keys(extra).length === 0) return base
  return base.copy({ ...overrides, ...(Object.keys(extra).length > 0 ? { extra } : {}) })
}
