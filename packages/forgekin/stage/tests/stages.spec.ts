/**
 * 双轴阶位枚举 — T7.6 进化阶 × 觉醒阶（E1-E6）验证。
 *
 * 覆盖：
 * - fromString 大小写不敏感 / 非法值抛错
 * - 中英文名 / AI 业界概念 / 整数等级
 * - 能力判定边界：cross-species（E4）、council（E5）、forge-new（E6）、self-evolve（E4）、full-human（E1）
 *
 * @module @flowforge/forgekin-stage/tests
 */

import { describe, expect, it } from 'vitest';
import { AwakeningStage, EvolutionStage } from '../src/stages.js';

describe('EvolutionStage 进化阶', () => {
  it('fromString 大小写不敏感 + trim', () => {
    expect(EvolutionStage.fromString('e3')).toBe(EvolutionStage.E3);
    expect(EvolutionStage.fromString(' E4 ')).toBe(EvolutionStage.E4);
    expect(EvolutionStage.fromString('E1')).toBe(EvolutionStage.E1);
    expect(EvolutionStage.fromString('e6')).toBe(EvolutionStage.E6);
  });

  it('fromString 非法值抛错（含合法值提示）', () => {
    expect(() => EvolutionStage.fromString('E7')).toThrow(/未知的进化阶/);
    expect(() => EvolutionStage.fromString('E7')).toThrow(/E1, E2, E3, E4, E5, E6/);
  });

  it('中英文名与 AI 概念', () => {
    expect(EvolutionStage.chineseName(EvolutionStage.E1)).toBe('萌芽阶');
    expect(EvolutionStage.chineseName(EvolutionStage.E5)).toBe('觉醒阶');
    expect(EvolutionStage.englishName(EvolutionStage.E3)).toBe('Growth');
    expect(EvolutionStage.englishName(EvolutionStage.E6)).toBe('ForgeMind');
    expect(EvolutionStage.aiConcept(EvolutionStage.E4)).toContain('Managed');
    expect(EvolutionStage.aiConcept(EvolutionStage.E5)).toContain('Optimizing');
  });

  it('level 返回 1-6 整数', () => {
    expect(EvolutionStage.level(EvolutionStage.E1)).toBe(1);
    expect(EvolutionStage.level(EvolutionStage.E6)).toBe(6);
  });

  it('canCrossSpecies：≥ E4 可跨物种协作', () => {
    expect(EvolutionStage.canCrossSpecies(EvolutionStage.E3)).toBe(false);
    expect(EvolutionStage.canCrossSpecies(EvolutionStage.E4)).toBe(true);
    expect(EvolutionStage.canCrossSpecies(EvolutionStage.E6)).toBe(true);
  });

  it('canInitiateCouncil：≥ E5 可主动发起 MindCouncil', () => {
    expect(EvolutionStage.canInitiateCouncil(EvolutionStage.E4)).toBe(false);
    expect(EvolutionStage.canInitiateCouncil(EvolutionStage.E5)).toBe(true);
  });

  it('canForgeNewForgekin：仅 E6 可锻造新 Forgekin', () => {
    for (const stage of [EvolutionStage.E1, EvolutionStage.E2, EvolutionStage.E3, EvolutionStage.E4, EvolutionStage.E5]) {
      expect(EvolutionStage.canForgeNewForgekin(stage)).toBe(false);
    }
    expect(EvolutionStage.canForgeNewForgekin(EvolutionStage.E6)).toBe(true);
  });
});

describe('AwakeningStage 觉醒阶', () => {
  it('fromString 大小写不敏感 + 非法值抛错', () => {
    expect(AwakeningStage.fromString('e5')).toBe(AwakeningStage.E5);
    expect(() => AwakeningStage.fromString('E0')).toThrow(/未知的觉醒阶/);
  });

  it('中英文名与 AI 概念', () => {
    expect(AwakeningStage.chineseName(AwakeningStage.E1)).toBe('全导阶');
    expect(AwakeningStage.chineseName(AwakeningStage.E6)).toBe('ForgeMind主导阶');
    expect(AwakeningStage.englishName(AwakeningStage.E3)).toBe('Bounded-Autonomous');
    expect(AwakeningStage.aiConcept(AwakeningStage.E5)).toContain('Co-Creative');
  });

  it('canSelfEvolve：≥ E4 可自我进化', () => {
    expect(AwakeningStage.canSelfEvolve(AwakeningStage.E3)).toBe(false);
    expect(AwakeningStage.canSelfEvolve(AwakeningStage.E4)).toBe(true);
    expect(AwakeningStage.canSelfEvolve(AwakeningStage.E6)).toBe(true);
  });

  it('isFullHumanControl：仅 E1 全人工', () => {
    expect(AwakeningStage.isFullHumanControl(AwakeningStage.E1)).toBe(true);
    for (const stage of [AwakeningStage.E2, AwakeningStage.E3, AwakeningStage.E4, AwakeningStage.E5, AwakeningStage.E6]) {
      expect(AwakeningStage.isFullHumanControl(stage)).toBe(false);
    }
  });
});
