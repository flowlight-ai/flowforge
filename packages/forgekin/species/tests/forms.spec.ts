/**
 * forms — ForgekinFormData 锻造表单契约验证（对齐 Python forms.py）。
 *
 * 覆盖：必填校验 / value_anchors 去重 / 默认阶 / toImprintSeed 展开优先。
 *
 * @module @flowforge/forgekin-species/tests
 */

import { describe, expect, it } from 'vitest';
import { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinFormData } from '../src/forms.js';
import { ForgekinSpecies } from '../src/species-enum.js';

describe('构造校验', () => {
  it('name / namespace 空白抛错', () => {
    expect(
      () => new ForgekinFormData({ name: '', species: ForgekinSpecies.VIRTUAL, namespace: 'ns' }),
    ).toThrow('name');
    expect(
      () => new ForgekinFormData({ name: '鲁班', species: ForgekinSpecies.VIRTUAL, namespace: '  ' }),
    ).toThrow('namespace');
  });

  it('value_anchors 重复抛错', () => {
    expect(
      () =>
        new ForgekinFormData({
          name: '鲁班',
          species: ForgekinSpecies.VIRTUAL,
          namespace: 'ns',
          value_anchors: ['不伤害 operator', '不伤害 operator'],
        }),
    ).toThrow('重复');
  });

  it('默认阶：E1 萌芽 + E1 全导', () => {
    const form = new ForgekinFormData({
      name: '鲁班',
      species: ForgekinSpecies.VIRTUAL,
      namespace: 'ns',
    });
    expect(form.evolutionStage).toBe(EvolutionStage.E1);
    expect(form.awakeningStage).toBe(AwakeningStage.E1);
    expect(form.requirement).toBe('');
    expect(form.operatorId).toBeNull();
    expect(form.capabilityProfile).toEqual({});
  });
});

describe('toImprintSeed', () => {
  it('核心字段为基础，seed_params 展开优先（同名覆盖）', () => {
    const form = new ForgekinFormData({
      name: '鲁班',
      species: ForgekinSpecies.OBJ,
      namespace: 'flowlight',
      operator_id: 'op-1',
      seed_params: { breed: '机关师', namespace: 'override-ns' },
    });
    const seed = form.toImprintSeed();
    expect(seed['name']).toBe('鲁班');
    expect(seed['species']).toBe('obj');
    expect(seed['operator_id']).toBe('op-1');
    expect(seed['breed']).toBe('机关师');
    // seed_params 同名键覆盖表单字段
    expect(seed['namespace']).toBe('override-ns');
  });

  it('seedParams 副本隔离（构造后修改不影响表单）', () => {
    const params: Record<string, unknown> = { breed: '机关师' };
    const form = new ForgekinFormData({
      name: '鲁班',
      species: ForgekinSpecies.OBJ,
      namespace: 'ns',
      seed_params: params,
    });
    params['breed'] = 'mutated';
    expect(form.seedParams['breed']).toBe('机关师');
  });
});
