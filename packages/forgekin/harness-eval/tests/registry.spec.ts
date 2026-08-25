/**
 * @flowforge/forgekin-harness-eval — 注册中心验证（registry）。
 *
 * 对齐 Python `evaluators/registry.py` + clowder `eval-domain-registry.ts`：
 *   - EvaluatorRegistry 注册/查询/物化
 *   - EvalDomainRegistry 16 域内置 + 自定义注册 + 退役/重启用
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVAL_DOMAIN_REGISTRY,
  EvalDomainRegistry,
  EvaluatorRegistry,
} from '../src/registry.js';
import { ScoringRuleEvaluator } from '../src/evaluator.js';

describe('EvaluatorRegistry', () => {
  it('注册配置字典并查询', () => {
    const registry = new EvaluatorRegistry();
    registry.register('completeness', {
      name: 'completeness',
      description: 'completeness check',
      dimension: 'completeness',
      scoring_rules: [{ field: 'report' }],
    });
    expect(registry.getConfig('completeness')?.dimension).toBe('completeness');
    expect(registry.listEvaluators()).toContain('completeness');
  });

  it('注册实例并物化', () => {
    const registry = new EvaluatorRegistry();
    const instance = new ScoringRuleEvaluator('inst', '');
    registry.register('inst', instance);
    expect(registry.get('inst')).toBe(instance);
    expect(registry.materialize('inst')).toBe(instance);
  });

  it('配置物化为可执行评估器', () => {
    const registry = new EvaluatorRegistry();
    registry.register('safety', {
      name: 'safety',
      dimension: 'safety',
      scoring_rules: [{ field: 'guardrail' }],
    });
    const evaluator = registry.materialize('safety');
    expect(evaluator).toBeInstanceOf(ScoringRuleEvaluator);
    const score = evaluator?.evaluateDimension({ guardrail: 'x' }, { dimension: 'safety', scoring_rules: [{ field: 'guardrail' }] });
    expect(score?.value).toBe(1);
  });

  it('同名注册覆盖', () => {
    const registry = new EvaluatorRegistry();
    registry.register('a', { name: 'a', dimension: 'd1' });
    registry.register('a', { name: 'a', dimension: 'd2' });
    expect(registry.getConfig('a')?.dimension).toBe('d2');
    expect(registry.size).toBe(1);
  });
});

describe('EvalDomainRegistry（16 域）', () => {
  it('内置 16 域全部注册', () => {
    expect(DEFAULT_EVAL_DOMAIN_REGISTRY.list()).toHaveLength(16);
    expect(DEFAULT_EVAL_DOMAIN_REGISTRY.listEnabled()).toHaveLength(16);
  });

  it('按频率过滤：daily + weekly = 16', () => {
    const daily = DEFAULT_EVAL_DOMAIN_REGISTRY.listByFrequency('daily');
    const weekly = DEFAULT_EVAL_DOMAIN_REGISTRY.listByFrequency('weekly');
    expect(daily.length + weekly.length).toBe(16);
    expect(daily.some((d) => d.domainId === 'eval:memory')).toBe(true);
    expect(weekly.some((d) => d.domainId === 'eval:sop')).toBe(true);
  });

  it('查询 + 非法 domainId 拒绝注册', () => {
    const registry = new EvalDomainRegistry([]);
    expect(registry.get('eval:none')).toBeUndefined();
    expect(() =>
      registry.register({
        domainId: 'bad-id',
        displayName: 'x',
        frequency: 'daily',
        sourceAdapter: 's',
        sourceRefsKind: 'k',
        enabled: true,
      }),
    ).toThrow(/invalid domainId/);
  });

  it('退役/重启用（clowder enabled 静默退役语义）', () => {
    const registry = new EvalDomainRegistry([]);
    registry.register({
      domainId: 'eval:custom',
      displayName: 'custom',
      frequency: 'daily',
      sourceAdapter: 's',
      sourceRefsKind: 'k',
      enabled: true,
    });
    expect(registry.listEnabled()).toHaveLength(1);
    expect(registry.retire('eval:custom')).toBe(true);
    expect(registry.listEnabled()).toHaveLength(0);
    // 退役保留注册条目
    expect(registry.get('eval:custom')?.enabled).toBe(false);
    expect(registry.reenable('eval:custom')).toBe(true);
    expect(registry.listEnabled()).toHaveLength(1);
  });

  it('自定义域追加到内置 16 域', () => {
    const registry = new EvalDomainRegistry([
      ...DEFAULT_EVAL_DOMAIN_REGISTRY.list(),
      {
        domainId: 'eval:custom-x',
        displayName: 'x',
        frequency: 'weekly',
        sourceAdapter: 's',
        sourceRefsKind: 'k',
        enabled: true,
      },
    ]);
    expect(registry.list()).toHaveLength(17);
  });
});
