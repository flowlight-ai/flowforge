/**
 * pipeline — ForgePipeline 6 阶段锻造流水线契约验证。
 *
 * 对齐 Python `forgemind/forging/pipeline.py`：forge 全链路 /
 * 默认锚点 / forgekin_id 推导 / contextExtra（forgekin_config + llm_client）/
 * 阶段失败包装 / getStageConfig / getPrompt / forgeFromYaml。
 *
 * @module @flowforge/forgekin-forging/tests
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgeSoulImprint } from '@flowforge/forgekin-soul';
import { ForgekinFormData, ForgekinSpecies, VirtualForgekin } from '@flowforge/forgekin-species';
import { loadForgingConfig } from '../src/config.js';
import { ForgePipeline } from '../src/pipeline.js';
import { ForgingStage } from '../src/forging-stages.js';

const tmpDirs: string[] = [];
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'forge-pipeline-'));
  tmpDirs.push(tmpDir);
});

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

function makeForm(): ForgekinFormData {
  return new ForgekinFormData({
    name: '鲁班',
    species: ForgekinSpecies.VIRTUAL,
    namespace: 'flowlight',
    requirement: '锻造一位机关造物大师',
  });
}

describe('forge 全链路（6 阶段）', () => {
  it('产出 VirtualForgekin：默认 forgekin_id = namespace:name', async () => {
    const pipeline = new ForgePipeline();
    const fk = await pipeline.forge(makeForm());
    expect(fk).toBeInstanceOf(VirtualForgekin);
    expect(fk.forgekinId).toBe('flowlight:鲁班');
    expect(fk.species).toBe(ForgekinSpecies.VIRTUAL);
    expect(fk.capabilityProfile).toEqual({});
  });

  it('六阶段全部通过并记录结果', async () => {
    const pipeline = new ForgePipeline();
    await pipeline.forge(makeForm());
    const results = pipeline.lastStageResults;
    expect(results).toHaveLength(6);
    expect(results.map((r) => r.stage)).toEqual(ForgingStage.ordered());
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results.every((r) => r.duration_seconds >= 0)).toBe(true);
  });

  it('未提供 value_anchors 时使用默认 5 条锚点锻造 SoulImprint', async () => {
    const pipeline = new ForgePipeline();
    const fk = await pipeline.forge(makeForm());
    const expected = forgeSoulImprint(
      fk.soulImprint.seedParams,
      (loadForgingConfig()['forging'] as Record<string, unknown>)['value_anchors_default'] as string[],
      'flowlight',
    );
    expect(fk.soulImprint.imprintHash).toBe(expected.imprintHash);
    expect(fk.soulImprint.valueAnchors).toHaveLength(5);
  });

  it('表单锚点优先于默认清单', async () => {
    const pipeline = new ForgePipeline();
    const form = new ForgekinFormData({
      name: '悟空',
      species: ForgekinSpecies.VIRTUAL,
      namespace: 'journey',
      value_anchors: ['不伤害 operator', '紧箍咒始终有效'],
    });
    const fk = await pipeline.forge(form);
    expect(fk.soulImprint.valueAnchors).toEqual(['不伤害 operator', '紧箍咒始终有效']);
  });

  it('能力注入：表单 capability_profile 复制到实例', async () => {
    const pipeline = new ForgePipeline();
    const form = new ForgekinFormData({
      name: '鲁班',
      species: ForgekinSpecies.VIRTUAL,
      namespace: 'flowlight',
      capability_profile: { native_abilities: ['木工'], blind_spots: ['即兴创作'] },
    });
    const fk = await pipeline.forge(form);
    expect(fk.capabilityProfile['native_abilities']).toEqual(['木工']);
  });
});

describe('contextExtra（forgekin_config + llm_client）', () => {
  it('forgekin_config.forgekin_id 覆盖默认 ID；完整配置注入实例', async () => {
    const pipeline = new ForgePipeline();
    const config = { forgekin_id: 'fk-luban', role: { description: '机关造物大师' } };
    const fk = await pipeline.forge(makeForm(), { forgekin_config: config });
    expect(fk.forgekinId).toBe('fk-luban');
    expect(fk.getForgekinConfig()['role']).toEqual({ description: '机关造物大师' });
  });

  it('llm_client 注入后 chat 不再降级', async () => {
    const pipeline = new ForgePipeline();
    const client = { chat: async () => ({ content: '桥接回答' }) };
    const fk = await pipeline.forge(makeForm(), { llm_client: client });
    const result = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(result['content']).toBe('桥接回答');
  });

  it('非法 llm_client（无 chat 方法）被忽略 → 降级', async () => {
    const pipeline = new ForgePipeline();
    const fk = await pipeline.forge(makeForm(), { llm_client: { notChat: true } });
    const result = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(String(result['content'])).toContain('降级响应');
  });
});

describe('阶段失败处理', () => {
  it('价值观对齐失败 → 抛错含阶段值与中文名', async () => {
    // 配置缺少 value_anchors_default 且表单无锚点 → SoulImprint 校验抛错
    const pipeline = new ForgePipeline({ forgingConfig: { forging: { min_quality_score: 0.85 } } });
    await expect(pipeline.forge(makeForm())).rejects.toThrow('value_alignment（价值观对齐）失败');
    const last = pipeline.lastStageResults[pipeline.lastStageResults.length - 1];
    expect(last?.passed).toBe(false);
    expect(last?.error).toContain('value_anchors 不能为空');
  });
});

describe('getStageConfig / getPrompt', () => {
  it('阶段配置来自 forging.yaml（timeout / retry / min_quality_score）', () => {
    const pipeline = new ForgePipeline();
    const verify = pipeline.getStageConfig(ForgingStage.CAPABILITY_VERIFICATION);
    expect(verify['timeout_seconds']).toBe(120);
    expect(verify['min_quality_score']).toBe(0.85);
    expect((verify['retry'] as Record<string, unknown>)['max_attempts']).toBe(2);
    expect(pipeline.getStageConfig('nope' as ForgingStage)).toEqual({});
  });

  it('提示词六段齐全；缺失阶段抛错提示补全', () => {
    const pipeline = new ForgePipeline();
    expect(pipeline.getPrompt(ForgingStage.SPECIES_DEFINITION)).toContain('锻造师');
    const stripped = new ForgePipeline({ promptsConfig: { forging_prompts: {} } });
    expect(() => stripped.getPrompt(ForgingStage.MEMORY_SEEDING)).toThrow('无对应提示词');
  });

  it('STAGES 静态属性对齐六阶段顺序', () => {
    expect(ForgePipeline.STAGES).toEqual(ForgingStage.ordered());
  });
});

describe('forgeFromYaml（配置驱动锻造）', () => {
  it('文件不存在抛错', async () => {
    const pipeline = new ForgePipeline();
    await expect(pipeline.forgeFromYaml(path.join(tmpDir, 'missing.yaml'))).rejects.toThrow('YAML 配置不存在');
  });

  it('缺失必填字段抛错（提示参考 luban.yaml）', async () => {
    const yamlPath = path.join(tmpDir, 'bad.yaml');
    writeFileSync(yamlPath, 'name: 残缺\nspecies: virtual\n', 'utf-8');
    const pipeline = new ForgePipeline();
    await expect(pipeline.forgeFromYaml(yamlPath)).rejects.toThrow("必填字段 'namespace'");
  });

  it('完整 YAML → 锻造 VirtualForgekin 并注入配置与 LLM 客户端', async () => {
    const yamlPath = path.join(tmpDir, 'luban.yaml');
    writeFileSync(
      yamlPath,
      [
        'name: 鲁班',
        'species: virtual',
        'namespace: flowlight',
        'breed: 机关师',
        'breed_en: Mechanist',
        'evolution_stage: E1',
        'awakening_stage: E1',
        'operator_id: op-sherlock',
        'role:',
        '  description: 机关造物大师',
        'value_anchors:',
        '  - 不伤害 operator',
        'capability_profile:',
        '  native_abilities:',
        '    - 木工',
      ].join('\n'),
      'utf-8',
    );
    const pipeline = new ForgePipeline();
    const client = { chat: async () => ({ content: '鲁班的回答' }) };
    const fk = await pipeline.forgeFromYaml(yamlPath, { llmClient: client });

    expect(fk).toBeInstanceOf(VirtualForgekin);
    expect(fk.name).toBe('鲁班');
    // forgekin_id 缺省推导：namespace:name（YAML 未提供 forgekin_id）
    expect(fk.forgekinId).toBe('flowlight:鲁班');
    // 完整 YAML 注入 forgekin_config
    expect((fk.getForgekinConfig()['role'] as Record<string, unknown>)['description']).toBe('机关造物大师');
    // seed_params（breed/breed_en）进入 SoulImprint 种子
    expect(fk.soulImprint.seedParams['breed']).toBe('机关师');
    expect(fk.soulImprint.seedParams['operator_id']).toBe('op-sherlock');
    // llm_client 已注入
    const chat = await fk.chat([{ role: 'user', content: '你好' }]);
    expect(chat['content']).toBe('鲁班的回答');
  });
});
