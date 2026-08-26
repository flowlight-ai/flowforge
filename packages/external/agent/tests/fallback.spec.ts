/**
 * fallback — F34 失败回退链测试（EX-007）。
 *
 * 语义对照 flowforge/core/external_agent/test_fallback.py：
 *   - DEFAULT_FALLBACK_CHAIN：5 厂商默认链
 *   - withFallback 双层循环（provider × retry）
 *   - result.success === true 判定成功；false / 异常均视为失败
 *   - 最后一次尝试不退避（backoffSeconds 极小以加速测试）
 *
 * @module @flowforge/external-agent/tests
 */

import { describe, expect, it } from 'vitest';
import {
  type InvokeFn,
  DEFAULT_FALLBACK_CHAIN,
  ExternalAgentFallback,
} from '../src/fallback.js';

/** 快速降级（退避 ~0ms）。 */
function makeFallback(retryMaxAttempts = 3) {
  return new ExternalAgentFallback(retryMaxAttempts, 0.001);
}

describe('DEFAULT_FALLBACK_CHAIN（fallback.py 默认链）', () => {
  it('包含 5 个厂商且顺序正确', () => {
    expect(DEFAULT_FALLBACK_CHAIN).toEqual([
      'anthropic.claude_code',
      'openai.codex',
      'opencode.opencode',
      'bytedance.trae',
      'flowforge.internal',
    ]);
  });

  it('getDefaultChain 返回副本', () => {
    const fallback = makeFallback();
    const chain = fallback.getDefaultChain();
    chain.push('x.y');
    expect(fallback.getDefaultChain()).toHaveLength(5);
  });
});

describe('ExternalAgentFallback.withFallback（fallback.py with_fallback）', () => {
  it('第一个 Provider 立即成功：仅 1 次尝试', async () => {
    const fallback = makeFallback();
    const calls: string[] = [];
    const invokeFn: InvokeFn = async (providerName) => {
      calls.push(providerName);
      return { success: true, result: 'ok' };
    };
    const result = await fallback.withFallback(
      fallback.getDefaultChain(),
      invokeFn,
      'task',
      {},
    );
    expect(result.success).toBe(true);
    expect(result.winning_provider).toBe('anthropic.claude_code');
    expect(calls).toEqual(['anthropic.claude_code']);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.success).toBe(true);
  });

  it('全部失败返回 success=false 且 attempts 记录错误', async () => {
    const fallback = makeFallback(2);
    const invokeFn: InvokeFn = async () => ({ success: false, error: 'boom' });
    const result = await fallback.withFallback(
      ['a.b', 'c.d'],
      invokeFn,
      'task',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.winning_provider).toBe('');
    expect(result.result).toBeNull();
    expect(result.attempts).toHaveLength(4); // 2 providers × 2 retries
    expect(result.attempts.every((a) => !a.success)).toBe(true);
    expect(result.attempts[0]!.error).toBe('boom');
  });

  it('第二个 Provider 成功：尝试次数 = retryMaxAttempts + 1', async () => {
    const fallback = makeFallback(2);
    const calls: string[] = [];
    const invokeFn: InvokeFn = async (providerName) => {
      calls.push(providerName);
      if (providerName === 'a.b') {
        return { success: false, error: 'fail' };
      }
      return { success: true, result: 'ok' };
    };
    const result = await fallback.withFallback(['a.b', 'c.d'], invokeFn, 'task', {});
    expect(result.success).toBe(true);
    expect(result.winning_provider).toBe('c.d');
    expect(calls).toEqual(['a.b', 'a.b', 'c.d']);
    expect(result.attempts).toHaveLength(3);
    // 失败尝试带错误信息
    expect(result.attempts[0]).toMatchObject({ provider_name: 'a.b', success: false });
  });

  it('同 Provider 重试：第一个失败第二个成功（同 provider 重试语义）', async () => {
    const fallback = makeFallback(3);
    let call = 0;
    const invokeFn: InvokeFn = async (providerName) => {
      call += 1;
      if (providerName === 'a.b' && call === 1) {
        return { success: false, error: 'transient' };
      }
      return { success: true, result: 'ok' };
    };
    const result = await fallback.withFallback(['a.b'], invokeFn, 'task', {});
    expect(result.success).toBe(true);
    expect(result.winning_provider).toBe('a.b');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1]!.attempt).toBe(2);
  });

  it('invokeFn 抛异常视为失败并继续链', async () => {
    const fallback = makeFallback(1);
    const invokeFn: InvokeFn = async (providerName) => {
      if (providerName === 'a.b') {
        throw new Error('crash');
      }
      return { success: true };
    };
    const result = await fallback.withFallback(['a.b', 'c.d'], invokeFn, 'task', {});
    expect(result.success).toBe(true);
    expect(result.winning_provider).toBe('c.d');
    expect(result.attempts[0]!.error).toBe('crash');
  });

  it('成功结果原样透传（result 含成功原始数据）', async () => {
    const fallback = makeFallback(1);
    const invokeFn: InvokeFn = async () => ({ success: true, output: 'hello' });
    const result = await fallback.withFallback(['a.b'], invokeFn, 'task', {});
    expect(result.result).toEqual({ success: true, output: 'hello' });
  });

  it('空 provider 列表返回 success=false 且无尝试', async () => {
    const fallback = makeFallback(1);
    const invokeFn: InvokeFn = async () => ({ success: true });
    const result = await fallback.withFallback([], invokeFn, 'task', {});
    expect(result.success).toBe(false);
    expect(result.attempts).toEqual([]);
  });

  it('total_duration_ms 为非负数值', async () => {
    const fallback = makeFallback(1);
    const invokeFn: InvokeFn = async () => ({ success: true });
    const result = await fallback.withFallback(['a.b'], invokeFn, 'task', {});
    expect(result.total_duration_ms).toBeGreaterThanOrEqual(0);
  });
});
