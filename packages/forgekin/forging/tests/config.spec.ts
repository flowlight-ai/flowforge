/**
 * config — 配置加载契约验证（对齐 Python _load_yaml）。
 *
 * 覆盖：内置锻造/提示词 YAML 加载 / 文件不存在抛错（配置驱动铁律5+P16）/
 * 关键配置段完整性。
 *
 * @module @flowforge/forgekin-forging/tests
 */

import { describe, expect, it } from 'vitest';
import {
  builtinConfigDir,
  builtinForgingYamlPath,
  builtinPromptsYamlPath,
  loadForgingConfig,
  loadPromptsConfig,
} from '../src/config.js';

describe('内置 YAML 加载', () => {
  it('loadForgingConfig 缺省加载内置配置', () => {
    const config = loadForgingConfig();
    const forging = config['forging'] as Record<string, unknown>;
    expect(forging).toBeTruthy();
    expect(forging['default_species']).toBe('virtual');
    expect(forging['min_quality_score']).toBe(0.85);
    const stages = forging['stages'] as Record<string, unknown>;
    expect(Object.keys(stages)).toHaveLength(6);
    const anchors = forging['value_anchors_default'] as string[];
    expect(anchors.length).toBe(5);
    expect(anchors.join(' ')).toContain('逃生舱');
    const factory = forging['species_factory'] as Record<string, unknown>;
    expect(Object.keys(factory)).toEqual(['bio', 'org', 'obj', 'virtual', 'hybrid']);
  });

  it('loadPromptsConfig 六阶段提示词齐全（含占位符）', () => {
    const config = loadPromptsConfig();
    const prompts = config['forging_prompts'] as Record<string, string>;
    for (const stage of [
      'species_definition',
      'capability_injection',
      'memory_seeding',
      'value_alignment',
      'capability_verification',
      'awakening_promotion',
    ]) {
      expect(typeof prompts[stage]).toBe('string');
      expect((prompts[stage] as string).length).toBeGreaterThan(0);
    }
    expect(prompts['species_definition']).toContain('{requirement}');
    expect(prompts['capability_injection']).toContain('{species}');
  });

  it('路径定位函数指向包内 config/ 目录', () => {
    expect(builtinForgingYamlPath().endsWith('forging.yaml')).toBe(true);
    expect(builtinPromptsYamlPath().endsWith('prompts.yaml')).toBe(true);
    expect(builtinConfigDir().includes('config')).toBe(true);
  });
});

describe('配置驱动（铁律5+P16）', () => {
  it('文件不存在抛错——禁止降级为硬编码', () => {
    expect(() => loadForgingConfig('d:/software/fl/__not_exist__/forging.yaml')).toThrow('配置文件不存在');
    expect(() => loadPromptsConfig('d:/software/fl/__not_exist__/prompts.yaml')).toThrow('配置文件不存在');
  });
});
