/**
 * StepLimiter — agent step limiting and context compaction triggers.
 *
 * Maps flowforge Python legacy core/step_limiter.py (F25):
 * - StepLimitConfig defaults: maxSteps 25 / warnAt 20 / compactAt 22 /
 *   maxRetries 3 / maxOutputTokensSchedule [4096, 8192, 16384].
 * - StepLimiter counters, prompt suffixes ([STEP LIMIT] / [STEP WARNING]),
 *   retry escalation and serialization snapshot.
 */

export interface StepLimiterLogger {
  warning(message: string): void
  error(message: string): void
}

const consoleLogger: StepLimiterLogger = {
  warning: message => console.warn(message),
  error: message => console.error(message),
}

export interface StepLimitConfig {
  /** Maximum steps (matches OpenCode default). */
  maxSteps: number
  /** Warning threshold. */
  warnAt: number
  /** Threshold at which context compaction should start. */
  compactAt: number
  /** Maximum retry count. */
  maxRetries: number
  /** Output-token budget schedule indexed by retry count. */
  maxOutputTokensSchedule: number[]
}

export const DEFAULT_STEP_LIMIT_CONFIG: StepLimitConfig = {
  maxSteps: 25,
  warnAt: 20,
  compactAt: 22,
  maxRetries: 3,
  maxOutputTokensSchedule: [4096, 8192, 16384],
}

export interface StepLimiterOptions {
  config?: Partial<StepLimitConfig>
  logger?: StepLimiterLogger
}

export class StepLimiter {
  readonly config: StepLimitConfig
  private currentStep = 0
  private retryCount = 0
  private readonly logger: StepLimiterLogger

  constructor(options: StepLimiterOptions = {}) {
    this.config = { ...DEFAULT_STEP_LIMIT_CONFIG, ...options.config }
    this.logger = options.logger ?? consoleLogger
  }

  /** Increment the step counter, emitting warn/exceed log points. */
  increment(): number {
    this.currentStep += 1
    if (this.shouldWarn && !this.isExceeded) {
      const remaining = this.config.maxSteps - this.currentStep
      this.logger.warning(
        `Step limit warning: ${this.currentStep}/${this.config.maxSteps} ` +
          `steps used, ${remaining} remaining`,
      )
    }
    if (this.isExceeded) {
      this.logger.error(
        `Step limit exceeded: ${this.currentStep}/${this.config.maxSteps}`,
      )
    }
    return this.currentStep
  }

  get step(): number {
    return this.currentStep
  }

  /** Whether the maximum step count has been reached. */
  get isExceeded(): boolean {
    return this.currentStep >= this.config.maxSteps
  }

  get shouldWarn(): boolean {
    return this.currentStep >= this.config.warnAt
  }

  get shouldCompact(): boolean {
    return this.currentStep >= this.config.compactAt
  }

  /** Tools should be disabled once steps are exhausted. */
  get toolsDisabled(): boolean {
    return this.isExceeded
  }

  get remainingSteps(): number {
    return Math.max(0, this.config.maxSteps - this.currentStep)
  }

  /** Max output tokens for the current retry level (clamped to schedule). */
  getMaxOutputTokens(): number {
    const idx = Math.min(
      this.retryCount,
      this.config.maxOutputTokensSchedule.length - 1,
    )
    return this.config.maxOutputTokensSchedule[idx] ?? 0
  }

  /**
   * Step-related prompt suffix (mirrors OpenCode MAX_STEPS_PROMPT):
   * force a final answer when exhausted, warn when nearing the limit.
   */
  getStepPromptSuffix(): string {
    if (this.isExceeded) {
      return (
        `\n\n[STEP LIMIT] You have reached the maximum of ${this.config.maxSteps} steps. ` +
        'You MUST NOT use any tools. Instead, provide your final answer now.'
      )
    }
    if (this.shouldWarn) {
      const remaining = this.config.maxSteps - this.currentStep
      return (
        `\n\n[STEP WARNING] You have used ${this.currentStep}/${this.config.maxSteps} steps. ` +
        `Only ${remaining} steps remaining. Prioritize completing your task.`
      )
    }
    return ''
  }

  /** Increment the retry counter, returning the new count. */
  incrementRetry(): number {
    this.retryCount += 1
    if (this.retryCount > this.config.maxRetries) {
      this.logger.error(
        `Max retries exceeded: ${this.retryCount}/${this.config.maxRetries}`,
      )
    }
    return this.retryCount
  }

  get retriesExceeded(): boolean {
    return this.retryCount > this.config.maxRetries
  }

  /** Reset both step and retry counters. */
  reset(): void {
    this.currentStep = 0
    this.retryCount = 0
  }

  /** Reset only the step counter (retry count preserved). */
  resetStep(): void {
    this.currentStep = 0
  }

  /** Serialize current state (snake_case, for persistence/debugging). */
  toRecord(): Record<string, unknown> {
    return {
      current_step: this.currentStep,
      max_steps: this.config.maxSteps,
      remaining_steps: this.remainingSteps,
      is_exceeded: this.isExceeded,
      should_warn: this.shouldWarn,
      should_compact: this.shouldCompact,
      tools_disabled: this.toolsDisabled,
      retry_count: this.retryCount,
      retries_exceeded: this.retriesExceeded,
      max_output_tokens: this.getMaxOutputTokens(),
    }
  }
}
