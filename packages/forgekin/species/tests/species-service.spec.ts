/**
 * species-service — T7.25 物种体系域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeSpecies 挂载 / create / spawn / adopt / get / remove /
 * registerSpecies 扩展 / snapshot。
 *
 * @module @flowforge/forgekin-species/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import { forgeSoulImprint } from '@flowforge/forgekin-soul';
import Plugin, { SpeciesService } from '../src/index.js';
import { ForgekinRegistry } from '../src/registry.js';
import { ForgekinSpecies } from '../src/species-enum.js';
import { VirtualForgekin } from '../src/impl/virtual.js';

function makeImprint(name: string) {
  return forgeSoulImprint({ name }, ['不伤害 operator'], 'flowlight');
}

function commonInit(name: string): Record<string, unknown> {
  return { forgekin_id: `fk-${name}`, name, soul_imprint: makeImprint(name) };
}

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeSpecies', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeSpecies).toBeInstanceOf(SpeciesService);
    expect(ctx.forgeSpecies.registry).toBeInstanceOf(ForgekinRegistry);
  });

  it('支持注入预创建的注册表', async () => {
    const registry = new ForgekinRegistry();
    const ctx = new Context();
    await ctx.plugin(Plugin, { registry });
    expect(ctx.forgeSpecies.registry).toBe(registry);
  });
});

describe('工厂门面', () => {
  it('create 经工厂注册表分发', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const fk = ctx.forgeSpecies.create(ForgekinSpecies.VIRTUAL, commonInit('悟空'));
    expect(fk).toBeInstanceOf(VirtualForgekin);
    expect(fk.species).toBe(ForgekinSpecies.VIRTUAL);
  });

  it('registerSpecies 扩展新构造器（插件扩展点）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    let used = false;
    ctx.forgeSpecies.registerSpecies(ForgekinSpecies.OBJ, (init) => {
      used = true;
      return new VirtualForgekin({
        forgekin_id: String(init['forgekin_id']),
        name: String(init['name']),
        soul_imprint: init['soul_imprint'] as never,
      });
    });
    ctx.forgeSpecies.create(ForgekinSpecies.OBJ, commonInit('小灯'));
    expect(used).toBe(true);
  });

  it('speciesMetadata 返回谱系元数据', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeSpecies.speciesMetadata(ForgekinSpecies.BIO).class_name).toBe('BioForgekin');
  });
});

describe('活实例门面', () => {
  it('spawn → get → remove 全链路', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const svc = ctx.forgeSpecies;
    const fk = svc.spawn(ForgekinSpecies.VIRTUAL, commonInit('悟空'));
    expect(svc.get('fk-悟空')).toBe(fk);
    expect(svc.listInstances()).toHaveLength(1);
    svc.remove('fk-悟空');
    expect(svc.listInstances()).toHaveLength(0);
    expect(() => svc.get('fk-悟空')).toThrow('不存在');
    expect(() => svc.remove('fk-悟空')).toThrow('不存在');
  });

  it('spawn 重复 forgekin_id 抛错；adopt 登记外部产物', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const svc = ctx.forgeSpecies;
    svc.spawn(ForgekinSpecies.VIRTUAL, commonInit('悟空'));
    expect(() => svc.spawn(ForgekinSpecies.VIRTUAL, commonInit('悟空'))).toThrow('已存在');
    const external = new VirtualForgekin({
      forgekin_id: 'fk-外部',
      name: '外部产物',
      soul_imprint: makeImprint('外部产物'),
    });
    svc.adopt(external);
    expect(svc.get('fk-外部')).toBe(external);
    expect(() => svc.adopt(external)).toThrow('已存在');
  });

  it('snapshot 汇总注册表与实例统计', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const svc = ctx.forgeSpecies;
    svc.spawn(ForgekinSpecies.VIRTUAL, commonInit('悟空'));
    const snap = svc.snapshot();
    expect(snap.instances).toBe(1);
    expect(snap.registered).toBe(0);
    expect(snap.speciesKnown).toContain(ForgekinSpecies.HYBRID);
  });
});
