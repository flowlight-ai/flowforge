/**
 * app — F026 ForgeMind 应用层契约验证
 *
 * 覆盖：四钩子注册（模板/技能/通道/自我进化配置，同名覆盖）、
 * YAML 配置驱动注册、forgeFromTemplate（模板查找/未注入 pipeline 抛错）、
 * 模板查询门面。
 *
 * @module @flowforge/forgekin-app/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import type { ForgePipeline } from '@flowforge/forgekin-forging';
import { ForgekinSpecies } from '@flowforge/forgekin-species';
import { loadAutoForgeConfig } from '../src/config.js';
import { parseAutoForgeConfigs } from '../src/auto-forge.js';
import { ForgeMindAppService } from '../src/index.js';

function makeService(): ForgeMindAppService {
  const ctx = new Context();
  return new ForgeMindAppService(ctx, {});
}

describe('四钩子默认注册内容（对齐 Python plugins.py）', () => {
  it('默认模板：孙悟空（virtual）/ 家猫橘子（bio）/ 客厅吊灯（obj）/ 某科技公司（org）', () => {
    const service = makeService();
    expect(service.listTemplates()).toHaveLength(4);
    const wukong = service.listTemplates().find((t) => t.name === '孙悟空');
    expect(wukong?.species).toBe(ForgekinSpecies.VIRTUAL);
    expect(wukong?.extras?.['worldview']).toBe('西游记神话体系');
    expect(service.findTemplatesBySpecies(ForgekinSpecies.BIO).map((t) => t.name)).toEqual(['家猫橘子']);
  });

  it('默认锻造技能 4 项（observe/act/verify/forge_new）', () => {
    const service = makeService();
    expect(service.skills).toHaveLength(4);
    const forgeNew = service.skills.find((s) => s.name === 'forgemind:forge_new');
    expect(forgeNew?.evolution_min).toBe('E6');
    expect(forgeNew?.awakening_min).toBe('E4');
  });

  it('默认 MindCouncil 通道 2 项（愿景对齐 + 跨形态协作）', () => {
    const service = makeService();
    expect(service.councilChannels).toHaveLength(2);
    expect(service.councilChannels[0]?.channel_type).toBe('vision_alignment');
    expect(service.councilChannels[0]?.readonly_paths).toContain('VISION.md#7');
  });

  it('默认自我进化配置（Mode A Scope Guard，Mode B/C 需 E4）', () => {
    const service = makeService();
    expect(service.autoForgeConfigs).toHaveLength(1);
    const config = service.autoForgeConfigs[0]!;
    expect(config.forgekin_id).toBe('forgemind:template:*');
    expect(config.evolution_modes).toEqual(['ModeA_ScopeGuard']);
    expect(config.eval_ledger_policy.min_net_gain).toBe(0.05);
    expect(config.awakening_min_for_mode_b).toBe('E4');
    expect(config.scope_guard.readonly_paths).toContain('rules.md#红线');
  });
});

describe('四钩子注册扩展点（同名覆盖）', () => {
  it('registerForgekins 新增 + 同名覆盖', () => {
    const service = makeService();
    service.registerForgekins({ name: '新模板', species: ForgekinSpecies.HYBRID, requirement: 'r' });
    expect(service.listTemplates()).toHaveLength(5);
    service.registerForgekins({ name: '孙悟空', species: ForgekinSpecies.BIO, requirement: '覆盖' });
    expect(service.listTemplates()).toHaveLength(5);
    expect(service.listTemplates().find((t) => t.name === '孙悟空')?.species).toBe(ForgekinSpecies.BIO);
  });

  it('registerForgeSkills / registerCouncilChannels / registerAutoForgeConfig 同名覆盖', () => {
    const service = makeService();
    service.registerForgeSkills({ name: 'forgemind:observe', skill_type: 'native', description: '覆盖', awakening_min: 'E1' });
    expect(service.skills.find((s) => s.name === 'forgemind:observe')?.description).toBe('覆盖');
    service.registerCouncilChannels({ name: 'forgemind:vision_review', channel_type: 'x', description: '覆盖', participants: [], readonly_paths: [] });
    expect(service.councilChannels.find((c) => c.name === 'forgemind:vision_review')?.channel_type).toBe('x');
    service.registerAutoForgeConfig({ forgekin_id: 'forgemind:template:*', scope_guard: { readonly_paths: [], writable_paths: [] }, evolution_modes: ['ModeA_ScopeGuard'], eval_ledger_policy: { replay_ab_required: true, min_net_gain: 0.1 }, awakening_min_for_mode_b: 'E4', awakening_min_for_mode_c: 'E4' });
    expect(service.autoForgeConfigs[0]!.eval_ledger_policy.min_net_gain).toBe(0.1);
  });

  it('registerAutoForgeFromYaml 从内置 auto-forge.yaml 加载注册', () => {
    const service = makeService();
    service.autoForgeConfigs.length = 0;
    service.registerAutoForgeFromYaml();
    expect(service.autoForgeConfigs).toHaveLength(1);
    expect(service.autoForgeConfigs[0]!.forgekin_id).toBe('forgemind:template:*');
    expect(service.autoForgeConfigs[0]!.evolution_modes).toEqual(['ModeA_ScopeGuard']);
  });
});

describe('YAML 配置解析', () => {
  it('内置 auto-forge.yaml 解析出自我进化配置', () => {
    const raw = loadAutoForgeConfig();
    const configs = parseAutoForgeConfigs(raw['auto_forge']);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.scope_guard.readonly_paths).toContain('VISION.md#7');
    expect(configs[0]!.eval_ledger_policy.replay_ab_required).toBe(true);
  });

  it('宽松解析缺省回落内置默认', () => {
    const configs = parseAutoForgeConfigs(undefined);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.awakening_min_for_mode_b).toBe('E4');
  });
});

describe('forgeFromTemplate 便捷锻造入口', () => {
  it('模板不存在抛错（列出可用模板）', async () => {
    const service = makeService();
    await expect(service.forgeFromTemplate('不存在')).rejects.toThrow(/未找到Forgekin模板: 不存在/);
  });

  it('pipeline 未注入抛错', async () => {
    const service = makeService();
    await expect(service.forgeFromTemplate('孙悟空')).rejects.toThrow(/ForgePipeline 未注入/);
  });

  it('注入 pipeline 后按模板锻造（构造 ForgekinFormData 并调用 pipeline.forge）', async () => {
    const forged = { forgekin_id: '孙悟空_1' };
    const pipeline = { forge: async () => forged } as unknown as ForgePipeline;
    const ctx = new Context();
    const service = new ForgeMindAppService(ctx, { pipeline });
    const result = await service.forgeFromTemplate('孙悟空', { namespace: 'forgemind' });
    expect(result).toEqual(forged);
  });
});
