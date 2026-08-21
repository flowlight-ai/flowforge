/**
 * ProfileAnalyzer — T7.2 能力画像分析器契约验证。
 *
 * 覆盖（对齐 Python `core/capability/analyzer.py` 语义）：
 * - computeGap：缺失技能/缺失工具/盲点风险/上下文不足/认知不匹配 + 建议文案
 * - hasCriticalGap 判定
 * - detectBlindSpotConflicts：同厂商+同类别批量冲突
 * - recommendPairing：跨厂商优先 → 盲点不重叠 → 重叠最少兜底
 *
 * @module @flowforge/forgekin-capability/tests
 */

import { describe, expect, it } from 'vitest';
import {
  makeBlindSpot,
  makeHarnessFitScore,
  makeModelCapability,
  makeSkillPackage,
  makeToolBoundary,
} from '../src/models.js';
import { makeCapabilityProfile } from '../src/profile.js';
import {
  hasCriticalGap,
  makeGapReport,
  makeTaskProfile,
  ProfileAnalyzer,
} from '../src/analyzer.js';

const analyzer = new ProfileAnalyzer();

const ANTHROPIC_MODEL = makeModelCapability({
  provider: 'anthropic',
  modelName: 'claude-sonnet-4',
  contextWindow: 200_000,
  strengths: ['code_generation', 'reasoning'],
  limitations: ['math_computation'],
});

const OPENAI_MODEL = makeModelCapability({
  provider: 'openai',
  modelName: 'gpt-5',
  contextWindow: 128_000,
  strengths: ['code_generation', 'structured_output'],
  limitations: ['counterfactual'],
});

function profile(overrides: Partial<Parameters<typeof makeCapabilityProfile>[0]> = {}): ReturnType<typeof makeCapabilityProfile> {
  return makeCapabilityProfile({
    profileId: 'profile-coder-1',
    agentId: 'forgekin-coder',
    modelCapability: ANTHROPIC_MODEL,
    ...overrides,
  });
}

describe('TaskProfile / GapReport 工厂', () => {
  it('makeTaskProfile 缺省空数组 + 保留显式字段', () => {
    const tp = makeTaskProfile({ taskId: 't1', taskType: 'review' });
    expect(tp.requiredSkills).toEqual([]);
    expect(tp.minContextWindow).toBeUndefined();
  });

  it('makeGapReport 缺省 + hasCriticalGap 判定', () => {
    const empty = makeGapReport();
    expect(hasCriticalGap(empty)).toBe(false);
    expect(hasCriticalGap(makeGapReport({ missingSkills: ['x'] }))).toBe(true);
    expect(hasCriticalGap(makeGapReport({ missingTools: ['x'] }))).toBe(true);
    expect(hasCriticalGap(makeGapReport({ blindSpotRisks: [['math_computation', 'd']] }))).toBe(true);
    expect(hasCriticalGap(makeGapReport({ contextWindowInsufficient: true }))).toBe(true);
    // 仅认知风格不匹配 → 非关键 gap
    expect(hasCriticalGap(makeGapReport({ cognitiveStyleMismatch: true }))).toBe(false);
  });
});

describe('computeGap', () => {
  it('全空：无 gap 无建议', () => {
    const report = analyzer.computeGap(profile(), makeTaskProfile({ taskId: 't', taskType: 'review' }));
    expect(report.missingSkills).toEqual([]);
    expect(report.missingTools).toEqual([]);
    expect(report.blindSpotRisks).toEqual([]);
    expect(report.recommendations).toEqual([]);
    expect(hasCriticalGap(report)).toBe(false);
  });

  it('缺失技能：任务要求但未加载的知识包', () => {
    const p = profile({
      skillPackages: [makeSkillPackage({ name: 'ts-strict', domain: 'programming' })],
    });
    const report = analyzer.computeGap(p, makeTaskProfile({
      taskId: 't', taskType: 'code_generation',
      requiredSkills: ['ts-strict', 'rust-idioms'],
    }));
    expect(report.missingSkills).toEqual(['rust-idioms']);
    expect(report.recommendations[0]).toContain('rust-idioms');
  });

  it('缺失工具：不在白名单 或 在黑名单', () => {
    const p = profile({
      toolBoundary: makeToolBoundary({
        allowedTools: ['read_file', 'bash'],
        forbiddenTools: ['bash'],
      }),
    });
    const report = analyzer.computeGap(p, makeTaskProfile({
      taskId: 't', taskType: 'code_generation',
      requiredTools: ['read_file', 'bash', 'write_file'],
    }));
    // bash 在黑名单 → 缺失；write_file 不在白名单 → 缺失
    expect(report.missingTools.sort()).toEqual(['bash', 'write_file']);
  });

  it('盲点风险：任务禁忌类别 ∩ Forgekin 盲点类别，逐盲点输出', () => {
    const p = profile({
      blindSpots: [
        makeBlindSpot({ category: 'math_computation', description: '大数乘法易错' }),
        makeBlindSpot({ category: 'math_computation', description: '分数运算易错' }),
        makeBlindSpot({ category: 'hallucination_prone', description: '易幻觉' }),
      ],
    });
    const report = analyzer.computeGap(p, makeTaskProfile({
      taskId: 't', taskType: 'code_generation',
      forbiddenBlindSpotCategories: ['math_computation'],
    }));
    expect(report.blindSpotRisks).toHaveLength(2);
    expect(report.blindSpotRisks[0]).toEqual(['math_computation', '大数乘法易错']);
    expect(report.recommendations.some((r) => r.includes('跨厂商 review'))).toBe(true);
  });

  it('上下文窗口不足：minContextWindow > contextWindow', () => {
    const report = analyzer.computeGap(profile(), makeTaskProfile({
      taskId: 't', taskType: 'review', minContextWindow: 300_000,
    }));
    expect(report.contextWindowInsufficient).toBe(true);
    expect(report.recommendations.some((r) => r.includes('300000') && r.includes('200000'))).toBe(true);
  });

  it('认知风格不匹配：期望列表不含实际风格', () => {
    const report = analyzer.computeGap(profile(), makeTaskProfile({
      taskId: 't', taskType: 'writing',
      preferredCognitiveStyles: ['concise'],
    }));
    expect(report.cognitiveStyleMismatch).toBe(true);
    expect(report.recommendations.some((r) => r.includes('concise') && r.includes('structured'))).toBe(true);
  });

  it('自定义模板生效（对应 Python prompts.yaml 注入）', () => {
    const custom = new ProfileAnalyzer({
      templates: { missingSkill: '[custom] load {skill} now' },
    });
    const report = custom.computeGap(profile(), makeTaskProfile({
      taskId: 't', taskType: 'review', requiredSkills: ['rust-idioms'],
    }));
    expect(report.recommendations[0]).toBe('[custom] load rust-idioms now');
  });
});

describe('detectBlindSpotConflicts', () => {
  const anthropicMath = profile({
    profileId: 'p-a',
    blindSpots: [makeBlindSpot({ category: 'math_computation', description: 'a' })],
  });
  const anthropicHallucination = profile({
    profileId: 'p-b',
    blindSpots: [makeBlindSpot({ category: 'hallucination_prone', description: 'b' })],
  });
  const openaiMath = profile({
    profileId: 'p-c',
    modelCapability: OPENAI_MODEL,
    blindSpots: [makeBlindSpot({ category: 'math_computation', description: 'c' })],
  });
  const anthropicMath2 = profile({
    profileId: 'p-d',
    blindSpots: [makeBlindSpot({ category: 'math_computation', description: 'd' })],
  });

  it('仅同厂商 + 同类别配对命中', () => {
    const conflicts = analyzer.detectBlindSpotConflicts([
      anthropicMath, anthropicHallucination, openaiMath, anthropicMath2,
    ]);
    // (p-a, p-d) math_computation 命中；(p-a/p-d, p-b) 类别不同不命中；openai 不同厂商不命中
    expect(conflicts).toEqual([['p-a', 'p-d', 'math_computation']]);
  });

  it('空候选 / 单候选 → 无冲突', () => {
    expect(analyzer.detectBlindSpotConflicts([])).toEqual([]);
    expect(analyzer.detectBlindSpotConflicts([anthropicMath])).toEqual([]);
  });
});

describe('recommendPairing', () => {
  const author = profile({
    blindSpots: [
      makeBlindSpot({ category: 'math_computation', description: 'a' }),
      makeBlindSpot({ category: 'hallucination_prone', description: 'h' }),
    ],
  });

  it('优先不同厂商 + 盲点不重叠 + harness 分最高', () => {
    const sameVendor = profile({
      profileId: 'p-same',
      blindSpots: [makeBlindSpot({ category: 'counterfactual', description: 'x' })],
    });
    const crossVendorLow = profile({
      profileId: 'p-low',
      modelCapability: OPENAI_MODEL,
      blindSpots: [makeBlindSpot({ category: 'counterfactual', description: 'y' })],
      harnessFitScore: makeHarnessFitScore({ overall: 0.6 }),
    });
    const crossVendorHigh = profile({
      profileId: 'p-high',
      modelCapability: OPENAI_MODEL,
      blindSpots: [makeBlindSpot({ category: 'counterfactual', description: 'z' })],
      harnessFitScore: makeHarnessFitScore({ overall: 0.9 }),
    });
    const pick = analyzer.recommendPairing(author, [sameVendor, crossVendorLow, crossVendorHigh]);
    expect(pick?.profileId).toBe('p-high');
  });

  it('跨厂商候选均盲点重叠 → 选重叠最少者兜底', () => {
    const oneOverlap = profile({
      profileId: 'p-1',
      modelCapability: OPENAI_MODEL,
      blindSpots: [
        makeBlindSpot({ category: 'math_computation', description: '重叠' }),
        makeBlindSpot({ category: 'counterfactual', description: '不重叠' }),
      ],
    });
    const twoOverlap = profile({
      profileId: 'p-2',
      modelCapability: OPENAI_MODEL,
      blindSpots: [
        makeBlindSpot({ category: 'math_computation', description: '重叠1' }),
        makeBlindSpot({ category: 'hallucination_prone', description: '重叠2' }),
      ],
    });
    const pick = analyzer.recommendPairing(author, [twoOverlap, oneOverlap]);
    expect(pick?.profileId).toBe('p-1');
  });

  it('无跨厂商候选 → undefined（调用方升级 operator）', () => {
    const sameVendor = profile({
      profileId: 'p-same',
      blindSpots: [makeBlindSpot({ category: 'counterfactual', description: 'x' })],
    });
    expect(analyzer.recommendPairing(author, [sameVendor])).toBeUndefined();
  });

  it('作者自身不参与推荐', () => {
    const self = profile({
      blindSpots: [makeBlindSpot({ category: 'counterfactual', description: 'x' })],
    });
    expect(analyzer.recommendPairing(author, [self])).toBeUndefined();
  });
});
