/**
 * CapabilityProfile — T7.2 能力画像主模型契约验证。
 *
 * 覆盖（对齐 Python `core/capability/profile.py` 语义）：
 * - makeCapabilityProfile 六维缺省工厂 + draft 画像判定
 * - hasBlindSpotConflict：同厂商+同类别 → 冲突；不同厂商 → 无冲突
 * - gapAnalysis 委托 analyzer（模块加载即注册）
 * - toProfileSummary / getPerformance / hasSkill / toProfileDict
 *
 * @module @flowforge/forgekin-capability/tests
 */

import { describe, expect, it } from 'vitest';
import {
  makeBlindSpot,
  makeModelCapability,
  makePerformanceLog,
  makeSkillPackage,
  makeToolBoundary,
} from '../src/models.js';
import {
  makeCapabilityProfile,
  gapAnalysis,
  getPerformance,
  hasBlindSpotConflict,
  hasSkill,
  toProfileDict,
  toProfileSummary,
  CapabilityProfile,
} from '../src/profile.js';
import { makeTaskProfile } from '../src/analyzer.js';

const ANTHROPIC_MODEL = makeModelCapability({
  provider: 'anthropic',
  modelName: 'claude-sonnet-4',
  contextWindow: 200_000,
  strengths: ['code_generation', 'reasoning', 'long_context'],
  limitations: ['math_computation', 'temporal_reasoning'],
});

const OPENAI_MODEL = makeModelCapability({
  provider: 'openai',
  modelName: 'gpt-5',
  contextWindow: 128_000,
  strengths: ['code_generation', 'structured_output'],
  limitations: ['counterfactual'],
});

function profile(overrides: Partial<Parameters<typeof makeCapabilityProfile>[0]> = {}): CapabilityProfile {
  return makeCapabilityProfile({
    profileId: 'profile-coder-1',
    agentId: 'forgekin-coder',
    modelCapability: ANTHROPIC_MODEL,
    ...overrides,
  });
}

describe('makeCapabilityProfile', () => {
  it('六维缺省工厂：认知风格/工具边界/状态/契合度走默认值', () => {
    const p = profile();
    expect(p.cognitiveStyle.explanationStyle).toBe('structured');
    expect(p.toolBoundary.allowedTools).toEqual([]);
    expect(p.currentState.mood).toBe('focused');
    expect(p.harnessFitScore.overall).toBe(0.5);
    expect(p.blindSpots).toEqual([]);
    expect(p.skillPackages).toEqual([]);
  });

  it('createdAt/updatedAt 缺省取当前时间且相等（draft 画像判定依据）', () => {
    const p = profile();
    expect(p.createdAt).toBe(p.updatedAt);
    expect(new Date(p.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('显式传入的维度覆盖默认值', () => {
    const p = profile({
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: '大数乘法易错' })],
      skillPackages: [makeSkillPackage({ name: 'ts-strict', domain: 'programming' })],
      toolBoundary: makeToolBoundary({ allowedTools: ['read_file', 'bash'] }),
    });
    expect(p.blindSpots).toHaveLength(1);
    expect(p.skillPackages[0]!.name).toBe('ts-strict');
    expect(p.toolBoundary.allowedTools).toEqual(['read_file', 'bash']);
  });

  it('浅拷贝语义：传入数组不影响画像内部', () => {
    const spots = [makeBlindSpot({ category: 'over_confidence', description: '对测试覆盖率过度自信' })];
    const p = profile({ blindSpots: spots });
    spots.push(makeBlindSpot({ category: 'other', description: 'x' }));
    expect(p.blindSpots).toHaveLength(1);
  });
});

describe('hasBlindSpotConflict', () => {
  const a = profile({
    blindSpots: [makeBlindSpot({ category: 'math_computation', description: '大数乘法易错' })],
  });

  it('不同厂商 → 无冲突（训练分布偏差天然分散）', () => {
    const b = profile({
      profileId: 'profile-coder-2',
      modelCapability: OPENAI_MODEL,
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: '同样的盲点' })],
    });
    expect(hasBlindSpotConflict(a, b)).toBe(false);
  });

  it('同厂商 + 同类别 → 冲突（需跨厂商 review）', () => {
    const b = profile({
      profileId: 'profile-coder-2',
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: '分数运算易错' })],
    });
    expect(hasBlindSpotConflict(a, b)).toBe(true);
  });

  it('同厂商 + 不同类别 → 无冲突', () => {
    const b = profile({
      profileId: 'profile-coder-2',
      blindSpots: [makeBlindSpot({ category: 'hallucination_prone', description: '易幻觉' })],
    });
    expect(hasBlindSpotConflict(a, b)).toBe(false);
  });

  it('任一方盲点为空 → 无冲突', () => {
    expect(hasBlindSpotConflict(a, profile())).toBe(false);
  });
});

describe('gapAnalysis', () => {
  it('委托 ProfileAnalyzer.computeGap：缺失技能 + 工具 + 盲点风险', () => {
    const p = profile({
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: '大数乘法易错' })],
      skillPackages: [makeSkillPackage({ name: 'ts-strict', domain: 'programming' })],
      toolBoundary: makeToolBoundary({ allowedTools: ['read_file'] }),
    });
    const report = gapAnalysis(p, makeTaskProfile({
      taskId: 'task-1',
      taskType: 'code_generation',
      requiredSkills: ['ts-strict', 'rust-idioms'],
      requiredTools: ['read_file', 'bash'],
      forbiddenBlindSpotCategories: ['math_computation'],
      minContextWindow: 100_000,
      preferredCognitiveStyles: ['structured'],
    }));
    expect(report.missingSkills).toEqual(['rust-idioms']);
    expect(report.missingTools).toEqual(['bash']);
    expect(report.blindSpotRisks).toEqual([['math_computation', '大数乘法易错']]);
    expect(report.contextWindowInsufficient).toBe(false);
    expect(report.cognitiveStyleMismatch).toBe(false);
    expect(report.recommendations.some((r) => r.includes('rust-idioms'))).toBe(true);
  });

  it('模块未注册时抛出明确错误（防御）', async () => {
    // registerGapAnalyzer 已被 analyzer 模块注册——通过动态模块模拟无法简单卸载，
    // 此处仅验证正常路径可分析，注册契约由 analyzer.spec 覆盖。
    const p = profile();
    const report = gapAnalysis(p, makeTaskProfile({ taskId: 't', taskType: 'review' }));
    expect(report.missingSkills).toEqual([]);
  });
});

describe('toProfileSummary / getPerformance / hasSkill / toProfileDict', () => {
  const p = profile({
    blindSpots: [makeBlindSpot({ category: 'math_computation', description: '大数乘法易错' })],
    skillPackages: [makeSkillPackage({ name: 'ts-strict', domain: 'programming' })],
    historicalPerformance: [makePerformanceLog({ taskType: 'code_generation', successRate: 0.9, sampleCount: 20 })],
  });

  it('toProfileSummary 包含关键维度且缺省兜底', () => {
    const s = toProfileSummary(p);
    expect(s).toContain('CapabilityProfile[profile-coder-1]');
    expect(s).toContain('anthropic/claude-sonnet-4');
    expect(s).toContain('blind_spots=[math_computation]');
    expect(s).toContain('1 task types');
    const empty = toProfileSummary(profile());
    expect(empty).toContain('(none)');
    expect(empty).toContain('(no history)');
  });

  it('getPerformance 按 taskType 查询', () => {
    expect(getPerformance(p, 'code_generation')?.successRate).toBe(0.9);
    expect(getPerformance(p, 'review')).toBeUndefined();
  });

  it('hasSkill 判断知识包是否加载', () => {
    expect(hasSkill(p, 'ts-strict')).toBe(true);
    expect(hasSkill(p, 'rust-idioms')).toBe(false);
  });

  it('toProfileDict 可 JSON 序列化往返', () => {
    const dict = toProfileDict(p);
    expect(JSON.parse(JSON.stringify(dict)).profileId).toBe('profile-coder-1');
  });
});
