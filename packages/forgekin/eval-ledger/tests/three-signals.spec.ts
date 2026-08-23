/**
 * three-signals — 三方信号交叉验证契约验证（对齐 Python）。
 *
 * 覆盖：extractVerdict 三级提取（verdict / score / confidence，warn→fail）/
 * cross_validate 四方场景（三方一致 / 两方一致 / 分歧 / 平票 / 空 / fail 多数）。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { describe, expect, it } from 'vitest';
import {
  Signal,
  SignalType,
  ThreeSignalCrossValidator,
  extractVerdict,
} from '../src/three-signals.js';

function makeSignal(type: SignalType, content: unknown, confidence = 0.5): Signal {
  return new Signal({ signal_type: type, source: `src-${type}`, content, confidence });
}

describe('Signal', () => {
  it('默认 id 前缀 sig-；置信度越界抛错', () => {
    const sig = new Signal({ signal_type: SignalType.TRACE, source: 'x' });
    expect(sig.signal_id.startsWith('sig-')).toBe(true);
    expect(sig.confidence).toBe(0.5);
    expect(() => new Signal({ signal_type: SignalType.TRACE, source: 'x', confidence: 1.5 })).toThrow('0.0-1.0');
  });
});

describe('extractVerdict', () => {
  it('content.verdict 直接使用；warn 归入 fail', () => {
    expect(extractVerdict(makeSignal(SignalType.TRACE, { verdict: 'pass' }))).toBe('pass');
    expect(extractVerdict(makeSignal(SignalType.TRACE, { verdict: 'fail' }))).toBe('fail');
    expect(extractVerdict(makeSignal(SignalType.TRACE, { verdict: 'warn' }))).toBe('fail');
  });

  it('content.score ≥ 0.85 → pass', () => {
    expect(extractVerdict(makeSignal(SignalType.AUTO, { score: 0.9 }))).toBe('pass');
    expect(extractVerdict(makeSignal(SignalType.AUTO, { score: 0.84 }))).toBe('fail');
  });

  it('回退到 confidence（≥0.5 → pass）', () => {
    expect(extractVerdict(makeSignal(SignalType.HUMAN, null, 0.7))).toBe('pass');
    expect(extractVerdict(makeSignal(SignalType.HUMAN, null, 0.3))).toBe('fail');
    // verdict 非法值 → 走 score/回退
    expect(extractVerdict(makeSignal(SignalType.HUMAN, { verdict: 'unknown' }, 0.9))).toBe('pass');
  });
});

describe('crossValidate', () => {
  const validator = new ThreeSignalCrossValidator();

  it('空信号 → 无共识升级 operator', async () => {
    const result = await validator.crossValidate([]);
    expect(result.consensus).toBe(false);
    expect(result.recommendation).toBe('escalate_operator');
    expect(result.disagreements).toEqual(['无信号输入']);
    expect(result.confidence).toBe(0);
    expect(result.signal_count).toBe(0);
  });

  it('三方一致 pass → proceed', async () => {
    const signals = [
      makeSignal(SignalType.TRACE, { verdict: 'pass' }, 0.9),
      makeSignal(SignalType.HUMAN, { verdict: 'pass' }, 0.8),
      makeSignal(SignalType.AUTO, { verdict: 'pass' }, 0.7),
    ];
    const result = await validator.crossValidate(signals);
    expect(result.consensus).toBe(true);
    expect(result.consensus_value).toBe('pass');
    expect(result.recommendation).toBe('proceed');
    expect(result.disagreements).toEqual([]);
    expect(result.signal_count).toBe(3);
    // 平均置信度 0.8 × 1.0
    expect(result.confidence).toBeCloseTo(0.8, 4);
  });

  it('两方一致（1 分歧）→ proceed_with_caution + 分歧记录', async () => {
    const signals = [
      makeSignal(SignalType.TRACE, { verdict: 'pass' }, 0.9),
      makeSignal(SignalType.HUMAN, { verdict: 'pass' }, 0.9),
      makeSignal(SignalType.AUTO, { verdict: 'fail' }, 0.9),
    ];
    const result = await validator.crossValidate(signals);
    expect(result.consensus).toBe(true);
    expect(result.recommendation).toBe('proceed_with_caution');
    expect(result.disagreements).toHaveLength(1);
    expect(result.disagreements[0]).toContain('与多数');
    // 平均 0.9 × 2/3
    expect(result.confidence).toBeCloseTo(0.6, 4);
  });

  it('fail 多数 → 共识但升级 operator', async () => {
    const signals = [
      makeSignal(SignalType.TRACE, { verdict: 'fail' }),
      makeSignal(SignalType.HUMAN, { verdict: 'fail' }),
      makeSignal(SignalType.AUTO, { verdict: 'pass' }),
    ];
    const result = await validator.crossValidate(signals);
    expect(result.consensus).toBe(true);
    expect(result.consensus_value).toBe('fail');
    expect(result.recommendation).toBe('escalate_operator');
  });

  it('平票（1 pass 1 fail）→ 无共识升级', async () => {
    const signals = [
      makeSignal(SignalType.TRACE, { verdict: 'pass' }),
      makeSignal(SignalType.HUMAN, { verdict: 'fail' }),
    ];
    const result = await validator.crossValidate(signals);
    expect(result.consensus).toBe(false);
    expect(result.consensus_value).toBeNull();
    expect(result.recommendation).toBe('escalate_operator');
    expect(result.confidence).toBe(0);
  });
});

describe('信号采集门面', () => {
  const validator = new ThreeSignalCrossValidator();

  it('三类采集器缺省 source + confidence/component_ref 透传', async () => {
    const trace = await validator.collectTraceSignal({});
    expect(trace.signal_type).toBe(SignalType.TRACE);
    expect(trace.source).toBe('trace_collector');
    const human = await validator.collectHumanSignal({ source: 'friction_monitor', confidence: 0.9, component_ref: 'a.b' });
    expect(human.signal_type).toBe(SignalType.HUMAN);
    expect(human.source).toBe('friction_monitor');
    expect(human.confidence).toBe(0.9);
    expect(human.component_ref).toBe('a.b');
    const auto = await validator.collectAutoSignal({});
    expect(auto.signal_type).toBe(SignalType.AUTO);
    expect(auto.source).toBe('benchmark_probe');
  });
});
