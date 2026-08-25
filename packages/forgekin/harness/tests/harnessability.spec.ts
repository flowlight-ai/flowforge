/**
 * harnessability — Layer7 适配现实测试（对齐 harness.yaml harnessability 配置）。
 *
 * @module @flowforge/forgekin-harness/tests
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HARNESSABILITY_WEIGHTS,
  HarnessabilityDimension,
  HarnessabilityScorer,
  type DimensionScore,
} from '../src/harnessability.js';

function scores(
  values: Partial<Record<HarnessabilityDimension, number>>,
): DimensionScore[] {
  return Object.entries(values).map(([dimension, score]) => ({
    dimension: dimension as HarnessabilityDimension,
    score: score ?? 0,
    rationale: 'test',
  }));
}

describe('HarnessabilityScorer 评估', () => {
  it('全维度满分 → overall=1.0 不告警', () => {
    const scorer = new HarnessabilityScorer();
    const report = scorer.assess(
      scores({
        [HarnessabilityDimension.DURABLE_STATE_COVERAGE]: 1,
        [HarnessabilityDimension.TOOL_MEDIATION_QUALITY]: 1,
        [HarnessabilityDimension.GOVERNANCE_COMPLETENESS]: 1,
        [HarnessabilityDimension.OBSERVABILITY]: 1,
        [HarnessabilityDimension.RECOVERY_CAPABILITY]: 1,
        [HarnessabilityDimension.EVIDENCE]: 1,
      }),
    );
    expect(report.overall).toBe(1);
    expect(report.below_threshold).toBe(false);
  });

  it('加权求和：0.9 全维度 → overall=0.9', () => {
    const scorer = new HarnessabilityScorer();
    const report = scorer.assess(
      scores({
        [HarnessabilityDimension.DURABLE_STATE_COVERAGE]: 0.9,
        [HarnessabilityDimension.TOOL_MEDIATION_QUALITY]: 0.9,
        [HarnessabilityDimension.GOVERNANCE_COMPLETENESS]: 0.9,
        [HarnessabilityDimension.OBSERVABILITY]: 0.9,
        [HarnessabilityDimension.RECOVERY_CAPABILITY]: 0.9,
        [HarnessabilityDimension.EVIDENCE]: 0.9,
      }),
    );
    expect(report.overall).toBe(0.9);
    expect(report.below_threshold).toBe(false);
  });

  it('低于阈值 0.85 → 告警', () => {
    const scorer = new HarnessabilityScorer();
    const report = scorer.assess(
      scores({
        [HarnessabilityDimension.DURABLE_STATE_COVERAGE]: 0.8,
        [HarnessabilityDimension.TOOL_MEDIATION_QUALITY]: 0.8,
        [HarnessabilityDimension.GOVERNANCE_COMPLETENESS]: 0.8,
        [HarnessabilityDimension.OBSERVABILITY]: 0.8,
        [HarnessabilityDimension.RECOVERY_CAPABILITY]: 0.8,
        [HarnessabilityDimension.EVIDENCE]: 0.8,
      }),
    );
    expect(report.overall).toBe(0.8);
    expect(report.below_threshold).toBe(true);
  });

  it('缺失维度按 0 计', () => {
    const scorer = new HarnessabilityScorer();
    const report = scorer.assess(
      scores({
        [HarnessabilityDimension.DURABLE_STATE_COVERAGE]: 1,
        [HarnessabilityDimension.TOOL_MEDIATION_QUALITY]: 1,
        [HarnessabilityDimension.GOVERNANCE_COMPLETENESS]: 1,
      }),
    );
    // 0.2+0.2+0.2 = 0.6；observability/recovery/evidence 缺失 → 0
    expect(report.overall).toBe(0.6);
    expect(report.below_threshold).toBe(true);
    // 缺失维度有 rationale
    const missing = report.dimensions.find(
      (d) => d.dimension === HarnessabilityDimension.EVIDENCE,
    );
    expect(missing?.rationale).toContain('missing');
  });

  it('权重和不为 1 → 抛错', () => {
    const scorer = new HarnessabilityScorer({
      weights: {
        [HarnessabilityDimension.DURABLE_STATE_COVERAGE]: 0.5,
        [HarnessabilityDimension.TOOL_MEDIATION_QUALITY]: 0.5,
      },
    });
    expect(() => scorer.assess([])).toThrow('weights must sum to 1.0');
  });

  it('默认权重与 harness.yaml 一致', () => {
    expect(DEFAULT_HARNESSABILITY_WEIGHTS[HarnessabilityDimension.DURABLE_STATE_COVERAGE]).toBe(0.2);
    expect(DEFAULT_HARNESSABILITY_WEIGHTS[HarnessabilityDimension.TOOL_MEDIATION_QUALITY]).toBe(0.2);
    expect(DEFAULT_HARNESSABILITY_WEIGHTS[HarnessabilityDimension.GOVERNANCE_COMPLETENESS]).toBe(0.2);
    expect(DEFAULT_HARNESSABILITY_WEIGHTS[HarnessabilityDimension.OBSERVABILITY]).toBe(0.15);
    expect(DEFAULT_HARNESSABILITY_WEIGHTS[HarnessabilityDimension.RECOVERY_CAPABILITY]).toBe(0.15);
    expect(DEFAULT_HARNESSABILITY_WEIGHTS[HarnessabilityDimension.EVIDENCE]).toBe(0.1);
    const total = Object.values(DEFAULT_HARNESSABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
  });
});

describe('评估周期', () => {
  it('从未评估过 → 到期', () => {
    const scorer = new HarnessabilityScorer();
    expect(scorer.isDue(undefined)).toBe(true);
  });

  it('间隔 24h 内 → 未到期；超过 → 到期', () => {
    const scorer = new HarnessabilityScorer({ assessmentIntervalHours: 24 });
    const now = Date.now();
    expect(scorer.isDue(now - 23 * 3_600_000, now)).toBe(false);
    expect(scorer.isDue(now - 25 * 3_600_000, now)).toBe(true);
  });
});
