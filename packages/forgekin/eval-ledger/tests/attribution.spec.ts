/**
 * attribution — 七类归因矩阵契约验证（对齐 Python Attributor）。
 *
 * 覆盖：关键词匹配归因 / category_hint 加权 / 零匹配兜底 /
 * 置信度公式 / 外置 YAML 模板渲染（铁律 5+P16）。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_CATEGORY_ORDER,
  Attributor,
  AttributionCategory,
  AttributionReport,
  buildDefaultRules,
  loadAttributionTemplates,
} from '../src/attribution.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('默认规则', () => {
  it('七类关键词表齐全且顺序固定', () => {
    const rules = buildDefaultRules();
    expect(ATTRIBUTION_CATEGORY_ORDER).toHaveLength(7);
    for (const cat of ATTRIBUTION_CATEGORY_ORDER) {
      expect(rules[cat]?.length).toBeGreaterThan(5);
    }
  });
});

describe('Attributor.attribute', () => {
  it('关键词匹配定位类别（资源耗尽）', async () => {
    const attributor = new Attributor();
    const report = await attributor.attribute({
      error_message: 'request timeout after quota rate limit exceeded',
    });
    expect(report.category).toBe(AttributionCategory.RESOURCE_EXHAUSTION);
    expect(report.evidence.length).toBeGreaterThanOrEqual(3);
    expect(report.root_cause).toContain('超时');
    expect(report.recommendation).toContain('配额');
  });

  it('协作失败（中文关键词"交接"）', async () => {
    const attributor = new Attributor();
    const report = await attributor.attribute({ error: '交接胶囊丢失，handoff 失败' });
    expect(report.category).toBe(AttributionCategory.COLLABORATION_FAILURE);
    expect(report.evidence).toContain('交接');
  });

  it('category_hint 加权（追加证据）', async () => {
    const attributor = new Attributor();
    // 无关键词命中；hint 加权后归因到 vision_gap（hint 值自带 'vision' 关键词）
    const report = await attributor.attribute({
      error: 'xx yy',
      category_hint: 'vision_gap',
    });
    expect(report.category).toBe(AttributionCategory.VISION_GAP);
    expect(report.evidence).toContain('(category_hint)');
    // 无效 hint 被忽略 → 零匹配兜底
    const report2 = await attributor.attribute({ error: 'zzz qqq', category_hint: 'not_a_category' });
    expect(report2.category).toBe(AttributionCategory.HARNESS_MISALIGNMENT);
    expect(report2.evidence).not.toContain('(category_hint)');
  });

  it('零匹配兜底 HARNESS_MISALIGNMENT + 置信度 0.3', async () => {
    const attributor = new Attributor();
    const report = await attributor.attribute({ error: 'zzz qqq xxx' });
    expect(report.category).toBe(AttributionCategory.HARNESS_MISALIGNMENT);
    expect(report.evidence).toEqual([]);
    expect(report.confidence).toBe(0.3);
  });

  it('置信度 = min(1.0, 0.3 + 0.2 × 证据数)', async () => {
    const attributor = new Attributor();
    const report = await attributor.attribute({
      error_message: 'timeout timed out quota rate limit ratelimit exhausted',
    });
    expect(report.confidence).toBe(1.0);
  });

  it('failure_id 透传 / 缺省自动生成', async () => {
    const attributor = new Attributor();
    const r1 = await attributor.attribute({ failure_id: 'my-fail', error: 'timeout' });
    expect(r1.failure_id).toBe('my-fail');
    const r2 = await attributor.attribute({ error: 'timeout' });
    expect(r2.failure_id.startsWith('fail-')).toBe(true);
  });

  it('嵌套 dict/list 递归展平扫描', async () => {
    const attributor = new Attributor();
    const report = await attributor.attribute({
      trace: [{ steps: ['no data', 'retrieval fail'] }, 'context missing'],
    });
    expect(report.category).toBe(AttributionCategory.DATA_MISSING);
  });
});

describe('外置模板（铁律 5+P16）', () => {
  it('YAML 模板渲染占位符；缺失回退默认文案', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'eval-attr-'));
    tmpDirs.push(tmpDir);
    const yamlPath = path.join(tmpDir, 'prompts.yaml');
    writeFileSync(
      yamlPath,
      [
        'attribution_root_causes:',
        "  resource_exhaustion: '组件 {component_ref} 资源耗尽：{error}'",
        'attribution_recommendations:',
        "  resource_exhaustion: '立即扩容 {failure_id}'",
      ].join('\n'),
      'utf-8',
    );
    const attributor = new Attributor({ promptsPath: yamlPath });
    // 仅提供 error_message，component_ref/failure_id 缺失 → 渲染为 (unknown)
    const report = await attributor.attribute({ error_message: 'timeout' });
    expect(report.category).toBe(AttributionCategory.RESOURCE_EXHAUSTION);
    expect(report.root_cause).toBe('组件 (unknown) 资源耗尽：timeout');
    expect(report.recommendation).toBe('立即扩容 (unknown)');
    // 未提供模板的类别回退默认
    const report2 = await attributor.attribute({ error: 'tool not found no tool' });
    expect(report2.category).toBe(AttributionCategory.TOOL_GAP);
    expect(report2.root_cause).toContain('缺少必要工具');
  });

  it('路径不存在 / null → 空模板（不抛错）', () => {
    expect(loadAttributionTemplates(null)).toEqual({ root_causes: {}, recommendations: {} });
    expect(loadAttributionTemplates('d:/software/fl/__no__/prompts.yaml').root_causes).toEqual({});
  });
});

describe('AttributionReport', () => {
  it('默认 failure_id 前缀 + 时间戳', () => {
    const report = new AttributionReport({
      category: AttributionCategory.VISION_GAP,
      root_cause: 'rc',
      recommendation: 'rec',
    });
    expect(report.failure_id.startsWith('fail-')).toBe(true);
    expect(report.attributed_at).toBeTruthy();
  });
});
