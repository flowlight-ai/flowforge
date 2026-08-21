/**
 * CapabilityService — T7.2 能力画像域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeCapability 挂载 + 生命周期（start/stop）
 * - create/get/list/update/remove 注册表 CRUD
 * - hasConflict / detectConflicts / gapAnalysis / recommendPairing 分析入口
 * - summarize / toDict / 维度工厂
 *
 * @module @flowforge/forgekin-capability/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  CapabilityService,
  MemoryCapabilityRegistry,
} from '../src/index.js';
import { makeBlindSpot, makeModelCapability } from '../src/models.js';
import { makeTaskProfile } from '../src/analyzer.js';

const MODEL_A = makeModelCapability({
  provider: 'anthropic',
  modelName: 'claude-sonnet-4',
  contextWindow: 200_000,
  strengths: ['code_generation'],
  limitations: ['math_computation'],
});

const MODEL_B = makeModelCapability({
  provider: 'openai',
  modelName: 'gpt-5',
  contextWindow: 128_000,
  strengths: ['code_generation'],
  limitations: ['counterfactual'],
});

async function createCtx(): Promise<{ ctx: Context; service: CapabilityService }> {
  const ctx = new Context();
  await ctx.plugin(CapabilityService);
  return { ctx, service: ctx.forgeCapability };
}

describe('CapabilityService 插件挂载', () => {
  it('ctx.plugin(CapabilityService) 挂载 ctx.forgeCapability', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeCapability).toBeInstanceOf(CapabilityService);
  });

  it('自定义注册表注入生效', async () => {
    const registry = new MemoryCapabilityRegistry();
    const ctx = new Context();
    await ctx.plugin(CapabilityService, { registry });
    expect(ctx.forgeCapability.registry).toBe(registry);
  });

  it('默认注册表为 MemoryCapabilityRegistry', async () => {
    const { service } = await createCtx();
    expect(service.registry).toBeInstanceOf(MemoryCapabilityRegistry);
  });
});

describe('CRUD 生命周期', () => {
  it('create → get → update → list → remove 全链路', async () => {
    const { service } = await createCtx();
    const p = await service.create({
      profileId: 'profile-a',
      agentId: 'forgekin-a',
      modelCapability: MODEL_A,
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: '大数乘法易错' })],
    });
    expect(p.createdAt).toBe(p.updatedAt);

    expect((await service.get('profile-a'))?.agentId).toBe('forgekin-a');
    expect(await service.get('missing')).toBeUndefined();

    const updated = { ...p, currentState: { ...p.currentState, mood: 'tired' as const } };
    await service.update(updated);
    expect((await service.get('profile-a'))?.currentState.mood).toBe('tired');

    expect((await service.list()).map((x) => x.profileId)).toEqual(['profile-a']);
    expect(await service.remove('profile-a')).toBe(true);
    expect(await service.remove('profile-a')).toBe(false);
    expect(await service.list()).toEqual([]);
  });

  it('create 幂等覆盖同 profileId', async () => {
    const { service } = await createCtx();
    await service.create({ profileId: 'p', agentId: 'a1', modelCapability: MODEL_A });
    await service.create({ profileId: 'p', agentId: 'a2', modelCapability: MODEL_A });
    expect((await service.get('p'))?.agentId).toBe('a2');
  });
});

describe('分析入口', () => {
  it('gapAnalysis：缺失技能 + 盲点风险 + 建议文案', async () => {
    const { service } = await createCtx();
    const p = await service.create({
      profileId: 'profile-coder',
      agentId: 'forgekin-coder',
      modelCapability: MODEL_A,
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: '大数乘法易错' })],
    });
    const report = service.gapAnalysis(p, makeTaskProfile({
      taskId: 't',
      taskType: 'code_generation',
      requiredSkills: ['rust-idioms'],
      forbiddenBlindSpotCategories: ['math_computation'],
    }));
    expect(report.missingSkills).toEqual(['rust-idioms']);
    expect(report.blindSpotRisks).toEqual([['math_computation', '大数乘法易错']]);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('hasConflict / detectConflicts 盲点冲突入口', async () => {
    const { service } = await createCtx();
    const a = await service.create({
      profileId: 'p-a', agentId: 'forgekin-a', modelCapability: MODEL_A,
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: 'a' })],
    });
    const b = await service.create({
      profileId: 'p-b', agentId: 'forgekin-b', modelCapability: MODEL_A,
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: 'b' })],
    });
    const c = await service.create({
      profileId: 'p-c', agentId: 'forgekin-c', modelCapability: MODEL_B,
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: 'c' })],
    });
    expect(service.hasConflict(a, b)).toBe(true);
    expect(service.hasConflict(a, c)).toBe(false);
    expect(service.detectConflicts([a, b, c])).toEqual([['p-a', 'p-b', 'math_computation']]);
  });

  it('recommendPairing：跨厂商 reviewer 推荐', async () => {
    const { service } = await createCtx();
    const author = await service.create({
      profileId: 'p-author', agentId: 'forgekin-author', modelCapability: MODEL_A,
      blindSpots: [makeBlindSpot({ category: 'math_computation', description: 'a' })],
    });
    const sameVendor = await service.create({
      profileId: 'p-same', agentId: 'forgekin-same', modelCapability: MODEL_A,
      blindSpots: [makeBlindSpot({ category: 'counterfactual', description: 'x' })],
    });
    const crossVendor = await service.create({
      profileId: 'p-reviewer', agentId: 'forgekin-reviewer', modelCapability: MODEL_B,
      blindSpots: [makeBlindSpot({ category: 'counterfactual', description: 'y' })],
    });
    const pick = service.recommendPairing(author, [author, sameVendor, crossVendor]);
    expect(pick?.profileId).toBe('p-reviewer');
  });

  it('summarize / toDict / 维度工厂', async () => {
    const { service } = await createCtx();
    const p = await service.create({ profileId: 'p', agentId: 'a', modelCapability: MODEL_A });
    expect(service.summarize(p)).toContain('CapabilityProfile[p]');
    expect(service.toDict(p).profileId).toBe('p');
    expect(service.makeAgentState().mood).toBe('focused');
    expect(service.makeSkillPackage({ name: 's', domain: 'd' }).proficiency).toBe(0.5);
    expect(service.makeToolBoundary().allowedTools).toEqual([]);
    expect(service.makePerformanceLog({ taskType: 'review' }).successRate).toBe(0);
  });
});
