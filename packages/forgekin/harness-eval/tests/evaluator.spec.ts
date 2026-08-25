/**
 * @flowforge/forgekin-harness-eval — 维度评估器验证（evaluator）。
 *
 * 对齐 Python `evaluators/base.py` EvaluatorAgent + `registry.py` ScoringRule：
 *   - ScoringRuleEvaluator 字段存在性/阈值评分
 *   - MultiDimensionEvaluator 维度路由
 *   - overallScore 加权总分
 *
 * @module @flowforge/forgekin-harness-eval/tests
 */

import { describe, expect, it } from 'vitest';
import {
  clamp01,
  MultiDimensionEvaluator,
  overallScore,
  ScoringRuleEvaluator,
  type ScoringRule,
} from '../src/evaluator.js';

const rules: readonly ScoringRule[] = [
  { field: 'report', weight: 2 },
  { field: 'tests', weight: 1, threshold: 5 },
];

describe('ScoringRuleEvaluator', () => {
  it('字段全 present → 加权平均', () => {
    const evaluator = new ScoringRuleEvaluator();
    const score = evaluator.evaluateDimension({ report: 'x', tests: 8 }, { dimension: 'completeness', scoring_rules: rules });
    expect(score.dimension).toBe('completeness');
    expect(score.value).toBeCloseTo(1);
    expect(score.suggestions).toHaveLength(0);
  });

  it('字段缺失 → absent_score + 建议', () => {
    const evaluator = new ScoringRuleEvaluator();
    const score = evaluator.evaluateDimension({ report: 'x' }, { dimension: 'completeness', scoring_rules: rules });
    // (1*2 + 0*1) / 3
    expect(score.value).toBeCloseTo(2 / 3);
    expect(score.suggestions).toContain('missing field: tests');
  });

  it('数值字段未达阈值 → absent', () => {
    const evaluator = new ScoringRuleEvaluator();
    const score = evaluator.evaluateDimension({ report: 'x', tests: 3 }, { dimension: 'completeness', scoring_rules: rules });
    expect(score.value).toBeCloseTo(2 / 3);
  });

  it('无规则 → default_score + default_confidence', () => {
    const evaluator = new ScoringRuleEvaluator();
    const score = evaluator.evaluateDimension({}, { dimension: 'safety', default_score: 0.3, default_confidence: 0.2 });
    expect(score.value).toBeCloseTo(0.3);
    expect(score.confidence).toBeCloseTo(0.2);
  });

  it('分数夹取 [0,1]', () => {
    const evaluator = new ScoringRuleEvaluator();
    const score = evaluator.evaluateDimension({ a: 1 }, { dimension: 'd', scoring_rules: [{ field: 'a', weight: 1, present_score: 5 }] });
    expect(score.value).toBe(1);
  });
});

describe('MultiDimensionEvaluator', () => {
  it('按维度路由到注册评估器', () => {
    const multi = new MultiDimensionEvaluator();
    multi.register('correctness', new ScoringRuleEvaluator('rule_c', ''));
    const score = multi.evaluateDimension({ x: 1 }, { dimension: 'correctness', scoring_rules: [{ field: 'x' }] });
    expect(score.dimension).toBe('correctness');
  });

  it('未注册维度 → 默认分', () => {
    const multi = new MultiDimensionEvaluator();
    const score = multi.evaluateDimension({}, { dimension: 'unknown_dim', default_score: 0.1 });
    expect(score.value).toBeCloseTo(0.1);
  });
});

describe('overallScore 加权总分', () => {
  it('权重均值', () => {
    const scores = [
      { dimension: 'a', value: 0.8, weight: 1, rationale: '', suggestions: [], confidence: 1 },
      { dimension: 'b', value: 0.4, weight: 1, rationale: '', suggestions: [], confidence: 1 },
    ];
    expect(overallScore(scores)).toBeCloseTo(0.6);
  });

  it('空列表 → 0', () => {
    expect(overallScore([])).toBe(0);
  });
});

describe('clamp01', () => {
  it('夹取', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });
});
