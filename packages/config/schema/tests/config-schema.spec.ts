/**
 * @flowforge/config-schema 测试 — D28 前端 schema 校验。
 *
 * 覆盖：toEnvSchemaEntry 归一/降级/null；validateEnvSchemaValue 各规则
 * （editable 拒绝/required/allowedValues/boolean 字面量）；masked 哨兵；
 * validateEnvDraft byName/allValid；parseEnvDraft 合法/非法/行号。
 */

import { describe, expect, it } from 'vitest';

import {
  MASKED_VALUE,
  isMaskedSecretUnchanged,
  parseEnvDraft,
  toEnvSchemaEntry,
  validateEnvDraft,
  validateEnvSchemaValue,
  type EnvSchemaEntry,
} from '../src/index.ts';

function entry(overrides: Partial<EnvSchemaEntry> = {}): EnvSchemaEntry {
  return { name: 'FF_TEST', sensitive: false, editable: true, ...overrides };
}

describe('toEnvSchemaEntry', () => {
  it('归一 legacy payload：editable/sensitive(secret)/description 透传', () => {
    const schema = toEnvSchemaEntry({
      name: 'FF_OPENROUTE_KEY',
      value: '***',
      category: 'secret',
      editable: true,
      masked: true,
      description: 'API Key',
    });
    expect(schema).toMatchObject({
      name: 'FF_OPENROUTE_KEY',
      editable: true,
      sensitive: true,
      masked: true,
      category: 'secret',
      description: 'API Key',
    });
  });

  it('allowedValues → valueKind=enum；kind 显式保留', () => {
    expect(toEnvSchemaEntry({ name: 'A', editable: true, sensitive: false, allowedValues: ['on', 'off'] })).toMatchObject({
      allowedValues: ['on', 'off'],
      valueKind: 'enum',
    });
    expect(toEnvSchemaEntry({ name: 'B', editable: true, sensitive: false, kind: 'boolean' })).toMatchObject({
      valueKind: 'boolean',
    });
  });

  it('缺可选字段优雅降级；空名/非对象 → null', () => {
    expect(toEnvSchemaEntry({ name: 'C', editable: true })).toMatchObject({
      sensitive: false,
      editable: true,
    });
    expect(toEnvSchemaEntry({})).toBeNull();
    expect(toEnvSchemaEntry(null)).toBeNull();
    expect(toEnvSchemaEntry('x')).toBeNull();
  });
});

describe('validateEnvSchemaValue', () => {
  it('不可编辑 → 拒绝', () => {
    const result = validateEnvSchemaValue(entry({ editable: false }), 'v');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('不可编辑');
  });

  it('required 空值 → 拒绝；非 required 空值 → 放行', () => {
    expect(validateEnvSchemaValue(entry({ required: true }), '  ').ok).toBe(false);
    expect(validateEnvSchemaValue(entry({ required: false }), '  ').ok).toBe(true);
  });

  it('allowedValues 命中放行 / 未命中拒绝并列出允许值', () => {
    const schema = entry({ allowedValues: ['off', 'shadow', 'on'] });
    expect(validateEnvSchemaValue(schema, 'shadow').ok).toBe(true);
    const bad = validateEnvSchemaValue(schema, 'danger');
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain('off / shadow / on');
  });

  it('boolean 字面量 true/false 放行；其他拒绝', () => {
    const schema = entry({ valueKind: 'boolean' });
    expect(validateEnvSchemaValue(schema, 'true').ok).toBe(true);
    expect(validateEnvSchemaValue(schema, 'false').ok).toBe(true);
    expect(validateEnvSchemaValue(schema, 'yes').ok).toBe(false);
  });

  it('无可选字段 → 仅结构校验，普通值放行', () => {
    expect(validateEnvSchemaValue(entry(), 'anything-here').ok).toBe(true);
  });
});

describe('masked sentinel', () => {
  it('isMaskedSecretUnchanged：仅 masked + *** 为真', () => {
    expect(isMaskedSecretUnchanged(entry({ masked: true }), MASKED_VALUE)).toBe(true);
    expect(isMaskedSecretUnchanged(entry({ masked: true }), 'new-secret')).toBe(false);
    expect(isMaskedSecretUnchanged(entry(), MASKED_VALUE)).toBe(false);
  });

  it('validateEnvSchemaValue：masked 未改放行（不触发可编辑/必填检查）', () => {
    const result = validateEnvSchemaValue(entry({ masked: true, editable: false, required: true }), MASKED_VALUE);
    expect(result.ok).toBe(true);
  });
});

describe('validateEnvDraft', () => {
  it('byName 正确 + allValid；任一非法即 false', () => {
    const entries = [
      entry({ name: 'A', required: true }),
      entry({ name: 'B', allowedValues: ['x', 'y'] }),
    ];
    const result = validateEnvDraft(entries, { A: 'ok', B: 'z' });
    expect(result.byName.A?.ok).toBe(true);
    expect(result.byName.B?.ok).toBe(false);
    expect(result.allValid).toBe(false);
  });

  it('masked 未改不判非法；草稿缺条目跳过', () => {
    const entries = [entry({ name: 'S', masked: true, required: true })];
    const result = validateEnvDraft(entries, { S: MASKED_VALUE });
    expect(result.byName.S?.ok).toBe(true);
    expect(result.allValid).toBe(true);
  });
});

describe('parseEnvDraft', () => {
  it('解析合法行：普通/export/注释/空行/行内注释', () => {
    const result = parseEnvDraft('# header\nFF_A=1\nFF_B = hello # 注释\nexport FF_C=x=y\n\nFF_D="quoted"');
    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      { name: 'FF_A', value: '1' },
      { name: 'FF_B', value: 'hello' },
      { name: 'FF_C', value: 'x=y' },
      { name: 'FF_D', value: '"quoted"' },
    ]);
  });

  it('malformed 行 / 非法变量名 → 行级错误', () => {
    const result = parseEnvDraft('FF_GOOD=1\nno-equals-here\n123_BAD=x');
    expect(result.lines).toEqual([{ name: 'FF_GOOD', value: '1' }]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.line).toBe(2);
    expect(result.errors[0]?.message).toContain('缺少');
    expect(result.errors[1]?.line).toBe(3);
    expect(result.errors[1]?.message).toContain('变量名非法');
  });
});
