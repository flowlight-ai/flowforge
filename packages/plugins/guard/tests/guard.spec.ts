/**
 * Contract suite: guardrail registry/executor semantics (parallel run,
 * error tolerance, early blocking), five-layer moderation chain with
 * injected providers + caching, contract errors, and the L5
 * publish-gate checker.
 */

import { describe, expect, it } from 'vitest'
import {
  ContentModerationChecker,
  ContentModerationLayer,
  GuardrailExecutor,
  GuardrailRegistry,
  GuardrailResult,
  InputGuardrail,
  ModerationBlockedError,
  ModerationError,
  ModerationTimeoutError,
  OutputGuardrail,
  type ModerationProvider,
} from '../src/index.ts'

class StaticInputGuardrail extends InputGuardrail {
  constructor(
    name: string,
    private readonly result: GuardrailResult | Error | unknown,
  ) {
    super()
    this.name = name
  }

  async check(): Promise<GuardrailResult> {
    if (this.result instanceof Error) throw this.result
    return this.result as GuardrailResult
  }
}

class StaticOutputGuardrail extends OutputGuardrail {
  constructor(
    name: string,
    private readonly result: GuardrailResult,
  ) {
    super()
    this.name = name
  }

  async check(): Promise<GuardrailResult> {
    return this.result
  }
}

describe('GuardrailRegistry', () => {
  it('registers input and output guardrails separately, skipping duplicates', () => {
    const registry = new GuardrailRegistry()
    const a = new StaticInputGuardrail('safety', new GuardrailResult())
    registry.register(a)
    registry.register(new StaticInputGuardrail('safety', new GuardrailResult())) // duplicate skipped
    registry.register(new StaticOutputGuardrail('quality', new GuardrailResult()))
    expect(registry.getInputGuardrails()).toEqual([a])
    expect(registry.getOutputGuardrails()).toHaveLength(1)
    registry.unregister('safety')
    expect(registry.getInputGuardrails()).toEqual([])
  })

  it('rejects non-guardrail values and unknown unregister', () => {
    const registry = new GuardrailRegistry()
    expect(() => registry.register({} as never)).toThrow(TypeError)
    expect(() => registry.unregister('ghost')).toThrow(/not registered/)
  })
})

describe('GuardrailExecutor', () => {
  it('runs everything in parallel and collects all results', async () => {
    const registry = new GuardrailRegistry()
    registry.register(new StaticInputGuardrail('a', new GuardrailResult()))
    registry.register(
      new StaticInputGuardrail('b', new GuardrailResult({ status: 'warned', message: 'short' })),
    )
    const executor = new GuardrailExecutor(registry)
    const results = await executor.runInputGuardrails('text', {})
    expect(results.map(result => result.status)).toEqual(['passed', 'warned'])
  })

  it('stops collecting after a blocked result', async () => {
    const registry = new GuardrailRegistry()
    registry.register(new StaticInputGuardrail('a', new GuardrailResult()))
    registry.register(
      new StaticInputGuardrail('b', new GuardrailResult({ status: 'blocked', message: 'nope' })),
    )
    registry.register(new StaticInputGuardrail('c', new GuardrailResult()))
    const executor = new GuardrailExecutor(registry)
    const results = await executor.runInputGuardrails('text', {})
    expect(results).toHaveLength(2)
    expect(results[1]?.status).toBe('blocked')
  })

  it('tolerates throwing guardrails and unexpected return types', async () => {
    const registry = new GuardrailRegistry()
    registry.register(new StaticInputGuardrail('boom', new Error('kaput')))
    registry.register(new StaticInputGuardrail('weird', 'not-a-result'))
    const executor = new GuardrailExecutor(registry)
    const results = await executor.runInputGuardrails('text', {})
    expect(results[0]?.status).toBe('warned')
    expect(results[0]?.message).toContain("Guardrail 'boom' error")
    expect(results[1]?.message).toContain('unexpected type')
  })

  it('returns [] when no guardrails are registered and carries modifiedData', async () => {
    const registry = new GuardrailRegistry()
    const executor = new GuardrailExecutor(registry)
    expect(await executor.runInputGuardrails('x', {})).toEqual([])
    registry.register(
      new StaticOutputGuardrail(
        'redact',
        new GuardrailResult({ status: 'modified', modifiedData: 'clean' }),
      ),
    )
    const results = await executor.runOutputGuardrails('dirty', {})
    expect(results[0]?.modifiedData).toBe('clean')
  })
})

function countingProvider(passed: boolean): ModerationProvider & { calls: number } {
  const provider = {
    calls: 0,
    async check() {
      provider.calls += 1
      return passed
        ? { passed, category: 'violence' }
        : { passed, reason: 'unsafe content', category: 'violence' }
    },
  }
  return provider
}

describe('ContentModerationLayer (five-layer chain)', () => {
  it('blocks at L1 on a keyword hit', async () => {
    const layer = new ContentModerationLayer({
      keywords: { fraud: ['scam'] },
      llm: countingProvider(true),
    })
    const result = await layer.moderate('this is a scam offer')
    expect(result.passed).toBe(false)
    expect(result.level).toBe('L1')
    expect(result.category).toBe('fraud')
    expect(result.action).toBe('block')
  })

  it('evaluates L2 regex rules (block short-circuits, warn accumulates)', async () => {
    const blocking = new ContentModerationLayer({
      regexes: [
        {
          name: 'no-links',
          level: 'L2',
          category: 'spam',
          pattern: /https?:\/\//,
          action: 'block',
          severity: 'medium',
          enabled: true,
        },
      ],
    })
    expect((await blocking.moderate('visit http://x')).level).toBe('L2')

    const warning = new ContentModerationLayer({
      regexes: [
        {
          name: 'shouting',
          level: 'L2',
          category: 'style',
          pattern: /[A-Z]{10}/,
          action: 'warn',
          severity: 'low',
          enabled: true,
        },
      ],
    })
    const warned = await warning.moderate('HELLOWORLD text')
    expect(warned.passed).toBe(true)
    expect(warned.action).toBe('warn')
  })

  it('blocks at L4/L5 when injected providers reject', async () => {
    const llmLayer = new ContentModerationLayer({ llm: countingProvider(false) })
    const llmResult = await llmLayer.moderate('anything')
    expect(llmResult.level).toBe('L4')
    expect(llmResult.category).toBe('violence')

    const platformLayer = new ContentModerationLayer({ platform: countingProvider(false) })
    expect((await platformLayer.moderate('anything')).level).toBe('L5')
  })

  it('wraps provider failures in ModerationError', async () => {
    const layer = new ContentModerationLayer({
      llm: {
        async check() {
          throw new Error('network down')
        },
      },
    })
    await expect(layer.moderate('x')).rejects.toThrow(ModerationError)
  })

  it('caches verdicts until TTL expiry (injected clock)', async () => {
    let clock = 1000
    const provider = countingProvider(true)
    const layer = new ContentModerationLayer({
      llm: provider,
      cacheTtlSeconds: 60,
      now: () => clock,
    })
    const first = await layer.moderate('same content')
    expect(first.passed).toBe(true)
    expect(first.action).toBe('allow')
    const second = await layer.moderate('same content')
    expect(second.cacheHit).toBe(true)
    expect(provider.calls).toBe(1)
    clock = 1000 + 61
    await layer.moderate('same content')
    expect(provider.calls).toBe(2)
  })
})

describe('contract errors', () => {
  it('ModerationBlockedError truncates content and keeps labels', () => {
    const long = 'x'.repeat(500)
    const error = new ModerationBlockedError(long, ['violence', 'adult'])
    expect(error.content).toHaveLength(200)
    expect(error.riskLabels).toEqual(['violence', 'adult'])
    expect(error.message).toContain('risk_labels')
  })

  it('ModerationTimeoutError carries the timeout budget', () => {
    const error = new ModerationTimeoutError('all retries timed out', 5)
    expect(error.timeoutSeconds).toBe(5)
  })
})

describe('ContentModerationChecker (L5 publish gate)', () => {
  it('detects PII via built-in regexes', async () => {
    const checker = new ContentModerationChecker()
    const phone = await checker.check('call me at 13812345678')
    expect(phone.safe).toBe(false)
    expect(phone.riskTags).toContain('privacy:phone_number')
    expect(phone.confidence).toBe(0.85)

    const clean = await checker.check('nothing sensitive here')
    expect(clean.safe).toBe(true)
    expect(clean.confidence).toBe(0.95)
  })

  it('checks host-injected sensitive words and compliance lists', async () => {
    const checker = new ContentModerationChecker({
      sensitiveCategories: { violence: ['murder'] },
      complianceWords: ['miracle cure'],
    })
    const result = await checker.check('a murder mystery promising a miracle cure')
    expect(result.riskTags).toEqual(
      expect.arrayContaining(['sensitive:violence', 'compliance:false_advertising']),
    )
    checker.addSensitiveWords('violence', ['arson'])
    expect((await checker.check('arson')).safe).toBe(false)
    expect(checker.getStatus()).toMatchObject({ level: 'L5', categories: ['violence'] })
  })

  it('honors the check_types filter', async () => {
    const checker = new ContentModerationChecker()
    const result = await checker.check('call 13812345678', ['sensitive_words'])
    expect(result.safe).toBe(true)
    expect(result.level).toBe('L5')
  })
})
