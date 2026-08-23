/**
 * registry — ForgekinRegistry 注册表契约验证（对齐 Python registry.py）。
 *
 * 覆盖：register/unregister/get / findByName/findByType/findByCapability /
 * listActive / selectOwner 启发式（匹配数 → 最小熟练度 → 注册序）。
 *
 * @module @flowforge/forgekin-species/tests
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Forgekin, ForgekinError, ForgekinType, makeCapability } from '../src/models.js';
import { ForgekinRegistry, getRegistry, setRegistry } from '../src/registry.js';

function makeFk(name: string, caps: Array<[string, number]> = []): Forgekin {
  const fk = new Forgekin({ name, forgekinType: ForgekinType.CODE_AGENT });
  for (const [capName, prof] of caps) {
    fk.addCapability(makeCapability(capName, prof));
  }
  return fk;
}

let registry: ForgekinRegistry;

beforeEach(() => {
  registry = new ForgekinRegistry();
});

describe('注册 / 注销 / 查询', () => {
  it('重复注册抛错', () => {
    const fk = makeFk('鲁班');
    registry.register(fk);
    expect(() => registry.register(fk)).toThrow(ForgekinError);
  });

  it('get 不存在抛错；存在返回实例', () => {
    const fk = makeFk('鲁班');
    expect(() => registry.get(fk.forgekinId)).toThrow(ForgekinError);
    registry.register(fk);
    expect(registry.get(fk.forgekinId)).toBe(fk);
  });

  it('unregister 不存在抛错；存在移除并返回', () => {
    const fk = makeFk('鲁班');
    expect(() => registry.unregister('nope')).toThrow(ForgekinError);
    registry.register(fk);
    expect(registry.unregister(fk.forgekinId)).toBe(fk);
    expect(registry.count()).toBe(0);
  });

  it('findByName / findByType / findByCapability', () => {
    const a = makeFk('鲁班', [['coding', 0.9]]);
    const b = makeFk('鲁班', [['design', 0.8]]);
    registry.register(a);
    registry.register(b);
    expect(registry.findByName('鲁班')).toHaveLength(2);
    expect(registry.findByType(ForgekinType.CODE_AGENT)).toHaveLength(2);
    expect(registry.findByCapability('coding')).toEqual([a]);
    expect(registry.findByCapability('coding', 0.95)).toEqual([]);
  });

  it('listActive 只含 energy > 0', () => {
    const a = makeFk('活跃');
    const b = makeFk('耗尽');
    b.spendEnergy(1.0);
    registry.register(a);
    registry.register(b);
    expect(registry.listActive()).toEqual([a]);
    expect(registry.listAll()).toHaveLength(2);
  });
});

describe('selectOwner 启发式', () => {
  it('最多匹配能力者优先', () => {
    const one = makeFk('单能力', [['coding', 0.9]]);
    const both = makeFk('双能力', [['coding', 0.7], ['design', 0.7]]);
    registry.register(one);
    registry.register(both);
    expect(registry.selectOwner(['coding', 'design'])?.name).toBe('双能力');
  });

  it('匹配数相同时最小熟练度高者优先', () => {
    const lowMin = makeFk('低短板', [['coding', 0.95], ['design', 0.55]]);
    const highMin = makeFk('均衡', [['coding', 0.8], ['design', 0.8]]);
    registry.register(lowMin);
    registry.register(highMin);
    expect(registry.selectOwner(['coding', 'design'])?.name).toBe('均衡');
  });

  it('完全并列时最早注册优先（确定性）', () => {
    const first = makeFk('先到', [['coding', 0.8]]);
    const second = makeFk('后到', [['coding', 0.8]]);
    registry.register(first);
    registry.register(second);
    expect(registry.selectOwner(['coding'])).toBe(first);
  });

  it('排除列表与耗尽能量不参与', () => {
    const a = makeFk('首选', [['coding', 0.9]]);
    const b = makeFk('替补', [['coding', 0.6]]);
    registry.register(a);
    registry.register(b);
    expect(registry.selectOwner(['coding'], [a.forgekinId])).toBe(b);
    b.spendEnergy(1.0);
    expect(registry.selectOwner(['coding'], [a.forgekinId])).toBeNull();
  });

  it('无候选返回 null', () => {
    expect(registry.selectOwner(['coding'])).toBeNull();
    registry.register(makeFk('无关', [['design', 0.9]]));
    expect(registry.selectOwner(['coding'])).toBeNull();
  });

  it('要求能力为空时允许任意活跃候选', () => {
    registry.register(makeFk('任意'));
    expect(registry.selectOwner([])?.name).toBe('任意');
  });
});

describe('默认注册表（进程级可替换）', () => {
  it('getRegistry 懒创建单例；setRegistry(null) 重置', () => {
    const a = getRegistry();
    expect(getRegistry()).toBe(a);
    const custom = new ForgekinRegistry();
    setRegistry(custom);
    expect(getRegistry()).toBe(custom);
    setRegistry(null);
    expect(getRegistry()).not.toBe(custom);
  });
});
