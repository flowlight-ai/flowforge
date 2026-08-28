/**
 * models — F036 数据模型契约验证
 *
 * 覆盖：ForgeLayer 校验（角色/垂直层空壳/通用层回炉终点）、
 * computeCapabilityDelta 差异计算（新增键/数组差集/相等忽略）。
 *
 * @module @flowforge/forgekin-relationship/tests
 */

import { describe, expect, it } from 'vitest';
import { computeCapabilityDelta, validateLayer } from '../src/models.js';

describe('validateLayer 承载层校验', () => {
  it('合法通用层通过（forgemind 固定层）', () => {
    expect(() =>
      validateLayer({ layer_id: 'forgemind', role: 'general', vertical_skills: [], can_evolve_to: [] }),
    ).not.toThrow();
  });

  it('合法垂直层通过（vertical_skills + can_reclaim_to）', () => {
    expect(() =>
      validateLayer({
        layer_id: 'contentforge',
        role: 'vertical',
        vertical_skills: ['article_writing'],
        can_evolve_to: [],
        can_reclaim_to: 'forgemind',
      }),
    ).not.toThrow();
  });

  it('layer_id 为空抛错', () => {
    expect(() =>
      validateLayer({ layer_id: '  ', role: 'general', vertical_skills: [], can_evolve_to: [] }),
    ).toThrow(/layer_id 不能为空/);
  });

  it('非法 role 抛错', () => {
    expect(() =>
      validateLayer({ layer_id: 'x', role: 'sideways' as 'general', vertical_skills: [], can_evolve_to: [] }),
    ).toThrow(/role 必须是 general\|vertical/);
  });

  it('垂直层无技能且无可回炉目标抛错（空壳）', () => {
    expect(() =>
      validateLayer({ layer_id: 'emptyforge', role: 'vertical', vertical_skills: [], can_evolve_to: [] }),
    ).toThrow(/垂直承载层/);
  });

  it('通用层声明 can_reclaim_to 抛错（通用层是回炉终点）', () => {
    expect(() =>
      validateLayer({
        layer_id: 'forgemind',
        role: 'general',
        vertical_skills: [],
        can_evolve_to: [],
        can_reclaim_to: 'x',
      }),
    ).toThrow(/不能声明 can_reclaim_to/);
  });
});

describe('computeCapabilityDelta 能力差异', () => {
  it('新增键整体进入差异', () => {
    const delta = computeCapabilityDelta({ writing: 0.8 }, { writing: 0.8, research: 0.6 });
    expect(delta['research']).toBe(0.6);
  });

  it('数组差集：垂直技能只记新增项', () => {
    const delta = computeCapabilityDelta(
      { vertical_skills: ['writing', 'editing'] },
      { vertical_skills: ['writing', 'editing', 'reporting'] },
    );
    expect(delta['vertical_skills']).toEqual(['reporting']);
  });

  it('相同值不产生差异', () => {
    const delta = computeCapabilityDelta({ writing: 0.8 }, { writing: 0.8 });
    expect(Object.keys(delta)).toHaveLength(0);
  });
});
