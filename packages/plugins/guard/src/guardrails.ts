/**
 * Guardrails — parallel safety checks for agent execution.
 *
 * Maps flowforge Python legacy core/guardrails.py (F25). Guardrails run
 * in parallel with the main execution flow and can:
 * - PASS: allow execution to continue
 * - WARN: log a warning but allow execution
 * - BLOCK: stop execution immediately
 * - MODIFY: transform the input/output before proceeding
 */

export type GuardrailStatus = 'passed' | 'warned' | 'blocked' | 'modified'

export interface GuardrailResultInit {
  status?: GuardrailStatus
  message?: string
  /** Present when status is 'modified': the transformed data. */
  modifiedData?: string | null
}

export class GuardrailResult {
  readonly status: GuardrailStatus
  readonly message: string
  readonly modifiedData: string | null

  constructor(init: GuardrailResultInit = {}) {
    this.status = init.status ?? 'passed'
    this.message = init.message ?? ''
    this.modifiedData = init.modifiedData ?? null
  }
}

export type GuardrailContext = Record<string, unknown>

export abstract class InputGuardrail {
  name = 'unnamed_input_guardrail'
  abstract check(inputText: string, context: GuardrailContext): Promise<GuardrailResult>
}

export abstract class OutputGuardrail {
  name = 'unnamed_output_guardrail'
  abstract check(outputText: string, context: GuardrailContext): Promise<GuardrailResult>
}

export type Guardrail = InputGuardrail | OutputGuardrail

export interface GuardrailLogger {
  info(message: string): void
  warning(message: string): void
  error(message: string): void
}

const noopLogger: GuardrailLogger = {
  info: () => {},
  warning: () => {},
  error: () => {},
}

export class GuardrailRegistry {
  private readonly inputGuardrails = new Map<string, InputGuardrail>()
  private readonly outputGuardrails = new Map<string, OutputGuardrail>()

  constructor(private readonly logger: GuardrailLogger = noopLogger) {}

  /** Register a guardrail; duplicates (same name + side) are skipped. */
  register(guardrail: Guardrail): void {
    if (guardrail instanceof InputGuardrail) {
      if (this.inputGuardrails.has(guardrail.name)) {
        this.logger.info(`Input guardrail '${guardrail.name}' already registered, skipping duplicate`)
        return
      }
      this.inputGuardrails.set(guardrail.name, guardrail)
      this.logger.info(`Registered input guardrail: ${guardrail.name}`)
    } else if (guardrail instanceof OutputGuardrail) {
      if (this.outputGuardrails.has(guardrail.name)) {
        this.logger.info(`Output guardrail '${guardrail.name}' already registered, skipping duplicate`)
        return
      }
      this.outputGuardrails.set(guardrail.name, guardrail)
      this.logger.info(`Registered output guardrail: ${guardrail.name}`)
    } else {
      throw new TypeError(
        `Expected InputGuardrail or OutputGuardrail, got ${String(guardrail)}`,
      )
    }
  }

  /** Remove a guardrail by name from both registries; throws when absent. */
  unregister(name: string): void {
    let found = false
    if (this.inputGuardrails.delete(name)) found = true
    if (this.outputGuardrails.delete(name)) found = true
    if (!found) throw new Error(`Guardrail '${name}' not registered`)
  }

  getInputGuardrails(): InputGuardrail[] {
    return [...this.inputGuardrails.values()]
  }

  getOutputGuardrails(): OutputGuardrail[] {
    return [...this.outputGuardrails.values()]
  }
}

/**
 * Executes guardrails in parallel (Promise.allSettled semantics): one
 * failing guardrail never prevents the others from completing. A
 * 'blocked' result stops collection immediately, returning the results
 * gathered so far including the blocking one.
 */
export class GuardrailExecutor {
  constructor(
    private readonly registry: GuardrailRegistry,
    private readonly logger: GuardrailLogger = noopLogger,
  ) {}

  async runInputGuardrails(
    inputText: string,
    context: GuardrailContext,
  ): Promise<GuardrailResult[]> {
    const guardrails = this.registry.getInputGuardrails()
    if (guardrails.length === 0) return []
    const tasks = guardrails.map(guardrail => guardrail.check(inputText, context))
    return this.runParallel(tasks, guardrails)
  }

  async runOutputGuardrails(
    outputText: string,
    context: GuardrailContext,
  ): Promise<GuardrailResult[]> {
    const guardrails = this.registry.getOutputGuardrails()
    if (guardrails.length === 0) return []
    const tasks = guardrails.map(guardrail => guardrail.check(outputText, context))
    return this.runParallel(tasks, guardrails)
  }

  private async runParallel(
    tasks: Array<Promise<GuardrailResult>>,
    guardrails: Guardrail[],
  ): Promise<GuardrailResult[]> {
    const settled = await Promise.allSettled(tasks)
    const results: GuardrailResult[] = []
    for (let i = 0; i < settled.length; i++) {
      const outcome = settled[i] as PromiseSettledResult<GuardrailResult>
      const guardrailName = guardrails[i]?.name ?? `guardrail-${i}`
      if (outcome.status === 'rejected') {
        this.logger.error(`Guardrail '${guardrailName}' raised an error: ${outcome.reason}`)
        results.push(
          new GuardrailResult({
            status: 'warned',
            message: `Guardrail '${guardrailName}' error: ${outcome.reason}`,
          }),
        )
        continue
      }
      const raw = outcome.value
      if (raw instanceof GuardrailResult) {
        results.push(raw)
        if (raw.status === 'blocked') {
          this.logger.warning(
            `Guardrail '${guardrailName}' blocked execution: ${raw.message}`,
          )
          return results
        }
        if (raw.status === 'warned') {
          this.logger.warning(`Guardrail '${guardrailName}' warning: ${raw.message}`)
        } else if (raw.status === 'modified') {
          this.logger.info(`Guardrail '${guardrailName}' modified data: ${raw.message}`)
        }
      } else {
        this.logger.error(
          `Guardrail '${guardrailName}' returned unexpected type: ${typeof raw}`,
        )
        results.push(
          new GuardrailResult({
            status: 'warned',
            message: `Guardrail '${guardrailName}' returned unexpected type`,
          }),
        )
      }
    }
    return results
  }
}
