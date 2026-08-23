/**
 * ResilienceExecutor — P3-005 灾备降级 100% 成功保障.
 *
 * Faithful map of the ResilienceExecutor half of flowforge Python legacy
 * core/degradation.py (F23): [primary] + backup provider chain with
 * exponential backoff retries, permanent-error fast switching, silent
 * failure detection (openroute HTTP 200 with unavailable content),
 * quality gates, quota checks and the three-tier on-all-fail policy
 * (raise / return_default / degrade_to_human).
 */

import { DegradationDecisionTree, type DegradationCollaborators } from './degradation.ts'

/** Permanent errors: never retried, switch to the next provider. */
export const PERMANENT_ERROR_KEYWORDS: readonly string[] = [
  'model_not_found',
  'no_permission',
  'model disabled',
  'all_backends_failed',
  '无权访问',
  '当前不可用',
  'empty_response',
  '无法回答',
]

/** Temporary errors: retried with exponential backoff. */
export const TEMPORARY_ERROR_KEYWORDS: readonly string[] = [
  'timeout',
  'rate_limit',
  '429',
  'connection',
  '503',
  '502',
]

/** Silent failure markers (HTTP 200 but unusable content). */
export const SILENT_FAILURE_KEYWORDS: readonly string[] = [
  '当前不可用，请稍后重试',
  '当前不可用,请稍后重试',
  '服务暂时不可用',
]

export interface ResilienceAttemptRecord {
  provider: string
  success: boolean
  errorType: string
  errorMsg: string
  attemptsCount: number
  durationSeconds: number
  silentFailure: boolean
  value: unknown
}

export interface ResilienceResult {
  success: boolean
  value: unknown
  providerUsed: string
  attempts: Array<Record<string, unknown>>
  totalDurationSeconds: number
  fallbackUsed: boolean
  degradationAction?: string | undefined
}

export class AllProvidersFailedError extends Error {
  readonly attempts: ResilienceAttemptRecord[]

  constructor(message: string, attempts: ResilienceAttemptRecord[] = []) {
    super(message)
    this.name = 'AllProvidersFailedError'
    this.attempts = attempts
  }
}

export interface ResilienceQuotaManager {
  checkQuota(provider: string): Promise<boolean> | boolean
}

export interface ResilienceMetricsCollector {
  recordDegradation?(input: { provider: string; success: boolean; reason?: string }): void
  incCounter?(name: string, labels: Record<string, string>): void
}

export type ResilienceOnAllFail = 'raise' | 'return_default' | 'degrade_to_human'

export interface ExecuteWithResilienceOptions {
  /** Policy when every provider fails (default 'raise'). */
  onAllFail?: ResilienceOnAllFail | undefined
  /** Value returned when onAllFail='return_default'. */
  defaultValue?: unknown
  /** Quality gate; returning false fails the attempt and switches provider. */
  qualityCheckFn?: ((value: unknown) => boolean) | undefined
}

export interface ResilienceExecutorOptions {
  quotaManager?: ResilienceQuotaManager | undefined
  metricsCollector?: ResilienceMetricsCollector | undefined
  maxRetries?: number | undefined
  baseRetryDelay?: number | undefined
  /** Collaborators forwarded to the degradation tree on human degradation. */
  degradation?: DegradationCollaborators | undefined
  /** Injectable clock (epoch seconds) for tests. */
  now?: (() => number) | undefined
  /** Injectable sleep (seconds) for tests. */
  sleep?: ((seconds: number) => Promise<void>) | undefined
}

/** Operation receives the active provider as its first argument. */
export type ResilienceOperation = (provider: string) => unknown

export class ResilienceExecutor {
  readonly primaryProvider: string
  readonly backupProviders: string[]
  readonly maxRetries: number
  readonly baseRetryDelay: number

  private readonly quotaManager: ResilienceQuotaManager | undefined
  private readonly metrics: ResilienceMetricsCollector | undefined
  private readonly degradation: DegradationCollaborators | undefined
  private readonly now: () => number
  private readonly sleep: (seconds: number) => Promise<void>

  private totalExecutions = 0
  private totalSuccesses = 0
  private totalFailures = 0
  private degradationCount = 0
  private readonly perProviderStats = new Map<string, { success: number; failure: number }>()

  constructor(primaryProvider: string, backupProviders: string[], options: ResilienceExecutorOptions = {}) {
    if (!primaryProvider) throw new Error('primary_provider must not be empty')
    const maxRetries = options.maxRetries ?? 3
    const baseRetryDelay = options.baseRetryDelay ?? 1.0
    if (maxRetries < 1) throw new Error('max_retries must be >= 1')
    if (baseRetryDelay < 0) throw new Error('base_retry_delay must be >= 0')
    this.primaryProvider = primaryProvider
    this.backupProviders = [...backupProviders]
    this.maxRetries = maxRetries
    this.baseRetryDelay = baseRetryDelay
    this.quotaManager = options.quotaManager
    this.metrics = options.metricsCollector
    this.degradation = options.degradation
    this.now = options.now ?? (() => Date.now() / 1000)
    this.sleep = options.sleep ?? (seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000)))
  }

  /** Try [primary] + backups in order; guarantees a result for sane backups. */
  async executeWithResilience(
    operation: ResilienceOperation,
    options: ExecuteWithResilienceOptions = {},
  ): Promise<ResilienceResult> {
    const startTime = this.now()
    this.totalExecutions += 1
    const onAllFail = options.onAllFail ?? 'raise'
    const allAttempts: ResilienceAttemptRecord[] = []
    const providers = [this.primaryProvider, ...this.backupProviders]

    for (const provider of providers) {
      if (this.quotaManager) {
        let quotaOk = true
        try {
          quotaOk = await this.quotaManager.checkQuota(provider)
        } catch {
          quotaOk = true // check failures never block execution
        }
        if (!quotaOk) {
          allAttempts.push({
            provider,
            success: false,
            errorType: 'quota_exceeded',
            errorMsg: `Provider ${provider} quota exceeded`,
            attemptsCount: 0,
            durationSeconds: 0,
            silentFailure: false,
            value: null,
          })
          this.recordProviderFailure(provider)
          this.recordMetrics(provider, false, 'quota_exceeded')
          continue
        }
      }

      const record = await this.tryProvider(provider, operation, options.qualityCheckFn)
      allAttempts.push(record)

      if (record.success) {
        this.totalSuccesses += 1
        this.recordProviderSuccess(provider)
        this.recordMetrics(provider, true)
        return {
          success: true,
          value: record.value,
          providerUsed: provider,
          attempts: allAttempts.map(attempt => this.attemptToDict(attempt)),
          totalDurationSeconds: this.now() - startTime,
          fallbackUsed: provider !== this.primaryProvider,
        }
      }

      this.recordProviderFailure(provider)
      this.recordMetrics(provider, false, `${record.errorType}: ${record.errorMsg}`)
    }

    // every provider failed
    const duration = this.now() - startTime
    this.totalFailures += 1
    this.degradationCount += 1

    if (onAllFail === 'return_default') {
      return {
        success: false,
        value: options.defaultValue ?? null,
        providerUsed: '',
        attempts: allAttempts.map(attempt => this.attemptToDict(attempt)),
        totalDurationSeconds: duration,
        fallbackUsed: true,
        degradationAction: 'return_default',
      }
    }

    if (onAllFail === 'degrade_to_human') {
      const action = await this.degradeToHuman(allAttempts)
      return {
        success: false,
        value: options.defaultValue ?? null,
        providerUsed: '',
        attempts: allAttempts.map(attempt => this.attemptToDict(attempt)),
        totalDurationSeconds: duration,
        fallbackUsed: true,
        degradationAction: action,
      }
    }

    throw new AllProvidersFailedError(
      `All ${providers.length} providers failed (primary=${this.primaryProvider})`,
      allAttempts,
    )
  }

  // -------------------------------------------------------------------------
  // Single-provider attempt with exponential backoff
  // -------------------------------------------------------------------------

  private async tryProvider(
    provider: string,
    operation: ResilienceOperation,
    qualityCheckFn?: (value: unknown) => boolean,
  ): Promise<ResilienceAttemptRecord> {
    const start = this.now()
    let attemptsCount = 0
    let lastErrorType = ''
    let lastErrorMsg = ''
    let silentFailure = false
    let value: unknown = null
    let success = false

    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      attemptsCount = attempt + 1
      try {
        let result = operation(provider)
        if (result !== null && typeof (result as Promise<unknown>)?.then === 'function') {
          result = await (result as Promise<unknown>)
        }

        if (this.isSilentFailureResult(result)) {
          silentFailure = true
          lastErrorType = 'silent_failure'
          lastErrorMsg = 'openroute silent failure detected: HTTP 200 with unavailable content'
          break // silent failures switch provider without retrying
        }

        if (qualityCheckFn) {
          let qualityOk = true
          try {
            qualityOk = qualityCheckFn(result)
          } catch {
            qualityOk = true // gate errors never block execution
          }
          if (!qualityOk) {
            lastErrorType = 'quality_check_failed'
            lastErrorMsg = 'Quality check failed'
            break // quality failures switch provider without retrying
          }
        }

        value = result
        success = true
        break
      } catch (error) {
        lastErrorType = error instanceof Error ? error.name || error.constructor.name : typeof error
        lastErrorMsg = error instanceof Error ? error.message : String(error)
        const errorClass = this.classifyError(lastErrorMsg, lastErrorType)

        if (errorClass === 'silent_failure') {
          silentFailure = true
          lastErrorType = 'silent_failure'
          break
        }
        if (errorClass === 'permanent') break // permanent errors never retry

        if (attempt < this.maxRetries - 1 && this.baseRetryDelay > 0) {
          await this.sleep(this.baseRetryDelay * 2 ** attempt)
        }
      }
    }

    return {
      provider,
      success,
      errorType: success ? '' : lastErrorType,
      errorMsg: success ? '' : lastErrorMsg,
      attemptsCount,
      durationSeconds: this.now() - start,
      silentFailure,
      value: success ? value : null,
    }
  }

  // -------------------------------------------------------------------------
  // Error classification
  // -------------------------------------------------------------------------

  classifyError(message: string, errorType = ''): 'permanent' | 'temporary' | 'silent_failure' {
    const combined = `${message} ${errorType}`.toLowerCase()
    if (this.isSilentFailure(message)) return 'silent_failure'
    for (const kw of PERMANENT_ERROR_KEYWORDS) {
      if (combined.includes(kw)) return 'permanent'
    }
    for (const kw of TEMPORARY_ERROR_KEYWORDS) {
      if (combined.includes(kw)) return 'temporary'
    }
    return 'temporary' // unknown errors are retryable
  }

  private isSilentFailure(content: string): boolean {
    if (!content) return false
    const text = typeof content === 'string' ? content : String(content)
    return SILENT_FAILURE_KEYWORDS.some(kw => text.includes(kw))
  }

  private isSilentFailureResult(result: unknown): boolean {
    if (typeof result === 'string') return this.isSilentFailure(result)
    if (result !== null && typeof result === 'object') {
      for (const key of ['content', 'text', 'response', 'output', 'message', 'result']) {
        const val = (result as Record<string, unknown>)[key]
        if (typeof val === 'string' && this.isSilentFailure(val)) return true
      }
    }
    return false
  }

  // -------------------------------------------------------------------------
  // Human degradation via the decision tree
  // -------------------------------------------------------------------------

  private async degradeToHuman(attempts: ResilienceAttemptRecord[]): Promise<string> {
    const tree = new DegradationDecisionTree(this.degradation ?? {})
    const last = attempts[attempts.length - 1]
    // synthesized error carries a timeout marker so the tree classifies it
    // as an LLM failure and returns degrade_to_human
    const synthError = new Error(
      `LLM providers exhausted (timeout-like condition). All providers failed. ` +
        `Last error: ${last ? last.errorType : 'unknown'}: ${last ? last.errorMsg : ''}`,
    )
    try {
      const action = await tree.decide('resilience_executor', synthError, {
        attempts: attempts.map(attempt => this.attemptToDict(attempt)),
      })
      return action.actionType
    } catch {
      return 'degrade_to_human'
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private attemptToDict(record: ResilienceAttemptRecord): Record<string, unknown> {
    return {
      provider: record.provider,
      success: record.success,
      error_type: record.errorType,
      error_msg: record.errorMsg,
      attempts_count: record.attemptsCount,
      duration_seconds: record.durationSeconds,
      silent_failure: record.silentFailure,
      value: record.value,
    }
  }

  private recordProviderSuccess(provider: string): void {
    const stats = this.perProviderStats.get(provider) ?? { success: 0, failure: 0 }
    stats.success += 1
    this.perProviderStats.set(provider, stats)
  }

  private recordProviderFailure(provider: string): void {
    const stats = this.perProviderStats.get(provider) ?? { success: 0, failure: 0 }
    stats.failure += 1
    this.perProviderStats.set(provider, stats)
  }

  private recordMetrics(provider: string, success: boolean, reason = ''): void {
    if (!this.metrics) return
    try {
      if (this.metrics.recordDegradation) {
        this.metrics.recordDegradation({ provider, success, reason })
      } else if (this.metrics.incCounter) {
        this.metrics.incCounter(success ? 'resilience_success_total' : 'resilience_failure_total', {
          provider,
        })
      }
    } catch {
      // metrics failures are non-fatal
    }
  }

  /** Success rate, degradation counts and per-provider stats. */
  getResilienceStatus(): Record<string, unknown> {
    const perProvider: Record<string, { success: number; failure: number }> = {}
    for (const [provider, stats] of this.perProviderStats) perProvider[provider] = { ...stats }
    return {
      total_executions: this.totalExecutions,
      total_successes: this.totalSuccesses,
      total_failures: this.totalFailures,
      success_rate: this.totalExecutions > 0 ? this.totalSuccesses / this.totalExecutions : 0.0,
      degradation_count: this.degradationCount,
      primary_provider: this.primaryProvider,
      backup_providers: [...this.backupProviders],
      per_provider_stats: perProvider,
    }
  }
}
