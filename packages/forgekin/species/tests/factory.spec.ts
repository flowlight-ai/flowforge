/**
 * factory — 形态构造器工厂注册表契约验证。
 *
 * 覆盖：内置五形态构造 / 自定义形态注册覆盖（插件扩展点）/
 * SPECIES_FACTORY_METADATA 谱系标记。
 *
 * @module @flowforge/forgekin-species/tests
 */

import { describe, expect, it } from 'vitest';
import { forgeSoulImprint } from '@flowforge/forgekin-soul';
import { ForgekinBase } from '../src/base.js';
import {
  DEFAULT_SPECIES_CONSTRUCTORS,
  SPECIES_FACTORY_METADATA,
  SpeciesFactoryRegistry,
} from '../src/factory.js';
import { BioForgekin } from '../src/impl/bio.js';
import { HybridForgekin } from '../src/impl/hybrid.js';
import { ObjForgekin } from '../src/impl/obj.js';
import { OrgForgekin } from '../src/impl/org.js';
import { VirtualForgekin, type VirtualForgekinInit } from '../src/impl/virtual.js';
import { ForgekinSpecies } from '../src/species-enum.js';

function makeImprint(name: string) {
  return forgeSoulImprint({ name }, ['不伤害 operator'], 'flowlight');
}

function commonInit(name: string): Record<string, unknown> {
  return { forgekin_id: `fk-${name}`, name, soul_imprint: makeImprint(name) };
}

describe('内置五形态构造', () => {
  it('create 分发到正确的实现类', () => {
    const registry = new SpeciesFactoryRegistry();
    expect(registry.create(ForgekinSpecies.BIO, commonInit('橘座'))).toBeInstanceOf(BioForgekin);
    expect(registry.create(ForgekinSpecies.ORG, commonInit('参谋部'))).toBeInstanceOf(OrgForgekin);
    expect(registry.create(ForgekinSpecies.OBJ, commonInit('小灯'))).toBeInstanceOf(ObjForgekin);
    expect(registry.create(ForgekinSpecies.VIRTUAL, commonInit('悟空'))).toBeInstanceOf(VirtualForgekin);
  });

  it('hybrid 构造器透传形态专属字段（components）', () => {
    const registry = new SpeciesFactoryRegistry();
    const bio = new BioForgekin({ forgekin_id: 'fk-b', name: '橘座', soul_imprint: makeImprint('橘座') });
    const obj = new ObjForgekin({ forgekin_id: 'fk-o', name: '小灯', soul_imprint: makeImprint('小灯') });
    const hybrid = registry.create(ForgekinSpecies.HYBRID, {
      ...commonInit('智能家居'),
      components: [bio, obj],
    });
    expect(hybrid).toBeInstanceOf(HybridForgekin);
    expect((hybrid as HybridForgekin).components).toHaveLength(2);
  });

  it('DEFAULT_SPECIES_CONSTRUCTORS 覆盖全部五形态', () => {
    expect(Object.keys(DEFAULT_SPECIES_CONSTRUCTORS)).toHaveLength(5);
    for (const species of Object.values(ForgekinSpecies)) {
      if (typeof species === 'string') {
        expect(new SpeciesFactoryRegistry().has(species as ForgekinSpecies)).toBe(true);
      }
    }
  });
});

describe('插件扩展点', () => {
  it('register 覆盖构造器后生效', () => {
    const registry = new SpeciesFactoryRegistry();
    let called = 0;
    registry.register(ForgekinSpecies.VIRTUAL, (init) => {
      called += 1;
      return new VirtualForgekin(init as unknown as VirtualForgekinInit);
    });
    const fk = registry.create(ForgekinSpecies.VIRTUAL, commonInit('悟空'));
    expect(called).toBe(1);
    expect(fk).toBeInstanceOf(ForgekinBase);
  });
});

describe('SPECIES_FACTORY_METADATA 谱系', () => {
  it('模块路径对齐 Python species_impl 包', () => {
    expect(SPECIES_FACTORY_METADATA[ForgekinSpecies.BIO]).toEqual({
      module: 'flowforge.forgemind.species_impl.bio',
      class_name: 'BioForgekin',
    });
    expect(SPECIES_FACTORY_METADATA[ForgekinSpecies.HYBRID].class_name).toBe('HybridForgekin');
  });
});
