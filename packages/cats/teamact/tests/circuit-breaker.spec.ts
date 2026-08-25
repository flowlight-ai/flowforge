/**
 * @flowforge/cats-teamact — T7.17 PingPongCircuitBreaker 契约验证。
 *
 * 对齐 `core/teamact/circuit_breaker.py`（roleagent.md §2.4）：
 *   - N > threshold（默认 3）→ 建议换路（should_break）
 *   - N > max_rounds（默认 5）→ 硬熔断
 *   - reset 清零；get_failure_data 给数据不给结论
 *
 * @module @flowforge/cats-teamact/tests
 */

import { describe, expect, it } from 'vitest';
import { PingPongCircuitBreaker } from '../src/circuit-breaker.js';

describe('PingPongCircuitBreaker 熔断逻辑', () => {
  it('默认阈值 3：N<=3 不熔断，N=4 熔断', () => {
    const breaker = new PingPongCircuitBreaker();
    for (let i = 1; i <= 3; i += 1) {
      breaker.recordFailure('dev-a', `round ${i}`);
      expect(breaker.shouldBreak('dev-a')).toBe(false);
    }
    breaker.recordFailure('dev-a', 'round 4');
    expect(breaker.shouldBreak('dev-a')).toBe(true);
  });

  it('max_rounds 硬上限：N>max_rounds 强制熔断', () => {
    const breaker = new PingPongCircuitBreaker({ maxRounds: 5, threshold: 10 });
    for (let i = 1; i <= 5; i += 1) {
      breaker.recordFailure('dev-b', `round ${i}`);
      expect(breaker.shouldBreak('dev-b')).toBe(false);
    }
    breaker.recordFailure('dev-b', 'round 6');
    expect(breaker.shouldBreak('dev-b')).toBe(true);
  });

  it('不同 agent 计数相互独立', () => {
    const breaker = new PingPongCircuitBreaker();
    breaker.recordFailure('dev-a', 'x');
    breaker.recordFailure('dev-a', 'x');
    breaker.recordFailure('dev-b', 'x');
    expect(breaker.shouldBreak('dev-a')).toBe(false);
    expect(breaker.shouldBreak('dev-b')).toBe(false);
    breaker.recordFailure('dev-a', 'x');
    breaker.recordFailure('dev-a', 'x');
    expect(breaker.shouldBreak('dev-a')).toBe(true);
    expect(breaker.shouldBreak('dev-b')).toBe(false);
  });
});

describe('PingPongCircuitBreaker 重置与数据', () => {
  it('reset 清零计数与失败原因', () => {
    const breaker = new PingPongCircuitBreaker();
    breaker.recordFailure('dev-c', 'stuck');
    breaker.reset('dev-c');
    expect(breaker.shouldBreak('dev-c')).toBe(false);
    const data = breaker.getFailureData('dev-c');
    expect(data.roundsCount).toBe(0);
    expect(data.lastFailureReason).toBeNull();
  });

  it('getFailureData 给数据不给结论（含阈值/上限/最近失败）', () => {
    const breaker = new PingPongCircuitBreaker({ threshold: 2 });
    breaker.recordFailure('dev-d', 'no progress');
    const data = breaker.getFailureData('dev-d');
    expect(data.agentId).toBe('dev-d');
    expect(data.roundsCount).toBe(1);
    expect(data.threshold).toBe(2);
    expect(data.maxRounds).toBe(5);
    expect(data.shouldBreak).toBe(false);
    expect(data.lastFailureReason).toBe('no progress');
    expect(data.lastFailureTime).not.toBeNull();
  });

  it('未记录的 agent 返回零数据且不熔断', () => {
    const breaker = new PingPongCircuitBreaker();
    expect(breaker.shouldBreak('unknown')).toBe(false);
    expect(breaker.getFailureData('unknown').roundsCount).toBe(0);
  });
});
