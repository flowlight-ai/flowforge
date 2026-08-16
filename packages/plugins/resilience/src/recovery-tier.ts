/**
 * RecoveryTierManager — tiered recovery with escalation chain.
 *
 * Compact core mapped from flowforge Python legacy core/recovery_tier.py
 * (F25). Tiers by severity: T1 soft (retry) → T2 component
 * (switch_provider) → T3 system (memory fallback) → T4 disaster
 * (switch_region). Classification priority T4 > T3 > T2 > T1, default
 * T1; escalation on strategy failure up the chain; metrics + events via
 * injected collaborators.
 */

export const RECOVERY_TIER = {
  TIER_1_SOFT: 1,
  TIER_2_COMPONENT: 2,
  TIER_3_SYSTEM: 3,
  TIER_4_DISASTER: 4,
} as const

export type RecoveryTier = (typeof RECOVERY_TIER)[keyof typeof RECOVERY_TIER]

const TIER_NAMES: Record<RecoveryTier, string> = {
  1: 'TIER_1_SOFT',
  2: 'TIER_2_COMPONENT',
  3: 'TIER_3_SYSTEM',
  4: 'TIER_4_DISASTER',
}

const TIER_NEXT: Partial<Record<RecoveryTier, RecoveryTier>> = {
  1: 2,
  2: 3,
  3: 4,
}

export type RecoveryStrategy =
  | 'retry'
  | 'switch_provider'
  | 'use_memory_fallback'
  | 'use_hardcoded_sop'
  | 'degrade_to_human'
  | 'switch_region'
  | 'abort'

export interface RecoveryAction {
  tier: RecoveryTier
  strategy: RecoveryStrategy
  maxRetries: number
  retryDelaySeconds: number
  timeoutSeconds: number
  fallbackValue: unknown
  notifyHuman: boolean
  /** 0 means never escalate on downtime. */
  escalateAfterSeconds: number
  metadata: Record<string, unknown>
}

export interface RecoveryContext {
  component: string
  error: string
  errorType: string
  occurredAt: number
  retryCount?: number
  totalDowntimeSeconds?: number
  previousTier?: RecoveryTier | null
  metadata?: Record<string, unknown>
}

export interface RecoveryResult {
  success: boolean
  value: unknown
  tierUsed: RecoveryTier
  strategyUsed: RecoveryStrategy
  attempts: number
  durationSeconds: number
  escalated: boolean
  error: string
}

function action(init: Partial<RecoveryAction> & Pick<RecoveryAction, 'tier' | 'strategy'>): RecoveryAction {
  return {
    maxRetries: 3,
    retryDelaySeconds: 1.0,
    timeoutSeconds: 30.0,
    fallbackValue: null,
    notifyHuman: false,
    escalateAfterSeconds: 0.0,
    metadata: {},
    ...init,
  }
}

export const DEFAULT_RECOVERY_STRATEGIES: Record<RecoveryTier, RecoveryAction> = {
  1: action({ tier: 1, strategy: 'retry', maxRetries: 3, retryDelaySeconds: 1.0, timeoutSeconds: 30.0 }),
  2: action({
    tier: 2,
    strategy: 'switch_provider',
    maxRetries: 2,
    retryDelaySeconds: 2.0,
    timeoutSeconds: 60.0,
    escalateAfterSeconds: 120.0,
  }),
  3: action({
    tier: 3,
    strategy: 'use_memory_fallback',
    timeoutSeconds: 120.0,
    notifyHuman: true,
    escalateAfterSeconds: 600.0,
  }),
  4: action({
    tier: 4,
    strategy: 'switch_region',
    timeoutSeconds: 300.0,
    notifyHuman: true,
    escalateAfterSeconds: 0.0,
  }),
}

// ---------------------------------------------------------------------------
// Error type / keyword classification tables
// ---------------------------------------------------------------------------

const TIER_1_ERROR_TYPES = new Set([
  'TimeoutError',
  'TimeoutException',
  'ConnectionError',
  'ConnectionResetError',
  'ConnectionAbortedError',
  'BrokenPipeError',
  'LLMRateLimitError',
  'RateLimitError',
  'LLMTimeoutError',
  'APITimeoutError',
])

const TIER_1_KEYWORDS = [
  'timeout',
  'timed out',
  'connection reset',
  'connection aborted',
  'broken pipe',
  '429',
  'rate_limit',
  'rate limit',
  'too many requests',
  'temporary',
  'transient',
]

const TIER_2_ERROR_TYPES = new Set([
  'ModelNotFoundError',
  'ModelNotAvailableError',
  'ProviderUnavailableError',
  'ToolExecutionError',
  'ToolTimeoutError',
  'ToolNotFoundError',
  'LLMAuthError',
  'LLMConnectionError',
])

const TIER_2_KEYWORDS = [
  'model_not_found',
  'model not found',
  'model disabled',
  'provider unavailable',
  'provider failed',
  'tool execution',
  'tool not found',
  'tool failed',
  'auth',
  'unauthorized',
  'no permission',
]

const TIER_3_ERROR_TYPES = new Set([
  'DatabaseError',
  'DatabaseCorruptError',
  'SQLiteError',
  'OperationalError',
  'StorageError',
  'EventBusError',
  'EventBusUnavailableError',
  'RedisError',
  'PostgresError',
])

const TIER_3_KEYWORDS = [
  'database',
  'sqlite',
  'postgres',
  'redis',
  'event_bus',
  'event bus',
  'event-bus',
  'storage error',
  'storage unavailable',
  'multiple providers failed',
  'all backups failed',
]

const TIER_4_ERROR_TYPES = new Set([
  'RegionUnreachableError',
  'DataCorruptionError',
  'DataLossError',
  'CatastrophicFailureError',
  'AllProvidersFailedError',
])

const TIER_4_KEYWORDS = [
  'region unreachable',
  'region unavailable',
  'region down',
  'data corruption',
  'data corrupt',
  'data loss',
  'all providers failed',
  'all backends failed',
  'catastrophic',
  'disaster',
]

function matchKeywords(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword))
}

// ---------------------------------------------------------------------------
// Collaborator interfaces
// ---------------------------------------------------------------------------

export interface RecoveryEventBus {
  emit(component: string, eventType: string, payload: Record<string, unknown>): unknown
}

export interface RecoveryMetricsCollector {
  recordRecovery?(input: {
    component: string
    durationSeconds: number
    success: boolean
  }): void
  incCounter?(name: string, labels: Record<string, string>): void
}

export interface RecoveryTierManagerOptions {
  strategies?: Partial<Record<RecoveryTier, RecoveryAction>>
  metricsCollector?: RecoveryMetricsCollector
  eventBus?: RecoveryEventBus
  /** Injectable sleep for retry backoff (tests). */
  sleep?: (seconds: number) => Promise<void>
  /** Injectable clock (epoch seconds). */
  now?: () => number
}

export type RecoveryOperation = (
  options: Record<string, unknown>,
) => unknown | Promise<unknown>

const defaultSleep = (seconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, seconds * 1000))

export class RecoveryTierManager {
  private readonly strategies: Record<RecoveryTier, RecoveryAction>
  private readonly metrics: RecoveryMetricsCollector | undefined
  private readonly eventBus: RecoveryEventBus | undefined
  private readonly sleep: (seconds: number) => Promise<void>
  private readonly now: () => number
  private readonly recoveryHistory: Array<Record<string, unknown>> = []
  private readonly tierStats: Record<
    RecoveryTier,
    { attempts: number; successes: number; failures: number; escalations: number }
  > = {
    1: { attempts: 0, successes: 0, failures: 0, escalations: 0 },
    2: { attempts: 0, successes: 0, failures: 0, escalations: 0 },
    3: { attempts: 0, successes: 0, failures: 0, escalations: 0 },
    4: { attempts: 0, successes: 0, failures: 0, escalations: 0 },
  }
  private totalRecoveries = 0

  constructor(options: RecoveryTierManagerOptions = {}) {
    this.strategies = { ...DEFAULT_RECOVERY_STRATEGIES, ...options.strategies }
    this.metrics = options.metricsCollector
    this.eventBus = options.eventBus
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? (() => Date.now() / 1000)
  }

  /** Classify a failure into a tier. Priority T4 > T3 > T2 > T1, default T1. */
  classifyError(errorType: string, errorMessage: string): RecoveryTier {
    const combined = `${errorType} ${errorMessage}`.toLowerCase()
    if (TIER_4_ERROR_TYPES.has(errorType) || matchKeywords(combined, TIER_4_KEYWORDS)) return 4
    if (TIER_3_ERROR_TYPES.has(errorType) || matchKeywords(combined, TIER_3_KEYWORDS)) return 3
    if (TIER_2_ERROR_TYPES.has(errorType) || matchKeywords(combined, TIER_2_KEYWORDS)) return 2
    if (TIER_1_ERROR_TYPES.has(errorType) || matchKeywords(combined, TIER_1_KEYWORDS)) return 1
    return 1
  }

  /** Strategy for a tier; unknown tiers fall back to defaults then T1. */
  getStrategy(tier: RecoveryTier): RecoveryAction {
    return this.strategies[tier] ?? DEFAULT_RECOVERY_STRATEGIES[tier] ?? DEFAULT_RECOVERY_STRATEGIES[1]
  }

  /** Escalate when retries exhausted or downtime exceeds the threshold. */
  shouldEscalate(context: RecoveryContext): boolean {
    const tier = context.previousTier ?? 1
    const strategy = this.getStrategy(tier)
    const retryCount = context.retryCount ?? 0
    const downtime = context.totalDowntimeSeconds ?? 0
    if (retryCount > strategy.maxRetries) return true
    if (strategy.escalateAfterSeconds > 0 && downtime > strategy.escalateAfterSeconds) return true
    return false
  }

  /** Next tier up; T4 stays at T4. */
  escalate(context: RecoveryContext): RecoveryTier {
    const currentTier = context.previousTier ?? 1
    if (currentTier === 4) return 4
    return TIER_NEXT[currentTier] ?? 4
  }

  /**
   * Classify the failure, run the tier strategy, and escalate on failure
   * (T1→T2→T3→T4, max chain depth 4). Emits recovery.* events.
   */
  async executeRecovery(
    context: RecoveryContext,
    operation: RecoveryOperation,
    options: Record<string, unknown> = {},
  ): Promise<RecoveryResult> {
    const startTime = this.now()
    this.totalRecoveries += 1

    let currentTier = this.classifyError(context.errorType, context.error)
    if (context.previousTier != null && context.previousTier > currentTier) {
      currentTier = context.previousTier
    }

    let strategy = this.getStrategy(currentTier)
    await this.emitEvent('recovery.started', {
      component: context.component,
      tier: currentTier,
      tier_name: TIER_NAMES[currentTier],
      strategy: strategy.strategy,
      error_type: context.errorType,
    })

    let attempts = 0
    let escalated = false
    let resultValue: unknown = null
    let resultSuccess = false
    let resultError = ''
    let strategyUsed: RecoveryStrategy = strategy.strategy
    let tierUsed: RecoveryTier = currentTier

    const maxChainDepth = 4
    let chainDepth = 0
    while (chainDepth < maxChainDepth) {
      chainDepth += 1
      strategy = this.getStrategy(currentTier)
      strategyUsed = strategy.strategy
      tierUsed = currentTier
      this.tierStats[currentTier].attempts += 1

      try {
        const [success, value, attemptsInStrategy, err] = await this.executeStrategy(
          strategy,
          operation,
          options,
        )
        attempts += attemptsInStrategy
        if (success) {
          resultSuccess = true
          resultValue = value
          resultError = ''
          this.tierStats[currentTier].successes += 1
          break
        }
        resultError = err
        this.tierStats[currentTier].failures += 1
      } catch (error) {
        resultError = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
        this.tierStats[currentTier].failures += 1
      }

      if (currentTier === 4) break

      escalated = true
      this.tierStats[currentTier].escalations += 1
      const nextTier = TIER_NEXT[currentTier] ?? 4
      await this.emitEvent('recovery.escalated', {
        component: context.component,
        from_tier: currentTier,
        from_tier_name: TIER_NAMES[currentTier],
        to_tier: nextTier,
        to_tier_name: TIER_NAMES[nextTier],
        reason: resultError.slice(0, 200),
      })
      currentTier = nextTier
    }

    const duration = this.now() - startTime
    const result: RecoveryResult = {
      success: resultSuccess,
      value: resultValue,
      tierUsed,
      strategyUsed,
      attempts,
      durationSeconds: duration,
      escalated,
      error: resultError,
    }

    this.recordMetrics(context.component, tierUsed, duration, resultSuccess, strategyUsed)
    await this.emitEvent(resultSuccess ? 'recovery.succeeded' : 'recovery.failed', {
      component: context.component,
      tier: tierUsed,
      tier_name: TIER_NAMES[tierUsed],
      strategy: strategyUsed,
      success: resultSuccess,
      attempts,
      duration_seconds: duration,
      escalated,
      error: resultError.slice(0, 500),
    })

    this.recoveryHistory.push({
      component: context.component,
      error_type: context.errorType,
      error: context.error.slice(0, 200),
      tier_used: tierUsed,
      tier_name: TIER_NAMES[tierUsed],
      strategy_used: strategyUsed,
      success: resultSuccess,
      attempts,
      duration_seconds: duration,
      escalated,
      timestamp: this.now(),
    })

    return result
  }

  private async executeStrategy(
    strategy: RecoveryAction,
    operation: RecoveryOperation,
    options: Record<string, unknown>,
  ): Promise<[boolean, unknown, number, string]> {
    switch (strategy.strategy) {
      case 'retry':
        return this.doRetry(strategy, operation, options)
      case 'switch_provider':
        return this.doSwitchProvider(strategy, operation, options)
      case 'use_memory_fallback':
      case 'use_hardcoded_sop':
        // fallback value returns immediately, no retries
        return [true, strategy.fallbackValue, 1, '']
      case 'degrade_to_human':
        // human degradation counts as "not auto-recovered"
        return [false, strategy.fallbackValue, 1, 'degraded to human']
      case 'switch_region':
        // region failover cannot complete in-process
        return [false, strategy.fallbackValue, 1, 'switch_region not available']
      case 'abort':
        return [false, null, 0, 'abort: strategy=abort']
      default:
        return [false, null, 0, `unknown strategy: ${String(strategy.strategy)}`]
    }
  }

  private async doRetry(
    strategy: RecoveryAction,
    operation: RecoveryOperation,
    options: Record<string, unknown>,
  ): Promise<[boolean, unknown, number, string]> {
    let lastError = ''
    let attempts = 0
    for (let attempt = 0; attempt < strategy.maxRetries; attempt++) {
      attempts += 1
      try {
        const result = await operation(options)
        return [true, result, attempts, '']
      } catch (error) {
        lastError = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
        // no wait after the final attempt
        if (attempt < strategy.maxRetries - 1 && strategy.retryDelaySeconds > 0) {
          await this.sleep(strategy.retryDelaySeconds * 2 ** attempt)
        }
      }
    }
    return [false, null, attempts, lastError]
  }

  private async doSwitchProvider(
    strategy: RecoveryAction,
    operation: RecoveryOperation,
    options: Record<string, unknown>,
  ): Promise<[boolean, unknown, number, string]> {
    let lastError = ''
    let attempts = 0
    const backupProviders = Array.isArray(strategy.metadata.backup_providers)
      ? (strategy.metadata.backup_providers as string[])
      : ['backup']
    for (const provider of backupProviders) {
      attempts += 1
      try {
        const result = await operation({ ...options, provider })
        return [true, result, attempts, '']
      } catch (error) {
        lastError = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
        if (strategy.retryDelaySeconds > 0) {
          await this.sleep(strategy.retryDelaySeconds)
        }
      }
    }
    return [false, null, attempts, lastError]
  }

  private async emitEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.eventBus) return
    try {
      await this.eventBus.emit(String(payload.component ?? ''), eventType, payload)
    } catch {
      // emit failures are non-fatal
    }
  }

  private recordMetrics(
    component: string,
    tier: RecoveryTier,
    durationSeconds: number,
    success: boolean,
    strategy: RecoveryStrategy,
  ): void {
    if (!this.metrics) return
    try {
      if (this.metrics.recordRecovery) {
        this.metrics.recordRecovery({ component, durationSeconds, success })
      } else if (this.metrics.incCounter) {
        this.metrics.incCounter(
          success ? 'flowforge_recovery_success_total' : 'flowforge_recovery_failure_total',
          { component, tier: TIER_NAMES[tier], strategy },
        )
      }
    } catch {
      // metrics failures are non-fatal
    }
  }

  /** History, newest first. */
  getRecoveryHistory(component?: string, limit = 50): Array<Record<string, unknown>> {
    const records = component
      ? this.recoveryHistory.filter(record => record.component === component)
      : [...this.recoveryHistory]
    records.sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))
    return records.slice(0, limit)
  }

  getStatus(): Record<string, unknown> {
    let totalSuccesses = 0
    let totalFailures = 0
    let totalEscalations = 0
    const perTierStats: Record<string, Record<string, number>> = {}
    for (const tier of [1, 2, 3, 4] as RecoveryTier[]) {
      const stats = this.tierStats[tier]
      totalSuccesses += stats.successes
      totalFailures += stats.failures
      totalEscalations += stats.escalations
      perTierStats[TIER_NAMES[tier]] = { ...stats }
    }
    return {
      total_recoveries: this.totalRecoveries,
      total_successes: totalSuccesses,
      total_failures: totalFailures,
      total_escalations: totalEscalations,
      success_rate: this.totalRecoveries > 0 ? totalSuccesses / this.totalRecoveries : 0.0,
      per_tier_stats: perTierStats,
      history_size: this.recoveryHistory.length,
    }
  }
}
