/**
 * forging-stages — 锻造阶段枚举与结果模型契约验证。
 *
 * 覆盖：枚举值 / ordered 顺序 / chineseName / description / fromString /
 * makeForgingStageResult 区间校验。
 *
 * @module @flowforge/forgekin-forging/tests
 */

import { describe, expect, it } from 'vitest';
import { ForgingStage, makeForgingStageResult } from '../src/forging-stages.js';

describe('ForgingStage 枚举', () => {
  it('六阶段值对齐 FM-006', () => {
    expect(ForgingStage.SPECIES_DEFINITION).toBe('species_definition');
    expect(ForgingStage.CAPABILITY_INJECTION).toBe('capability_injection');
    expect(ForgingStage.MEMORY_SEEDING).toBe('memory_seeding');
    expect(ForgingStage.VALUE_ALIGNMENT).toBe('value_alignment');
    expect(ForgingStage.CAPABILITY_VERIFICATION).toBe('capability_verification');
    expect(ForgingStage.AWAKENING_PROMOTION).toBe('awakening_promotion');
  });

  it('ordered 顺序固定不可调换', () => {
    expect(ForgingStage.ordered()).toEqual([
      ForgingStage.SPECIES_DEFINITION,
      ForgingStage.CAPABILITY_INJECTION,
      ForgingStage.MEMORY_SEEDING,
      ForgingStage.VALUE_ALIGNMENT,
      ForgingStage.CAPABILITY_VERIFICATION,
      ForgingStage.AWAKENING_PROMOTION,
    ]);
  });

  it('chineseName / description 覆盖六阶段', () => {
    expect(ForgingStage.chineseName(ForgingStage.SPECIES_DEFINITION)).toBe('形态定义');
    expect(ForgingStage.chineseName(ForgingStage.AWAKENING_PROMOTION)).toBe('觉醒晋升');
    expect(ForgingStage.description(ForgingStage.CAPABILITY_VERIFICATION)).toContain('0.85');
  });

  it('fromString 大小写不敏感；未知值抛错', () => {
    expect(ForgingStage.fromString(' Memory_Seeding ')).toBe(ForgingStage.MEMORY_SEEDING);
    expect(() => ForgingStage.fromString('unknown_stage')).toThrow('未知的锻造阶段');
  });
});

describe('makeForgingStageResult', () => {
  it('默认值：quality_score=null / error=null / output 副本', () => {
    const output = { k: 1 };
    const result = makeForgingStageResult({ stage: ForgingStage.MEMORY_SEEDING, passed: true, output });
    expect(result.quality_score).toBeNull();
    expect(result.error).toBeNull();
    expect(result.duration_seconds).toBe(0);
    output['k'] = 2;
    expect(result.output['k']).toBe(1);
  });

  it('quality_score 越界 / 耗时为负抛错', () => {
    expect(() =>
      makeForgingStageResult({ stage: ForgingStage.CAPABILITY_VERIFICATION, passed: true, quality_score: 1.5 }),
    ).toThrow('0-1');
    expect(() =>
      makeForgingStageResult({ stage: ForgingStage.MEMORY_SEEDING, passed: false, duration_seconds: -1 }),
    ).toThrow('不能为负');
  });
});
