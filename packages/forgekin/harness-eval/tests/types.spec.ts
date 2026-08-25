/**
 * @flowforge/forgekin-harness-eval — 核心模型验证（types）。
 *
 * 对齐 F040 §3.1 数据模型 + clowder C32 16 域注册：
 *   - 五态枚举 / Score 加权分
 *   - EVAL_DOMAINS_16 内置 16 域完整性（domainId 格式 / frequency / enabled）
 *   - 域 ID 校验
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import {
  EVAL_DOMAINS_16,
  HarnessLifecycleState,
  isEvalDomainId,
  weightedScoreValue,
} from '../src/types.js';

describe('HarnessLifecycleState 五态（F040 §3.1）', () => {
  it('五态枚举值符合契约', () => {
    expect(HarnessLifecycleState.APPRECIATING).toBe('appreciating');
    expect(HarnessLifecycleState.DEPRECIATING).toBe('depreciating');
    expect(HarnessLifecycleState.ACTION_NEEDED).toBe('action_needed');
    expect(HarnessLifecycleState.BOTTLENECK).toBe('bottleneck');
    expect(HarnessLifecycleState.STABLE).toBe('stable');
    expect(Object.keys(HarnessLifecycleState).length).toBe(5);
  });
});

describe('Score 加权分', () => {
  it('weighted_value = value × weight', () => {
    const score = { dimension: 'correctness', value: 0.8, weight: 0.5, rationale: '', suggestions: [], confidence: 1 };
    expect(weightedScoreValue(score)).toBeCloseTo(0.4);
  });
});

describe('EVAL_DOMAINS_16 内置 16 域（对照 clowder C32）', () => {
  it('恰好 16 个域', () => {
    expect(EVAL_DOMAINS_16).toHaveLength(16);
  });

  it('全部 domainId 符合 eval:<slug> 格式且唯一', () => {
    const ids = EVAL_DOMAINS_16.map((d) => d.domainId);
    expect(new Set(ids).size).toBe(16);
    for (const id of ids) {
      expect(isEvalDomainId(id)).toBe(true);
    }
  });

  it('关键域存在：a2a/memory/friction/sop/task-outcome/publish-verdict', () => {
    const ids = EVAL_DOMAINS_16.map((d) => d.domainId);
    for (const expected of ['eval:a2a', 'eval:memory', 'eval:friction', 'eval:sop', 'eval:task-outcome', 'eval:publish-verdict']) {
      expect(ids).toContain(expected);
    }
  });

  it('全部域启用且带 sourceAdapter/sourceRefsKind/frequency', () => {
    for (const d of EVAL_DOMAINS_16) {
      expect(d.enabled).toBe(true);
      expect(d.sourceAdapter.length).toBeGreaterThan(0);
      expect(d.sourceRefsKind.length).toBeGreaterThan(0);
      expect(['daily', 'weekly']).toContain(d.frequency);
    }
  });
});

describe('isEvalDomainId 校验', () => {
  it('合法：eval:memory / eval:a2a / eval:capability-tips', () => {
    expect(isEvalDomainId('eval:memory')).toBe(true);
    expect(isEvalDomainId('eval:a2a')).toBe(true);
    expect(isEvalDomainId('eval:capability-tips')).toBe(true);
  });

  it('非法：缺前缀 / 大写 / 空', () => {
    expect(isEvalDomainId('memory')).toBe(false);
    expect(isEvalDomainId('eval:Memory')).toBe(false);
    expect(isEvalDomainId('')).toBe(false);
  });
});
