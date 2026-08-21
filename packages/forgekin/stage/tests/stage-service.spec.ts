/**
 * StageService — T7.6 阶段与成熟度域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeStage 挂载 + ladder 注入/缺省
 * - 双轴枚举委托（parse/名称/level/能力判定）
 * - 成熟度阶梯委托（晋升/降级/冻结）
 *
 * @module @flowforge/forgekin-stage/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  AwakeningStage,
  EvolutionStage,
  KnowledgeMaturityLadder,
  StageService,
} from '../src/index.js';

describe('StageService 插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeStage', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeStage).toBeInstanceOf(StageService);
    expect(ctx.forgeStage.ladder).toBeInstanceOf(KnowledgeMaturityLadder);
  });

  it('自定义 ladder 注入', async () => {
    const ladder = new KnowledgeMaturityLadder();
    const ctx = new Context();
    await ctx.plugin(StageService, { ladder });
    expect(ctx.forgeStage.ladder).toBe(ladder);
  });
});

describe('StageService 双轴委托', () => {
  it('parseEvolutionStage / evolutionLevel / 能力判定', async () => {
    const ctx = new Context();
    await ctx.plugin(StageService);
    expect(ctx.forgeStage.parseEvolutionStage('e5')).toBe(EvolutionStage.E5);
    expect(ctx.forgeStage.evolutionLevel(EvolutionStage.E4)).toBe(4);
    expect(ctx.forgeStage.evolutionChineseName(EvolutionStage.E3)).toBe('成长阶');
    expect(ctx.forgeStage.evolutionEnglishName(EvolutionStage.E4)).toBe('Growth-Deep');
    expect(ctx.forgeStage.evolutionAiConcept(EvolutionStage.E6)).toContain('Master');
    expect(ctx.forgeStage.canCrossSpecies(EvolutionStage.E3)).toBe(false);
    expect(ctx.forgeStage.canCrossSpecies(EvolutionStage.E4)).toBe(true);
    expect(ctx.forgeStage.canInitiateCouncil(EvolutionStage.E5)).toBe(true);
    expect(ctx.forgeStage.canForgeNewForgekin(EvolutionStage.E6)).toBe(true);
  });

  it('parseAwakeningStage / 觉醒阶能力判定', async () => {
    const ctx = new Context();
    await ctx.plugin(StageService);
    expect(ctx.forgeStage.parseAwakeningStage('e3')).toBe(AwakeningStage.E3);
    expect(ctx.forgeStage.awakeningChineseName(AwakeningStage.E4)).toBe('Evolving 阶');
    expect(ctx.forgeStage.canSelfEvolve(AwakeningStage.E4)).toBe(true);
    expect(ctx.forgeStage.isFullHumanControl(AwakeningStage.E1)).toBe(true);
    expect(ctx.forgeStage.isFullHumanControl(AwakeningStage.E2)).toBe(false);
  });
});

describe('StageService 成熟度委托', () => {
  it('checkPromotion：L0 → L1 条件满足', async () => {
    const ctx = new Context();
    await ctx.plugin(StageService);
    expect(ctx.forgeStage.checkPromotion('k1', 'L0', {
      episodesCount: 2, episodeWindowDays: 30, fiveQScore: 8,
    })).toBe('L1');
    expect(ctx.forgeStage.checkPromotion('k1', 'L0', {
      episodesCount: 1, episodeWindowDays: 30, fiveQScore: 8,
    })).toBeNull();
  });

  it('checkDemotion：L2 最近 3 次 <50% → L1', async () => {
    const ctx = new Context();
    await ctx.plugin(StageService);
    expect(ctx.forgeStage.checkDemotion('k2', 'L2', [true, false, false])).toBe('L1');
  });

  it('checkFreeze：仅 L4 + 越界', async () => {
    const ctx = new Context();
    await ctx.plugin(StageService);
    expect(ctx.forgeStage.checkFreeze('k3', 'L4', true)).toBe(true);
    expect(ctx.forgeStage.checkFreeze('k3', 'L3', true)).toBe(false);
  });
});
