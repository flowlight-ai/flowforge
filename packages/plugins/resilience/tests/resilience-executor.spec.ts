/**
 * Contract suite: ResilienceExecutor — P3-005 disaster degradation with
 * provider chain, exponential backoff, permanent-error fast switch, silent
 * failure detection, quality gate, quota check and on-all-fail policies.
 */

import { describe, expect, it } from 'vitest'
import {
  AllProvidersFailedError,
  ResilienceExecutor,
} from '../src/resilience-executor.ts'

const noopSleep = async () => {}

function makeExecutor(
  backups: string[],
  extra: Record<string, unknown> = {},
): ResilienceExecutor {
  return new ResilienceExecutor('primary', backups, {
    baseRetryDelay: 0,
    sleep: noopSleep,
    ...extra,
  })
}

describe('constructor validation', () => {
  it('rejects empty primary / invalid retry params', () => {
    expect(() => new ResilienceExecutor('', [])).toThrow('primary_provider must not be empty')
    expect(() => new ResilienceExecutor('p', [], { maxRetries: 0 })).toThrow('max_retries must be >= 1')
    expect(() => new ResilienceExecutor('p', [], { baseRetryDelay: -1 })).toThrow('base_retry_delay must be >= 0')
  })
})

describe('provider chain', () => {
  it('succeeds on the primary provider without fallback', async () => {
    const executor = makeExecutor(['backup-a'])
    const result = await executor.executeWithResilience(provider => `value from ${provider}`)
    expect(result.success).toBe(true)
    expect(result.value).toBe('value from primary')
    expect(result.providerUsed).toBe('primary')
    expect(result.fallbackUsed).toBe(false)
    expect(result.attempts).toHaveLength(1)
  })

  it('switches to backup after primary failure', async () => {
    const executor = makeExecutor(['backup-a', 'backup-b'])
    const result = await executor.executeWithResilience(provider => {
      if (provider === 'primary') throw new Error('boom')
      return `ok ${provider}`
    })
    expect(result.success).toBe(true)
    expect(result.providerUsed).toBe('backup-a')
    expect(result.fallbackUsed).toBe(true)
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0]).toMatchObject({ provider: 'primary', success: false })
  })

  it('retries temporary errors up to maxRetries with exponential backoff', async () => {
    const delays: number[] = []
    const executor = new ResilienceExecutor('primary', [], {
      maxRetries: 3,
      baseRetryDelay: 1,
      sleep: async seconds => {
        delays.push(seconds)
      },
    })
    await expect(
      executor.executeWithResilience(() => {
        throw new Error('timeout after 30s')
      }),
    ).rejects.toThrow(AllProvidersFailedError)
    expect(delays).toEqual([1, 2]) // 1 * 2^0, 1 * 2^1
  })

  it('never retries permanent errors', async () => {
    const executor = makeExecutor([], { maxRetries: 3 })
    let calls = 0
    await expect(
      executor.executeWithResilience(() => {
        calls += 1
        throw new Error('model_not_found: gpt-x')
      }),
    ).rejects.toThrow(AllProvidersFailedError)
    expect(calls).toBe(1)
  })
})

describe('silent failure detection', () => {
  it('detects silent failure in string results and switches provider', async () => {
    const executor = makeExecutor(['backup-a'])
    const result = await executor.executeWithResilience(provider =>
      provider === 'primary' ? '当前不可用，请稍后重试' : 'real answer',
    )
    expect(result.success).toBe(true)
    expect(result.providerUsed).toBe('backup-a')
    expect(result.attempts[0]).toMatchObject({ silent_failure: true, attempts_count: 1 })
  })

  it('detects silent failure inside dict results', async () => {
    const executor = makeExecutor(['backup-a'])
    const result = await executor.executeWithResilience(provider =>
      provider === 'primary' ? { content: '服务暂时不可用' } : { content: 'ok' },
    )
    expect(result.providerUsed).toBe('backup-a')
    expect(result.value).toEqual({ content: 'ok' })
  })

  it('detects silent failure raised as an error', async () => {
    const executor = makeExecutor(['backup-a'])
    const result = await executor.executeWithResilience(provider => {
      if (provider === 'primary') throw new Error('当前不可用,请稍后重试')
      return 'ok'
    })
    expect(result.attempts[0]).toMatchObject({ silent_failure: true })
    expect(result.providerUsed).toBe('backup-a')
  })
})

describe('quality gate + quota', () => {
  it('quality gate failure switches provider without retrying', async () => {
    const executor = makeExecutor(['backup-a'])
    let calls = 0
    const result = await executor.executeWithResilience(
      provider => {
        calls += 1
        return provider === 'primary' ? 'short' : 'long enough answer'
      },
      { qualityCheckFn: value => typeof value === 'string' && value.length > 10 },
    )
    expect(result.providerUsed).toBe('backup-a')
    expect(result.attempts[0]).toMatchObject({ error_type: 'quality_check_failed', attempts_count: 1 })
    expect(calls).toBe(2)
  })

  it('quota-exceeded providers are skipped', async () => {
    const executor = makeExecutor(['backup-a'], {
      quotaManager: { checkQuota: (provider: string) => provider !== 'primary' },
    })
    const result = await executor.executeWithResilience(() => 'never called on primary')
    expect(result.providerUsed).toBe('backup-a')
    expect(result.attempts[0]).toMatchObject({ provider: 'primary', error_type: 'quota_exceeded', attempts_count: 0 })
  })
})

describe('on-all-fail policies', () => {
  const alwaysFail = () => {
    throw new Error('boom')
  }

  it('raise: throws AllProvidersFailedError carrying attempts', async () => {
    const executor = makeExecutor(['backup-a'])
    try {
      await executor.executeWithResilience(alwaysFail)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AllProvidersFailedError)
      expect((error as AllProvidersFailedError).attempts).toHaveLength(2)
      expect((error as AllProvidersFailedError).message).toContain('primary=primary')
    }
  })

  it('return_default: returns the default value as degradation', async () => {
    const executor = makeExecutor([])
    const result = await executor.executeWithResilience(alwaysFail, {
      onAllFail: 'return_default',
      defaultValue: 'fallback-value',
    })
    expect(result.success).toBe(false)
    expect(result.value).toBe('fallback-value')
    expect(result.degradationAction).toBe('return_default')
    expect(result.fallbackUsed).toBe(true)
  })

  it('degrade_to_human: routes through the degradation tree', async () => {
    const executor = makeExecutor([])
    const result = await executor.executeWithResilience(alwaysFail, {
      onAllFail: 'degrade_to_human',
    })
    expect(result.success).toBe(false)
    expect(result.degradationAction).toBe('degrade_to_human')
  })
})

describe('classification + status', () => {
  it('classifyError: silent / permanent / temporary', () => {
    const executor = makeExecutor([])
    expect(executor.classifyError('当前不可用，请稍后重试')).toBe('silent_failure')
    expect(executor.classifyError('model_not_found')).toBe('permanent')
    expect(executor.classifyError('无权访问该模型')).toBe('permanent')
    expect(executor.classifyError('timeout 503')).toBe('temporary')
    expect(executor.classifyError('something unknown')).toBe('temporary')
  })

  it('getResilienceStatus reports totals and per-provider stats', async () => {
    const executor = makeExecutor(['backup-a'])
    await executor.executeWithResilience(provider => {
      if (provider === 'primary') throw new Error('boom')
      return 'ok'
    })
    const status = executor.getResilienceStatus()
    expect(status.total_executions).toBe(1)
    expect(status.total_successes).toBe(1)
    expect(status.success_rate).toBe(1)
    expect(status.degradation_count).toBe(0)
    expect(status.per_provider_stats).toEqual({
      primary: { success: 0, failure: 1 },
      'backup-a': { success: 1, failure: 0 },
    })
  })

  it('metrics collector receives degradation records', async () => {
    const records: Array<{ provider: string; success: boolean; reason: string }> = []
    const executor = makeExecutor(['backup-a'], {
      metricsCollector: {
        recordDegradation: (input: { provider: string; success: boolean; reason: string }) =>
          records.push(input),
      },
    })
    await executor.executeWithResilience(provider => {
      if (provider === 'primary') throw new Error('boom')
      return 'ok'
    })
    expect(records[0]?.provider).toBe('primary')
    expect(records[0]?.success).toBe(false)
    expect(records[1]?.provider).toBe('backup-a')
    expect(records[1]?.success).toBe(true)
    expect(records[1]?.reason).toBe('')
  })
})
