/**
 * evaluator — 维度评估器（对齐 Python `evaluators/base.py` EvaluatorAgent +
 * `evaluators/registry.py` ScoringRule + `core/gate/models.py` Score）。
 *
 * 所有评估器实现 evaluate_dimension(submission, dimensionConfig) → Score，
 * 由 ScoringRuleEvaluator 提供纯规则启发式实现（字段存在性/阈值），
 * 无 LLM 依赖——评估决策可测试、可复现。
 *
 * @module @flowforge/forgekin-harness-eval
 */

import type { Score } from './types.js';

/** 评分规则（对齐 registry.py ScoringRule）。 */
export interface ScoringRule {
  /** submission 中的字段名 */
  readonly field: string;
  /** 权重（默认 1.0） */
  readonly weight?: number | undefined;
  /** 字段存在时的分数（默认 1.0） */
  readonly present_score?: number | undefined;
  /** 字段不存在时的分数（默认 0.0） */
  readonly absent_score?: number | undefined;
  /** 可选阈值：数值字段 >= 阈值才算 present */
  readonly threshold?: number | undefined;
}

/** 维度评估器接口（对齐 EvaluatorAgent.evaluate_dimension）。 */
export interface DimensionEvaluator {
  /** 评估器名称 */
  readonly name: string;
  /** 评估器描述 */
  readonly description: string;
  /** 对提交物按维度配置评分。 */
  evaluateDimension(submission: Readonly<Record<string, unknown>>, dimensionConfig: Readonly<Record<string, unknown>>): Score;
}

/** 纯规则启发式评估器——按 ScoringRule 列表对 submission 字段评分。 */
export class ScoringRuleEvaluator implements DimensionEvaluator {
  readonly name: string;
  readonly description: string;

  constructor(name = 'scoring_rule', description = 'Rule-based dimension scoring evaluator') {
    this.name = name;
    this.description = description;
  }

  /** 按规则评分：present 字段加权平均，absent 得 absent_score。 */
  evaluateDimension(
    submission: Readonly<Record<string, unknown>>,
    dimensionConfig: Readonly<Record<string, unknown>>,
  ): Score {
    const dimension = String(dimensionConfig['dimension'] ?? 'unknown');
    const rules = (dimensionConfig['scoring_rules'] as readonly ScoringRule[] | undefined) ?? [];
    const weight = clamp01(Number(dimensionConfig['weight'] ?? 1));
    const defaultScore = clamp01(Number(dimensionConfig['default_score'] ?? 0));
    const defaultConfidence = clamp01(Number(dimensionConfig['default_confidence'] ?? 0));

    if (rules.length === 0) {
      return {
        dimension,
        value: defaultScore,
        weight,
        rationale: 'no scoring rules — using default score',
        suggestions: [],
        confidence: defaultConfidence,
      };
    }

    let weightedSum = 0;
    let ruleWeightSum = 0;
    const suggestions: string[] = [];
    for (const rule of rules) {
      const rw = rule.weight ?? 1;
      const raw = submission[rule.field];
      const present =
        raw !== undefined &&
        raw !== null &&
        raw !== '' &&
        (rule.threshold === undefined || typeof raw === 'number' && raw >= rule.threshold);
      const value = present ? (rule.present_score ?? 1) : (rule.absent_score ?? 0);
      weightedSum += value * rw;
      ruleWeightSum += rw;
      if (!present) {
        suggestions.push(`missing field: ${rule.field}`);
      }
    }

    const value = ruleWeightSum > 0 ? clamp01(weightedSum / ruleWeightSum) : defaultScore;
    const presentCount = rules.filter((r) => submission[r.field] !== undefined && submission[r.field] !== null && submission[r.field] !== '').length;
    const confidence = clamp01(ruleWeightSum > 0 ? presentCount / rules.length : defaultConfidence);
    return {
      dimension,
      value,
      weight,
      rationale: `scored ${rules.length} rule(s); ${presentCount} present`,
      suggestions,
      confidence,
    };
  }
}

/** 多维度评估器——一组规则评估器按维度配置路由。 */
export class MultiDimensionEvaluator implements DimensionEvaluator {
  readonly name: string;
  readonly description: string;
  private readonly evaluators = new Map<string, DimensionEvaluator>();

  constructor(name = 'multi_dimension', description = 'Route to per-dimension evaluators') {
    this.name = name;
    this.description = description;
  }

  /** 注册维度评估器。 */
  register(dimension: string, evaluator: DimensionEvaluator): this {
    this.evaluators.set(dimension, evaluator);
    return this;
  }

  evaluateDimension(
    submission: Readonly<Record<string, unknown>>,
    dimensionConfig: Readonly<Record<string, unknown>>,
  ): Score {
    const dimension = String(dimensionConfig['dimension'] ?? 'unknown');
    const evaluator = this.evaluators.get(dimension) ?? this.evaluators.get('*');
    if (!evaluator) {
      return {
        dimension,
        value: clamp01(Number(dimensionConfig['default_score'] ?? 0)),
        weight: clamp01(Number(dimensionConfig['weight'] ?? 1)),
        rationale: `no evaluator registered for dimension ${dimension}`,
        suggestions: [],
        confidence: 0,
      };
    }
    return evaluator.evaluateDimension(submission, dimensionConfig);
  }
}

/** 夹取到 [0,1]。 */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 多维度评分 → 加权总分（对齐 GateVerdict.overall_score 语义）。 */
export function overallScore(scores: readonly Score[]): number {
  if (scores.length === 0) return 0;
  const weightSum = scores.reduce((s, x) => s + x.weight, 0);
  if (weightSum <= 0) return 0;
  return clamp01(scores.reduce((s, x) => s + x.value * x.weight, 0) / weightSum);
}
