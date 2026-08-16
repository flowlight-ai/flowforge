/**
 * CircuitBreaker — fault isolation with half-open probing.
 *
 * Faithful map of flowforge Python legacy core/circuit_breaker.py (F25):
 * closed/open/half_open state machine, open→half_open auto-transition
 * after recoveryTimeout, named breaker registry, and AgentExecutionGuard
 * (per-agent breaker + timeout, from DevForge agent_guard).
 */

export type CircuitState = 'closed' | 'open' | 'half_open'

export class CircuitOpenError extends Error {
  constructor(breakerName: string) {
    super(`Circuit '${breakerName}' is open`)
    this.name = 'CircuitOpenError'
  }
}

export interface CircuitBreakerOptions {
  failureThreshold?: number
  /** Seconds before an open breaker transitions to half_open. */
  recoveryTimeout?: number
  halfOpenMaxCalls?: number
  /** Injectable monotonic clock (seconds) for tests. */
  now?: () => number
}

const defaultClock = () => Date.now() / 1000

export class CircuitBreaker {
  readonly name: string
  readonly failureThreshold: number
  readonly recoveryTimeout: number
  readonly halfOpenMaxCalls: number

  private stateField: CircuitState = 'closed'
  private failureCount = 0
  private successCount = 0
  private lastFailureTime = 0
  private halfOpenCalls = 0
  private totalCalls = 0
  private totalFailures = 0
  private totalSuccesses = 0
  private readonly now: () => number

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name
    this.failureThreshold = options.failureThreshold ?? 5
    this.recoveryTimeout = options.recoveryTimeout ?? 60.0
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 3
    this.now = options.now ?? defaultClock
  }

  /** Current state; open breakers auto-move to half_open after recoveryTimeout. */
  get state(): CircuitState {
    if (this.stateField === 'open') {
      if (this.now() - this.lastFailureTime >= this.recoveryTimeout) {
        this.stateField = 'half_open'
        this.halfOpenCalls = 0
      }
    }
    return this.stateField
  }

  get isAvailable(): boolean {
    const state = this.state
    if (state === 'closed') return true
    if (state === 'half_open') return this.halfOpenCalls < this.halfOpenMaxCalls
    return false
  }

  canExecute(): boolean {
    return this.isAvailable
  }

  recordSuccess(): void {
    this.successCount += 1
    this.totalSuccesses += 1
    this.totalCalls += 1
    if (this.stateField === 'half_open') {
      this.stateField = 'closed'
      this.failureCount = 0
    } else {
      this.failureCount = 0
    }
  }

  recordFailure(): void {
    this.failureCount += 1
    this.totalFailures += 1
    this.totalCalls += 1
    this.lastFailureTime = this.now()
    if (this.failureCount >= this.failureThreshold) {
      this.stateField = 'open'
    }
  }

  recordHalfOpenCall(): void {
    this.halfOpenCalls += 1
  }

  getState(): CircuitState {
    return this.state
  }

  /** Reset to closed (lifetime totals are preserved). */
  reset(): void {
    this.stateField = 'closed'
    this.failureCount = 0
    this.successCount = 0
    this.halfOpenCalls = 0
  }

  getStats(): Record<string, unknown> {
    return {
      name: this.name,
      state: this.state,
      failure_count: this.failureCount,
      success_count: this.successCount,
      failure_threshold: this.failureThreshold,
      recovery_timeout: this.recoveryTimeout,
      half_open_max_calls: this.halfOpenMaxCalls,
      half_open_calls: this.halfOpenCalls,
      last_failure_time: this.lastFailureTime,
      total_calls: this.totalCalls,
      total_failures: this.totalFailures,
      total_successes: this.totalSuccesses,
    }
  }

  /** Wrap a call: rejects with CircuitOpenError when unavailable. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable) {
      throw new CircuitOpenError(this.name)
    }
    if (this.state === 'half_open') {
      this.recordHalfOpenCall()
    }
    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure()
      throw error
    }
  }
}

// ---------------------------------------------------------------------------
// Named breaker registry
// ---------------------------------------------------------------------------

const breakers = new Map<string, CircuitBreaker>()

/** Get or create a named breaker; existing instances win over new options. */
export function getCircuitBreaker(
  name: string,
  options: CircuitBreakerOptions = {},
): CircuitBreaker {
  let breaker = breakers.get(name)
  if (!breaker) {
    breaker = new CircuitBreaker(name, options)
    breakers.set(name, breaker)
  }
  return breaker
}

/** Reset every registered breaker. */
export function resetAllBreakers(): void {
  for (const breaker of breakers.values()) breaker.reset()
}

/** Test helper: clear the registry entirely. */
export function clearBreakerRegistry(): void {
  breakers.clear()
}

// ---------------------------------------------------------------------------
// AgentExecutionGuard (from DevForge agent_guard)
// ---------------------------------------------------------------------------

export interface AgentExecutionGuardOptions {
  defaultTimeout?: number
  failureThreshold?: number
  recoveryTimeout?: number
  now?: () => number
}

/** Per-agent circuit breaking plus timeout budgets. */
export class AgentExecutionGuard {
  private readonly defaultTimeout: number
  private readonly failureThreshold: number
  private readonly recoveryTimeout: number
  private readonly now: () => number
  private readonly agentBreakers = new Map<string, CircuitBreaker>()
  private readonly timeouts = new Map<string, number>()

  constructor(options: AgentExecutionGuardOptions = {}) {
    this.defaultTimeout = options.defaultTimeout ?? 300.0
    this.failureThreshold = options.failureThreshold ?? 3
    this.recoveryTimeout = options.recoveryTimeout ?? 300.0
    this.now = options.now ?? defaultClock
  }

  getBreaker(agentName: string): CircuitBreaker {
    let breaker = this.agentBreakers.get(agentName)
    if (!breaker) {
      breaker = new CircuitBreaker(agentName, {
        failureThreshold: this.failureThreshold,
        recoveryTimeout: this.recoveryTimeout,
        now: this.now,
      })
      this.agentBreakers.set(agentName, breaker)
    }
    return breaker
  }

  setAgentTimeout(agentName: string, timeoutSeconds: number): void {
    this.timeouts.set(agentName, timeoutSeconds)
  }

  getAgentTimeout(agentName: string): number {
    return this.timeouts.get(agentName) ?? this.defaultTimeout
  }

  isAvailable(agentName: string): boolean {
    return this.getBreaker(agentName).isAvailable
  }

  recordSuccess(agentName: string): void {
    this.getBreaker(agentName).recordSuccess()
  }

  recordFailure(agentName: string): void {
    this.getBreaker(agentName).recordFailure()
  }

  getAllStatus(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {}
    for (const [name, breaker] of this.agentBreakers) {
      const stats = breaker.getStats()
      result[name] = {
        state: stats.state,
        failure_count: stats.failure_count,
        is_available: breaker.isAvailable,
        timeout: this.getAgentTimeout(name),
      }
    }
    return result
  }
}
