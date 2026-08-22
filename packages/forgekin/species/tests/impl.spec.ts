/**
 * impl — 五形态现实闭环（observe/act/verify）契约验证。
 *
 * 对齐 Python `species_impl/{bio,org,obj,virtual,hybrid}.py`：
 * - bio/org 默认降级为建议（executed: false）
 * - obj 功能边界 + 可逆性检查
 * - virtual 世界观 + 角色一致性检查
 * - hybrid 组件校验 + 分发动作 + 全员验证
 *
 * @module @flowforge/forgekin-species/tests
 */

import { describe, expect, it } from 'vitest';
import { forgeSoulImprint } from '@flowforge/forgekin-soul';
import { BioForgekin } from '../src/impl/bio.js';
import { HybridForgekin } from '../src/impl/hybrid.js';
import { ObjForgekin } from '../src/impl/obj.js';
import { OrgForgekin } from '../src/impl/org.js';
import { VirtualForgekin } from '../src/impl/virtual.js';
import { ForgekinSpecies } from '../src/species-enum.js';

function makeImprint(name: string) {
  return forgeSoulImprint({ name }, ['不伤害 operator'], 'flowlight');
}

describe('BioForgekin', () => {
  it('observe 消费 sensor_readings；channels_active 取交集', async () => {
    const bio = new BioForgekin({
      forgekin_id: 'fk-bio',
      name: '橘座',
      soul_imprint: makeImprint('橘座'),
      biological_subject: 'cat:bengal:orange',
      sensor_channels: ['camera', 'wearable'],
    });
    const obs = await bio.observe({
      sensor_readings: {
        subject_state: 'sleeping',
        channels: ['camera', 'microphone'],
        health_signals: { heart_rate: 120 },
      },
    });
    expect(obs['subject_state']).toBe('sleeping');
    expect(obs['channels_active']).toEqual(['camera']);
    expect(bio.lifecycle_state).toBe('observing');
  });

  it('act 默认降级为建议（E1/E2 不直接执行）→ verify 不通过', async () => {
    const bio = new BioForgekin({ forgekin_id: 'fk-bio', name: '橘座', soul_imprint: makeImprint('橘座') });
    const result = await bio.act({ action_type: 'feed', params: { amount: '50g' } });
    expect(result['executed']).toBe(false);
    expect(await bio.verify(result)).toBe(false);
  });

  it('verify：value_anchors 被违反时必失败', async () => {
    const bio = new BioForgekin({ forgekin_id: 'fk-bio', name: '橘座', soul_imprint: makeImprint('橘座') });
    const ok = await bio.verify({
      executed: true,
      safety_check: { biological_safety: 'passed', value_anchors_respected: false },
    });
    expect(ok).toBe(false);
  });
});

describe('OrgForgekin', () => {
  it('observe 消费 business_signals', async () => {
    const org = new OrgForgekin({
      forgekin_id: 'fk-org',
      name: '参谋部',
      soul_imprint: makeImprint('参谋部'),
      business_systems: ['erp', 'im:feishu'],
    });
    const obs = await org.observe({
      business_signals: { business_metrics: { revenue: 100 }, systems: ['erp'] },
    });
    expect(obs['systems_queried']).toEqual(['erp']);
    expect((obs['business_metrics'] as Record<string, unknown>)['revenue']).toBe(100);
  });

  it('act 降级为建议；合规检查完整时手动置 executed 可通过', async () => {
    const org = new OrgForgekin({ forgekin_id: 'fk-org', name: '参谋部', soul_imprint: makeImprint('参谋部') });
    const result = await org.act({ action_type: 'decision_advice' });
    expect(result['executed']).toBe(false);
    const approved = { ...result, executed: true };
    expect(await org.verify(approved)).toBe(true);
  });
});

describe('ObjForgekin', () => {
  const obj = () =>
    new ObjForgekin({
      forgekin_id: 'fk-obj',
      name: '小灯',
      soul_imprint: makeImprint('小灯'),
      device_id: 'lamp-01',
      iot_protocol: 'zigbee',
      function_boundary: ['switch', 'dim'],
    });

  it('observe 消费 iot_readings', async () => {
    const obs = await obj().observe({
      iot_readings: { device_state: 'on', sensors: { lux: 300 }, wear_status: 'good' },
    });
    expect(obs['device_state']).toBe('on');
    expect(obs['wear_status']).toBe('good');
  });

  it('act：边界内且可逆才执行', async () => {
    const inBoundary = await obj().act({ function: 'switch', params: { on: true } });
    expect(inBoundary['executed']).toBe(true);
    expect(await obj().verify(inBoundary)).toBe(true);

    const outOfBoundary = await obj().act({ function: 'heat' });
    expect(outOfBoundary['executed']).toBe(false);
    expect(outOfBoundary['device_response']).toBe('rejected_out_of_boundary');
    expect(await obj().verify(outOfBoundary)).toBe(false);

    const irreversible = await obj().act({ function: 'dim', reversible: false });
    expect(irreversible['executed']).toBe(false);
  });
});

describe('VirtualForgekin', () => {
  it('act：世界观不一致拒绝执行', async () => {
    const vk = new VirtualForgekin({
      forgekin_id: 'fk-vk',
      name: '悟空',
      soul_imprint: makeImprint('悟空'),
      worldview: '西游记神话体系',
    });
    const aligned = await vk.act({ behavior_type: 'speak' });
    expect(aligned['executed']).toBe(true);
    const misaligned = await vk.act({ behavior_type: 'speak', worldview_alignment: false });
    expect(misaligned['executed']).toBe(false);
    expect(await vk.verify(misaligned)).toBe(false);
  });

  it('act：能力边界外角色行为判 out_of_character', async () => {
    const vk = new VirtualForgekin({
      forgekin_id: 'fk-vk',
      name: '悟空',
      soul_imprint: makeImprint('悟空'),
      character_setting: { ability_boundary: ['七十二变', '筋斗云'] },
    });
    const out = await vk.act({ behavior_type: 'cast', params: { required_ability: '念经' } });
    expect(out['character_response']).toBe('out_of_character');
    expect(out['executed']).toBe(false);
  });
});

describe('HybridForgekin', () => {
  const bio = new BioForgekin({ forgekin_id: 'fk-bio', name: '橘座', soul_imprint: makeImprint('橘座') });
  const obj = new ObjForgekin({
    forgekin_id: 'fk-obj',
    name: '小灯',
    soul_imprint: makeImprint('小灯'),
    function_boundary: ['switch'],
  });

  it('组件校验：<2 / 同 species / 嵌套 hybrid 抛错', () => {
    const imprint = makeImprint('融合体');
    expect(
      () => new HybridForgekin({ forgekin_id: 'fk-h', name: '融合体', soul_imprint: imprint, components: [bio] }),
    ).toThrow('至少需要 2 个');
    const bio2 = new BioForgekin({ forgekin_id: 'fk-bio2', name: '黑猫', soul_imprint: makeImprint('黑猫') });
    expect(
      () => new HybridForgekin({ forgekin_id: 'fk-h', name: '融合体', soul_imprint: imprint, components: [bio, bio2] }),
    ).toThrow('至少 2 种不同 species');
    const inner = new HybridForgekin({ forgekin_id: 'fk-h0', name: '内层', soul_imprint: imprint, components: [bio, obj] });
    expect(
      () => new HybridForgekin({ forgekin_id: 'fk-h', name: '融合体', soul_imprint: imprint, components: [inner, obj] }),
    ).toThrow('嵌套');
  });

  it('observe 融合所有子观察；act 按 component_actions 分发', async () => {
    const hybrid = new HybridForgekin({
      forgekin_id: 'fk-h',
      name: '智能家居',
      soul_imprint: makeImprint('智能家居'),
      components: [bio, obj],
    });
    const obs = await hybrid.observe({});
    expect((obs['component_observations'] as unknown[]).length).toBe(2);
    expect(obs['species_coverage']).toEqual([ForgekinSpecies.BIO, ForgekinSpecies.OBJ]);

    const act = await hybrid.act({
      component_actions: {
        'fk-obj': { function: 'switch' },
      },
    });
    const results = act['component_results'] as Array<Record<string, unknown>>;
    // 无分发的组件被跳过
    expect(results).toHaveLength(1);
    expect(results[0]?.['component_id']).toBe('fk-obj');
    expect(act['executed']).toBe(true);
    expect(await hybrid.verify(act)).toBe(true);
  });

  it('verify：任一子验证失败则整体失败；空结果失败', async () => {
    const hybrid = new HybridForgekin({
      forgekin_id: 'fk-h',
      name: '智能家居',
      soul_imprint: makeImprint('智能家居'),
      components: [bio, obj],
    });
    expect(await hybrid.verify({ coordination_check: { value_anchors_respected: true }, component_results: [] })).toBe(false);
    const failed = await hybrid.verify({
      coordination_check: { value_anchors_respected: true },
      component_results: [
        { component_id: 'fk-obj', result: { executed: false, safety_check: { value_anchors_respected: true, within_boundary: true } } },
      ],
    });
    expect(failed).toBe(false);
  });
});
