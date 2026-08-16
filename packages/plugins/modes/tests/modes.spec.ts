/**
 * Contract suite: BaseModeExecutor pipeline order, ModeRegistry,
 * StepLimiter thresholds/prompt suffixes/token schedule, ExecutionPolicy
 * defaults/backoff/templates/config merging, and AgentTimeout wrapper.
 */

import { describe, expect, it } from 'vitest'
import {
  AgentTimeoutError,
  BaseModeExecutor,
  ExecutionPolicy,
  ModeRegistry,
  StepLimiter,
  getPolicy,
  policyFromConfig,
  withTimeout,
} from '../src/index.ts'

const silentLogger = { warning: () => {}, error: () => {} }

describe('BaseModeExecutor', () => {
  it('runs the fixed pipeline prepare → onEnter → executeCore → onExit → postprocess', async () => {
    const calls: string[] = []
    class DraftMode extends BaseModeExecutor {
      readonly modeName = 'draft'
      constructor() {
        super()
        this.capabilities.push('drafting')
      }
      protected override async prepare(ctx: ModeContextLike) {
        calls.push('prepare')
        return { ...ctx, prepared: true }
      }
      protected override async onEnter() {
        calls.push('onEnter')
      }
      protected override async executeCore() {
        calls.push('executeCore')
        return { body: 'draft' }
      }
      protected override async onExit(_ctx: unknown, result: Record<string, unknown>) {
        calls.push('onExit')
        return { ...result, exited: true }
      }
      protected override async postprocess(_ctx: unknown, result: Record<string, unknown>) {
        calls.push('postprocess')
        return { ...result, done: true }
      }
    }
    type ModeContextLike = Record<string, unknown>
    const executor = new DraftMode()
    const result = await executor.run({})
    expect(calls).toEqual(['prepare', 'onEnter', 'executeCore', 'onExit', 'postprocess'])
    expect(result).toEqual({ body: 'draft', exited: true, done: true })
    expect(executor.capabilities).toEqual(['drafting'])
  })

  it('registry stores executors by modeName', () => {
    class A extends BaseModeExecutor {
      readonly modeName = 'alpha'
      protected override async executeCore() {
        return {}
      }
    }
    const registry = new ModeRegistry()
    const a = new A()
    registry.register(a)
    expect(registry.has('alpha')).toBe(true)
    expect(registry.get('alpha')).toBe(a)
    expect(registry.listModes()).toEqual(['alpha'])
    expect(registry.unregister('alpha')).toBe(true)
    expect(registry.has('alpha')).toBe(false)
  })
})

describe('StepLimiter', () => {
  it('applies default thresholds 25/20/22 and disables tools when exhausted', () => {
    const limiter = new StepLimiter({ logger: silentLogger })
    expect(limiter.config.maxSteps).toBe(25)
    expect(limiter.config.warnAt).toBe(20)
    expect(limiter.config.compactAt).toBe(22)
    for (let i = 0; i < 19; i++) limiter.increment()
    expect(limiter.shouldWarn).toBe(false)
    limiter.increment() // 20
    expect(limiter.shouldWarn).toBe(true)
    expect(limiter.isExceeded).toBe(false)
    limiter.increment()
    limiter.increment() // 22
    expect(limiter.shouldCompact).toBe(true)
    while (!limiter.isExceeded) limiter.increment() // 25
    expect(limiter.toolsDisabled).toBe(true)
    expect(limiter.remainingSteps).toBe(0)
  })

  it('emits [STEP WARNING] then [STEP LIMIT] prompt suffixes', () => {
    const limiter = new StepLimiter({ config: { maxSteps: 5, warnAt: 3 }, logger: silentLogger })
    limiter.increment()
    expect(limiter.getStepPromptSuffix()).toBe('')
    limiter.increment()
    limiter.increment() // 3
    expect(limiter.getStepPromptSuffix()).toContain('[STEP WARNING]')
    expect(limiter.getStepPromptSuffix()).toContain('Only 2 steps remaining')
    limiter.increment()
    limiter.increment() // 5
    const suffix = limiter.getStepPromptSuffix()
    expect(suffix).toContain('[STEP LIMIT] You have reached the maximum of 5 steps.')
    expect(suffix).toContain('You MUST NOT use any tools')
  })

  it('escalates the output-token budget with retries and clamps to the schedule', () => {
    const limiter = new StepLimiter({ logger: silentLogger })
    expect(limiter.getMaxOutputTokens()).toBe(4096)
    limiter.incrementRetry()
    expect(limiter.getMaxOutputTokens()).toBe(8192)
    limiter.incrementRetry()
    expect(limiter.getMaxOutputTokens()).toBe(16384)
    limiter.incrementRetry()
    limiter.incrementRetry() // 4 > maxRetries 3
    expect(limiter.getMaxOutputTokens()).toBe(16384)
    expect(limiter.retriesExceeded).toBe(true)
  })

  it('reset clears both counters while resetStep keeps retries', () => {
    const limiter = new StepLimiter({ logger: silentLogger })
    limiter.increment()
    limiter.incrementRetry()
    limiter.resetStep()
    expect(limiter.step).toBe(0)
    expect(limiter.getMaxOutputTokens()).toBe(8192)
    limiter.reset()
    expect(limiter.getMaxOutputTokens()).toBe(4096)
    const record = limiter.toRecord()
    expect(record.current_step).toBe(0)
    expect(record.retries_exceeded).toBe(false)
    expect(record.max_output_tokens).toBe(4096)
  })
})

describe('ExecutionPolicy', () => {
  it('uses the documented defaults', () => {
    const policy = new ExecutionPolicy()
    expect(policy.timeout).toBe(300)
    expect(policy.retry).toBe(2)
    expect(policy.retryDelay).toBe(2.0)
    expect(policy.backoffStrategy).toBe('exponential')
    expect(policy.backoffBase).toBe(2)
    expect(policy.onError).toBe('fallback')
    expect(policy.onAnomaly).toBe('reflect')
  })

  it('computes exponential and fixed retry delays', () => {
    const exponential = new ExecutionPolicy()
    expect(exponential.computeDelay(1)).toBe(2)
    expect(exponential.computeDelay(2)).toBe(4)
    expect(exponential.computeDelay(3)).toBe(8)
    const fixed = new ExecutionPolicy({ backoffStrategy: 'fixed', retryDelay: 5 })
    expect(fixed.computeDelay(1)).toBe(5)
    expect(fixed.computeDelay(4)).toBe(5)
  })

  it('rejects invalid backoff strategies', () => {
    expect(() => new ExecutionPolicy({ backoffStrategy: 'linear' as never })).toThrow(
      /backoff_strategy must be 'fixed' or 'exponential'/,
    )
  })

  it('renders WorkflowNodeConfig with fallback_chain (agent preferred over tool)', () => {
    const agentPolicy = new ExecutionPolicy({ fallbackAgent: 'writer-b' })
    expect(agentPolicy.toWorkflowNodeConfig()).toMatchObject({
      timeout: 300,
      retry_count: 2,
      retry_delay: 2.0,
      on_error: 'fallback',
      fallback_chain: [{ agent: 'writer-b' }],
    })
    const toolPolicy = new ExecutionPolicy({ fallbackTool: 'search' })
    expect(toolPolicy.toWorkflowNodeConfig().fallback_chain).toEqual([{ tool: 'search' }])
    expect(new ExecutionPolicy().toWorkflowNodeConfig().fallback_chain).toBeUndefined()
  })

  it('exposes the six predefined templates', () => {
    expect(getPolicy('strict').timeout).toBe(600)
    expect(getPolicy('strict').retry).toBe(0)
    expect(getPolicy('strict').onError).toBe('abort')
    expect(getPolicy('resilient').retry).toBe(5)
    expect(getPolicy('resilient').onAnomaly).toBe('retry')
    expect(getPolicy('content_creation').timeout).toBe(600)
    expect(getPolicy('novel_writing').timeout).toBe(900)
    expect(getPolicy('novel_writing').onError).toBe('reflexion_retry')
    expect(getPolicy('code_review').onAnomaly).toBe('escalate')
    // Unknown templates fall back to default
    const unknown = getPolicy('nope')
    expect(unknown.timeout).toBe(300)
    expect(unknown.onError).toBe('fallback')
  })

  it('merges template + non-null overrides and preserves extra keys', () => {
    const merged = policyFromConfig({ template: 'resilient', timeout: 600, note: 'keep-me' })
    expect(merged.retry).toBe(5) // from resilient
    expect(merged.timeout).toBe(600) // override
    expect(merged.extra.note).toBe('keep-me')

    const snake = policyFromConfig({ template: 'strict', retry_delay: 9, skip_me: null })
    expect(snake.retryDelay).toBe(9)
    expect(snake.onError).toBe('abort')

    expect(policyFromConfig({}).timeout).toBe(300)
  })
})

describe('agent timeout', () => {
  it('formats AgentTimeoutError like the legacy wrapper', () => {
    const error = new AgentTimeoutError('planner', 300)
    expect(error.message).toBe("Agent 'planner' timed out after 300s")
    expect(error.agentName).toBe('planner')
  })

  it('withTimeout resolves fast tasks and rejects slow ones', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1, 'a')).resolves.toBe('ok')
    const slow = new Promise(() => {}) // never settles
    await expect(withTimeout(slow, 0.01, 'planner')).rejects.toThrow(AgentTimeoutError)
    await expect(withTimeout(slow, 0.01, 'planner')).rejects.toThrow(
      "Agent 'planner' timed out after 0.01s",
    )
  })
})
