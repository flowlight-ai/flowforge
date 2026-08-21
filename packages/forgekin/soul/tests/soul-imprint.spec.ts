/**
 * SoulImprint — T7.1 灵魂印记契约验证。
 *
 * 覆盖（对齐 Python `forgemind/soul_imprint.py` 语义）：
 * - stableJson 键排序 + 紧凑分隔符（哈希稳定性）
 * - computeSoulHash：SHA-256 64 位 hex，payload 含 seed_params/value_anchors/namespace
 * - forgeSoulImprint：不可变身份（frozen）+ 输入校验
 * - verifySoulImprint：篡改检测
 *
 * @module @flowforge/forgekin-soul/tests
 */

import { describe, expect, it } from 'vitest';
import {
  computeSoulHash,
  forgeSoulImprint,
  stableJson,
  validateSoulImprintInput,
  verifySoulImprint,
  SoulImprint,
} from '../src/soul-imprint.js';

describe('stableJson', () => {
  it('键排序 + 紧凑分隔符：同内容不同键序输出一致', () => {
    const a = stableJson({ b: 1, a: { d: 2, c: 3 } });
    const b = stableJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toContain('{');
    expect(a).not.toContain(' ');
  });

  it('数组元素序保留（顺序敏感）', () => {
    expect(stableJson({ arr: [1, 2] })).not.toBe(stableJson({ arr: [2, 1] }));
  });
});

describe('computeSoulHash', () => {
  it('SHA-256 64 位 hex，稳定幂等', () => {
    const seedParams = { species: 'coder' };
    const h1 = computeSoulHash(seedParams, ['a'], 'ns');
    const h2 = computeSoulHash(seedParams, ['a'], 'ns');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it('内容变化 → 哈希变化', () => {
    const seedParams = { species: 'coder' };
    expect(computeSoulHash(seedParams, ['a'], 'ns')).not.toBe(computeSoulHash(seedParams, ['b'], 'ns'));
  });
});

describe('validateSoulImprintInput', () => {
  it('namespace 非空 + value_anchors 非空', () => {
    expect(() => validateSoulImprintInput('', ['a'])).toThrow();
    expect(() => validateSoulImprintInput('ns', [])).toThrow();
    expect(() => validateSoulImprintInput('ns', ['a'])).not.toThrow();
  });
});

describe('forgeSoulImprint / verifySoulImprint', () => {
  it('锻造：自动哈希 + 冻结不可变', () => {
    const imprint = forgeSoulImprint(
      { species: 'coder', stages: ['awakening'] },
      ['value-anchor-1'],
      'forgemind',
    );
    expect(imprint.imprintHash).toMatch(/^[0-9a-f]{64}$/);
    expect(imprint.namespace).toBe('forgemind');
    expect(imprint.valueAnchors).toEqual(['value-anchor-1']);
    expect(Object.isFrozen(imprint)).toBe(true);
  });

  it('verify：未篡改通过，篡改失败', () => {
    const imprint = forgeSoulImprint({ species: 'coder' }, ['a'], 'ns');
    expect(verifySoulImprint(imprint)).toBe(true);
    const tampered: SoulImprint = { ...imprint, seedParams: { species: 'writer' } };
    expect(verifySoulImprint(tampered)).toBe(false);
  });

  it('不同 namespace → 哈希不同（命名空间隔离）', () => {
    const a = forgeSoulImprint({ species: 'coder' }, ['a'], 'ns1');
    const b = forgeSoulImprint({ species: 'coder' }, ['a'], 'ns2');
    expect(a.imprintHash).not.toBe(b.imprintHash);
  });
});
