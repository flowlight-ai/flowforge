/**
 * species-enum — ForgekinSpecies 五大形态枚举契约验证。
 *
 * 覆盖：枚举值 / fromString（大小写不敏感 + trim + 未知值抛错）/
 * chineseName / className。
 *
 * @module @flowforge/forgekin-species/tests
 */

import { describe, expect, it } from 'vitest';
import { ForgekinSpecies } from '../src/species-enum.js';

describe('ForgekinSpecies 枚举值', () => {
  it('五形态值对齐 naming-contract.md#2.3', () => {
    expect(ForgekinSpecies.BIO).toBe('bio');
    expect(ForgekinSpecies.ORG).toBe('org');
    expect(ForgekinSpecies.OBJ).toBe('obj');
    expect(ForgekinSpecies.VIRTUAL).toBe('virtual');
    expect(ForgekinSpecies.HYBRID).toBe('hybrid');
  });
});

describe('fromString', () => {
  it('大小写不敏感 + trim', () => {
    expect(ForgekinSpecies.fromString('BIO')).toBe(ForgekinSpecies.BIO);
    expect(ForgekinSpecies.fromString('  Virtual ')).toBe(ForgekinSpecies.VIRTUAL);
    expect(ForgekinSpecies.fromString('hybrid')).toBe(ForgekinSpecies.HYBRID);
  });

  it('未知值抛错且提示合法值清单', () => {
    expect(() => ForgekinSpecies.fromString('robot')).toThrow('未知的ForgekinSpecies形态');
    expect(() => ForgekinSpecies.fromString('')).toThrow('未知的ForgekinSpecies形态');
  });
});

describe('chineseName / className', () => {
  it('五形态中文名', () => {
    expect(ForgekinSpecies.chineseName(ForgekinSpecies.BIO)).toBe('生物Forgekin');
    expect(ForgekinSpecies.chineseName(ForgekinSpecies.ORG)).toBe('组织Forgekin');
    expect(ForgekinSpecies.chineseName(ForgekinSpecies.OBJ)).toBe('物品Forgekin');
    expect(ForgekinSpecies.chineseName(ForgekinSpecies.VIRTUAL)).toBe('虚拟Forgekin');
    expect(ForgekinSpecies.chineseName(ForgekinSpecies.HYBRID)).toBe('混合Forgekin');
  });

  it('实现类名用于 species_factory 兜底推导', () => {
    expect(ForgekinSpecies.className(ForgekinSpecies.BIO)).toBe('BioForgekin');
    expect(ForgekinSpecies.className(ForgekinSpecies.HYBRID)).toBe('HybridForgekin');
  });
});
