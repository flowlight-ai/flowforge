/**
 * FallbackChain — declarative fallback execution.
 *
 * Compact core mapped from flowforge Python legacy core/fallback_chain.py
 * (F25). Steps are tried in priority order until one succeeds; per-step
 * retry/timeout/condition; stop_on halts the chain on selected error
 * types. Executors (tool/agent/llm/function) are host-injected handlers,
 * keeping this package dependency-free.
 */

export type FallbackStepType = 'tool' | 'agent' | 'llm' | 'function'

export interface FallbackStepConfig {
  name: string
  type: FallbackStepType
  /** Tool name when type='tool'. */
  tool?: string
  /** Agent name when type='agent'. */
  agent?: string
  /** Prompt template when type='llm' (supports {{path}} variables). */
  prompt?: string
  /** Function path when type='function'. */
  function?: string
  /** Input parameter mapping (template variables resolved from context). */
  input?: Record<string, unknown>
  /** Per-step timeout in seconds. */
  timeout?: number
  /** Per-step retry count (total attempts = 1 + retry). */
  retry?: number
  /** Condition expression; step skipped when it evaluates falsy. */
  condition?: string
  description?: string
}

export interface AttemptRecord {
  stepName: string
  success: boolean
  error: string | null
  errorType: string | null
  /** Seconds spent on the final attempt. */
  duration: number
  result: unknown
}

export interface FallbackResult {
  success: boolean
  result: unknown
  successfulStep: string | null
  attempts: AttemptRecord[]
  totalTime: number
}

/** Host-injected step executors. */
export interface FallbackHandlers {
  tool?: (toolName: string, input: Record<string, unknown>) => Promise<unknown>
  agent?: (agentName: string, input: Record<string, unknown>) => Promise<unknown>
  llm?: (prompt: string, input: Record<string, unknown>) => Promise<unknown>
  function?: (functionPath: string, input: Record<string, unknown>) => Promise<unknown>
}

export interface FallbackChainOptions {
  /** Error types that halt the chain instead of falling through. */
  stopOn?: string[]
  name?: string
  description?: string
  /** Injectable monotonic clock (seconds). */
  now?: () => number
}

const defaultClock = () => Date.now() / 1000

// ---------------------------------------------------------------------------
// Template variable resolution ({{input.query}})
// ---------------------------------------------------------------------------

const TEMPLATE_PATTERN = /\{\{(\w+(?:\.\w+)*)\}\}/g

export function resolveTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_PATTERN, (match, keyPath: string) => {
      let current: unknown = context
      for (const part of keyPath.split('.')) {
        if (current !== null && typeof current === 'object' && part in (current as Record<string, unknown>)) {
          current = (current as Record<string, unknown>)[part]
        } else {
          return match
        }
      }
      return current !== null && current !== undefined ? String(current) : match
    })
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveTemplate(item, context))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        resolveTemplate(item, context),
      ]),
    )
  }
  return value
}

// ---------------------------------------------------------------------------
// Condition evaluation (simple three-token comparisons)
// ---------------------------------------------------------------------------

function resolveValueExpr(expr: string, context: Record<string, unknown>): unknown {
  // quoted literal
  if (
    (expr.startsWith("'") && expr.endsWith("'")) ||
    (expr.startsWith('"') && expr.endsWith('"'))
  ) {
    return expr.slice(1, -1)
  }
  // numeric literal
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr)
  // boolean literals
  if (expr === 'true' || expr === 'True') return true
  if (expr === 'false' || expr === 'False') return false
  // context path
  let current: unknown = context
  for (const part of expr.split('.')) {
    if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[part] ?? null
    } else {
      return null
    }
  }
  return current
}

/**
 * Evaluate a simple condition like `input.priority == 'high'`.
 * Unparseable expressions pass (legacy behavior), empty condition passes.
 */
export function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  if (!condition) return true
  const parts = condition.trim().split(/\s+/)
  const op = parts[1]
  if (parts.length === 3 && op !== undefined && ['==', '!=', '>', '<', '>=', '<='].includes(op)) {
    const left = resolveValueExpr(parts[0] ?? '', context)
    const right = resolveValueExpr(parts[2] ?? '', context)
    switch (op) {
      case '==':
        return left === right
      case '!=':
        return left !== right
      case '>':
        return (left as number) > (right as number)
      case '<':
        return (left as number) < (right as number)
      case '>=':
        return (left as number) >= (right as number)
      case '<=':
        return (left as number) <= (right as number)
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const AUTH_ERROR_PATTERNS = ['auth', 'authentication', 'unauthorized', '401', '403']
const PERMISSION_ERROR_PATTERNS = ['permission', 'forbidden', 'access_denied']

export function classifyError(errorMessage: string): string {
  const lower = errorMessage.toLowerCase()
  if (AUTH_ERROR_PATTERNS.some(pattern => lower.includes(pattern))) return 'auth_error'
  if (PERMISSION_ERROR_PATTERNS.some(pattern => lower.includes(pattern))) return 'permission_denied'
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout_error'
  if (lower.includes('not found')) return 'not_found_error'
  return 'execution_error'
}

// ---------------------------------------------------------------------------
// FallbackChain
// ---------------------------------------------------------------------------

export class FallbackChain {
  readonly chain: FallbackStepConfig[]
  readonly stopOn: string[]
  readonly name: string
  readonly description: string
  private readonly now: () => number

  constructor(chain: FallbackStepConfig[], options: FallbackChainOptions = {}) {
    this.chain = chain
    this.stopOn = options.stopOn ?? []
    this.name = options.name ?? ''
    this.description = options.description ?? ''
    this.now = options.now ?? defaultClock
  }

  /** Run steps in order until success, stop_on match or exhaustion. */
  async execute(
    context: Record<string, unknown>,
    handlers: FallbackHandlers,
  ): Promise<FallbackResult> {
    const startTime = this.now()
    const attempts: AttemptRecord[] = []

    for (const step of this.chain) {
      if (step.condition && !evaluateCondition(step.condition, context)) {
        attempts.push({
          stepName: step.name,
          success: false,
          error: 'Condition not met',
          errorType: 'condition_skipped',
          duration: 0,
          result: null,
        })
        continue
      }

      const resolvedInput = resolveTemplate(step.input ?? {}, context) as Record<string, unknown>
      const resolvedPrompt = step.prompt
        ? (resolveTemplate(step.prompt, context) as string)
        : undefined

      const attempt = await this.executeStepWithRetry(step, resolvedInput, resolvedPrompt, handlers)
      attempts.push(attempt)

      if (attempt.success) {
        return {
          success: true,
          result: attempt.result,
          successfulStep: step.name,
          attempts,
          totalTime: this.now() - startTime,
        }
      }

      if (attempt.errorType && this.stopOn.includes(attempt.errorType)) {
        return {
          success: false,
          result: null,
          successfulStep: null,
          attempts,
          totalTime: this.now() - startTime,
        }
      }
    }

    return {
      success: false,
      result: null,
      successfulStep: null,
      attempts,
      totalTime: this.now() - startTime,
    }
  }

  private async executeStepWithRetry(
    step: FallbackStepConfig,
    resolvedInput: Record<string, unknown>,
    resolvedPrompt: string | undefined,
    handlers: FallbackHandlers,
  ): Promise<AttemptRecord> {
    const timeoutSeconds = step.timeout ?? 30.0
    let lastError: string | null = null
    let lastErrorType: string | null = null
    let lastDuration = 0

    const maxAttempts = 1 + (step.retry ?? 0)
    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
      const stepStart = this.now()
      try {
        const result = await this.invokeStep(step, resolvedInput, resolvedPrompt, handlers, timeoutSeconds)
        return {
          stepName: step.name,
          success: true,
          error: null,
          errorType: null,
          duration: this.now() - stepStart,
          result,
        }
      } catch (error) {
        lastDuration = this.now() - stepStart
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith(`Timeout after ${timeoutSeconds}s`)) {
          lastError = message
          lastErrorType = 'timeout_error'
        } else {
          lastError = message
          lastErrorType = classifyError(message)
        }
      }
    }

    return {
      stepName: step.name,
      success: false,
      error: lastError,
      errorType: lastErrorType,
      duration: lastDuration,
      result: null,
    }
  }

  private async invokeStep(
    step: FallbackStepConfig,
    resolvedInput: Record<string, unknown>,
    resolvedPrompt: string | undefined,
    handlers: FallbackHandlers,
    timeoutSeconds: number,
  ): Promise<unknown> {
    let task: Promise<unknown>
    if (step.type === 'tool') {
      if (!handlers.tool) throw new Error(`No tool handler registered for step '${step.name}'`)
      task = handlers.tool(step.tool ?? '', resolvedInput)
    } else if (step.type === 'agent') {
      if (!handlers.agent) throw new Error(`No agent handler registered for step '${step.name}'`)
      task = handlers.agent(step.agent ?? '', resolvedInput)
    } else if (step.type === 'llm') {
      if (!handlers.llm) throw new Error(`No llm handler registered for step '${step.name}'`)
      task = handlers.llm(resolvedPrompt ?? '', resolvedInput)
    } else if (step.type === 'function') {
      if (!handlers.function) throw new Error(`No function handler registered for step '${step.name}'`)
      task = handlers.function(step.function ?? '', resolvedInput)
    } else {
      throw new Error(`Unknown step type: ${step.type}`)
    }

    return awaitWithTimeout(task, timeoutSeconds, `Timeout after ${timeoutSeconds}s`)
  }
}

async function awaitWithTimeout<T>(
  task: Promise<T>,
  timeoutSeconds: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutSeconds * 1000)
  })
  try {
    return await Promise.race([task, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
