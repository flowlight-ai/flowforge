/**
 * metacognition — T7.20 元认知路由 + Mode C 反思验证。
 *
 * 覆盖：Laplace 平滑可靠度 / Wilson 下界数值 / 三信号路由（proceed/
 * structured_analysis_only/escalate）/ 高风险域权重调整 / Mode C 反思 delta。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import {
  HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD,
  MetacognitionReflector,
  MetacognitionRouter,
} from '../src/metacognition.js';

describe('MetacognitionRouter.computeDomainReliability', () => {
  it('Laplace 平滑 (successes+1)/(trials+2)', () => {
    const router = new MetacognitionRouter();
    expect(router.computeDomainReliability(0, 0)).toBeCloseTo(0.5);
    expect(router.computeDomainReliability(2, 2)).toBeCloseTo(0.75);
    expect(router.computeDomainReliability(8, 10)).toBeCloseTo(0.75);
  });

  it('非法输入抛错', () => {
    const router = new MetacognitionRouter();
    expect(() => router.computeDomainReliability(1, -1)).toThrow(/trials/);
    expect(() => router.computeDomainReliability(3, 2)).toThrow(/out of range/);
  });
});

describe('MetacognitionRouter.computeWilsonLowerBound', () => {
  it('trials<=0 返回 0.0', () => {
    const router = new MetacognitionRouter();
    expect(router.computeWilsonLowerBound(0, 0)).toBe(0.0);
  });

  it('Wilson 下界 ≤ 点估计且 ≥0（钳制）', () => {
    const router = new MetacognitionRouter();
    const lower = router.computeWilsonLowerBound(50, 100);
    expect(lower).toBeGreaterThanOrEqual(0.0);
    expect(lower).toBeLessThanOrEqual(0.5);
    expect(lower).toBeLessThan(0.5); // 下界严格小于点估计
  });

  it('小样本高成功率下界显著低于点估计（保守）', () => {
    const router = new MetacognitionRouter();
    const lower = router.computeWilsonLowerBound(1, 1);
    expect(lower).toBeGreaterThan(0.0);
    expect(lower).toBeLessThan(1.0);
  });

  it('非法输入抛错', () => {
    const router = new MetacognitionRouter();
    expect(() => router.computeWilsonLowerBound(2, 1)).toThrow(/out of range/);
    expect(() => router.computeWilsonLowerBound(1, 2, 0)).toThrow(/z must be > 0/);
  });
});

describe('MetacognitionRouter.routeConfidence', () => {
  it('高置信三信号 → proceed', () => {
    const router = new MetacognitionRouter();
    const result = router.routeConfidence({
      domainReliability: 0.9,
      evidenceCompleteness: 0.9,
      selfReported: 0.9,
    });
    expect(result.route).toBe('proceed');
    expect(result.actionConfidence).toBeGreaterThanOrEqual(HIGH_RISK_ACTION_CONFIDENCE_THRESHOLD);
  });

  it('低置信 → structured_analysis_only', () => {
    const router = new MetacognitionRouter();
    const result = router.routeConfidence({
      domainReliability: 0.3,
      evidenceCompleteness: 0.3,
      selfReported: 0.3,
    });
    expect(result.route).toBe('structured_analysis_only');
  });

  it('高风险域低置信 → escalate（仅结构化分析 + 升级）', () => {
    const router = new MetacognitionRouter();
    const result = router.routeConfidence({
      domainReliability: 0.3,
      evidenceCompleteness: 0.3,
      selfReported: 0.9, // 自报高也不救（self_reported 权重=0）
      isHighRisk: true,
    });
    expect(result.route).toBe('escalate');
    expect(result.reason).toContain('high-risk');
  });

  it('高风险域 self_reported 权重降为 0（更保守）', () => {
    const router = new MetacognitionRouter();
    const highRisk = router.routeConfidence({
      domainReliability: 0.5,
      evidenceCompleteness: 0.5,
      selfReported: 1.0,
      isHighRisk: true,
    });
    const normal = router.routeConfidence({
      domainReliability: 0.5,
      evidenceCompleteness: 0.5,
      selfReported: 1.0,
      isHighRisk: false,
    });
    // 高风险：sr 权重 0 → dr*0.575 + ec*0.425 = 0.5；普通：0.5*0.5+0.5*0.35+1*0.15 = 0.575
    expect(highRisk.actionConfidence).toBeCloseTo(0.5, 4);
    expect(normal.actionConfidence).toBeCloseTo(0.575, 4);
  });

  it('signals 含三信号原值 + is_high_risk 标记', () => {
    const router = new MetacognitionRouter();
    const result = router.routeConfidence({
      domainReliability: 0.8,
      evidenceCompleteness: 0.7,
      selfReported: 0.6,
      isHighRisk: true,
    });
    expect(result.signals.domainReliability).toBe(0.8);
    expect(result.signals.evidenceCompleteness).toBe(0.7);
    expect(result.signals.selfReportedConfidence).toBe(0.6);
    expect(result.signals.isHighRisk).toBe(true);
  });
});

describe('MetacognitionReflector（Mode C）', () => {
  it('reflection_id 按决策编号递增', () => {
    const reflector = new MetacognitionReflector();
    const r1 = reflector.reflectOnDecision({ decisionId: 'd1', domain: 'dev', outcome: 'confirmed' });
    const r2 = reflector.reflectOnDecision({ decisionId: 'd2', domain: 'dev', outcome: 'rejected' });
    expect(r1.reflectionId).toBe('reflect-d1-0000');
    expect(r2.reflectionId).toBe('reflect-d2-0001');
  });

  it('confirmed → delta +0.02；rejected → -0.10；escalated → -0.05', () => {
    const reflector = new MetacognitionReflector();
    expect(
      reflector.reflectOnDecision({ decisionId: 'a', domain: 'dev', outcome: 'confirmed' }).signalUpdates,
    ).toEqual({ domain_reliability_delta: 0.02 });
    expect(
      reflector.reflectOnDecision({ decisionId: 'b', domain: 'dev', outcome: 'rejected' }).signalUpdates,
    ).toEqual({ domain_reliability_delta: -0.1 });
    expect(
      reflector.reflectOnDecision({ decisionId: 'c', domain: 'dev', outcome: 'escalated' }).signalUpdates,
    ).toEqual({ domain_reliability_delta: -0.05 });
  });

  it('computeReliabilityAdjustment 按领域累积 delta', () => {
    const reflector = new MetacognitionReflector();
    reflector.reflectOnDecision({ decisionId: 'a', domain: 'dev', outcome: 'confirmed' });
    reflector.reflectOnDecision({ decisionId: 'b', domain: 'dev', outcome: 'rejected' });
    reflector.reflectOnDecision({ decisionId: 'c', domain: 'ops', outcome: 'confirmed' });
    expect(reflector.computeReliabilityAdjustment('dev')).toBeCloseTo(-0.08);
    expect(reflector.computeReliabilityAdjustment('ops')).toBeCloseTo(0.02);
    expect(reflector.computeReliabilityAdjustment('nope')).toBe(0.0);
  });

  it('computeCalibrationScore = (confirmed+corrected)/total', () => {
    const reflector = new MetacognitionReflector();
    reflector.reflectOnDecision({ decisionId: 'a', domain: 'dev', outcome: 'confirmed' });
    reflector.reflectOnDecision({ decisionId: 'b', domain: 'dev', outcome: 'corrected' });
    reflector.reflectOnDecision({ decisionId: 'c', domain: 'dev', outcome: 'rejected' });
    expect(reflector.computeCalibrationScore('dev')).toBeCloseTo(2 / 3);
    expect(reflector.computeCalibrationScore()).toBeCloseTo(2 / 3);
    expect(reflector.computeCalibrationScore('nope')).toBe(0.0);
  });

  it('exportToEchoStore 返回可序列化副本', () => {
    const reflector = new MetacognitionReflector();
    reflector.reflectOnDecision({ decisionId: 'a', domain: 'dev', outcome: 'confirmed', reflectionNotes: 'note' });
    const exported = reflector.exportToEchoStore();
    expect(exported).toHaveLength(1);
    expect(exported[0]?.reflectionNotes).toBe('note');
  });
});
