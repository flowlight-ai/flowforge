/**
 * forging-service — T7.25 Forge Nurturing 流水线域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeForging 挂载 / forge / forgeFromYaml 门面 /
 * getStageConfig / getPrompt / snapshot。
 *
 * @module @flowforge/forgekin-forging/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import { ForgekinFormData, ForgekinSpecies, VirtualForgekin } from '@flowforge/forgekin-species';
import Plugin, { ForgingService } from '../src/index.js';
import { ForgePipeline } from '../src/pipeline.js';
import { ForgingStage } from '../src/forging-stages.js';

function makeForm(): ForgekinFormData {
  return new ForgekinFormData({
    name: '鲁班',
    species: ForgekinSpecies.VIRTUAL,
    namespace: 'flowlight',
  });
}

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeForging', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeForging).toBeInstanceOf(ForgingService);
    expect(ctx.forgeForging.pipeline).toBeInstanceOf(ForgePipeline);
  });
});

describe('锻造门面', () => {
  it('forge 全链路产出 Forgekin', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const fk = await ctx.forgeForging.forge(makeForm());
    expect(fk).toBeInstanceOf(VirtualForgekin);
    expect(fk.forgekinId).toBe('flowlight:鲁班');
  });

  it('forge 透传 contextExtra（llm_client 注入）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const client = { chat: async () => ({ content: '插件回答' }) };
    const fk = await ctx.forgeForging.forge(makeForm(), { llm_client: client });
    const result = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(result['content']).toBe('插件回答');
  });
});

describe('配置门面 / snapshot', () => {
  it('getStageConfig / getPrompt 转发到流水线', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeForging.getStageConfig(ForgingStage.CAPABILITY_VERIFICATION)['min_quality_score']).toBe(0.85);
    expect(ctx.forgeForging.getPrompt(ForgingStage.AWAKENING_PROMOTION)).toContain('觉醒晋升师');
  });

  it('snapshot 反映最近一次锻造结果', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const before = ctx.forgeForging.snapshot();
    expect(before.lastStageResults).toBe(0);
    expect(before.lastAllPassed).toBe(false);
    await ctx.forgeForging.forge(makeForm());
    const after = ctx.forgeForging.snapshot();
    expect(after.stages).toBe(6);
    expect(after.lastStageResults).toBe(6);
    expect(after.lastAllPassed).toBe(true);
  });
});
