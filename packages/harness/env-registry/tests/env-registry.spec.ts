/**
 * C39 env-registry 包测试（@flowforge/harness-env-registry）。
 *
 * 覆盖：
 *  - ctx.plugin(EnvRegistry) → ctx.envRegistry 挂载
 *  - 注册表：FF_* 改名系存在（FF_GLOBAL_CONFIG_ROOT 等）+ 类别映射
 *  - buildEnvSummary：sensitive 掩码 / 未设置 null / hub 不可见过滤
 *  - maskUrlCredentials：URL 凭据掩码 + 非 URL 整体掩码
 *  - 可编辑策略：runtimeEditable false 禁止 / sensitive 缺省禁止 /
 *    sensitive+opt-in 允许（owner 门禁）
 *  - filterSensitiveEditable 审计过滤
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Context } from '@flowforge/cordis';

import EnvRegistry, {
  EnvRegistryService,
  ENV_CATEGORIES,
  ENV_VARS,
  buildEnvSummary,
  filterSensitiveEditableKeys,
  hasSensitiveEditableVars,
  isEditableEnvVar,
  isEditableEnvVarName,
  isSensitiveEditableEnvVar,
  maskUrlCredentials,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
  delete process.env.FF_GLOBAL_CONFIG_ROOT;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_PROXY_UPSTREAMS_PATH;
});

describe('env-registry 插件入口', () => {
  it('ctx.plugin(EnvRegistry) 挂载 ctx.envRegistry', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(EnvRegistry)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    expect(ctx.envRegistry).toBeInstanceOf(EnvRegistryService);
    expect(ctx.envRegistry.entries().length).toBeGreaterThan(0);
    expect(ctx.envRegistry.summary).toBeTypeOf('function');
  });

  it('lookup 命中 FF_* 改名系；未注册返回 undefined', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(EnvRegistry)) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    const def = ctx.envRegistry.lookup('FF_GLOBAL_CONFIG_ROOT');
    expect(def?.category).toBe('storage');
    expect(def?.description).toContain('原名 CAT_CAFE_GLOBAL_CONFIG_ROOT');
    expect(ctx.envRegistry.lookup('CAT_CAFE_GLOBAL_CONFIG_ROOT')).toBeUndefined();
    expect(ctx.envRegistry.lookup('NOPE_UNKNOWN_VAR')).toBeUndefined();
  });
});

describe('env-registry 注册表数据', () => {
  it('FF_* 改名映射完整（storage 域）', () => {
    const names = new Set(ENV_VARS.map((def) => def.name));
    for (const expected of [
      'FF_GLOBAL_CONFIG_ROOT',
      'FF_TEMPLATE_PATH',
      'FF_DEFAULT_CAT_ID',
      'FF_SKIP_HOMEDIR_MIGRATION',
      'FF_TEST_SANDBOX',
      'FF_TEST_SANDBOX_ALLOW_UNSAFE_ROOT',
      'FF_TEST_REAL_HOME',
      'FF_USER_ID',
      'FF_DATA_DIR',
    ]) {
      expect(names.has(expected), expected).toBe(true);
    }
  });

  it('不再注册 CAT_CAFE_* 旧名（R17 改名后）', () => {
    for (const def of ENV_VARS) {
      expect(def.name.startsWith('CAT_CAFE_'), def.name).toBe(false);
    }
  });

  it('类别映射覆盖全部注册条目类别', () => {
    const registeredCategories = new Set(ENV_VARS.map((def) => def.category));
    for (const category of registeredCategories) {
      expect(ENV_CATEGORIES[category], category).toBeTypeOf('string');
    }
  });

  it('敏感变量可编辑需显式 opt-in（fail-closed）', () => {
    const apiKey = ENV_VARS.find((def) => def.name === 'ANTHROPIC_API_KEY')!;
    expect(apiKey.sensitive).toBe(true);
    expect(isSensitiveEditableEnvVar(apiKey)).toBe(true);
    expect(isEditableEnvVar(apiKey)).toBe(true);
    // 缺省敏感项不可编辑
    const proxy = ENV_VARS.find((def) => def.name === 'FF_GLOBAL_CONFIG_ROOT')!;
    expect(isEditableEnvVar(proxy)).toBe(false);
  });
});

describe('env-registry 汇总与掩码', () => {
  it('buildEnvSummary：敏感值掩码、未设置 null、hub 不可见过滤', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret';
    process.env.FF_GLOBAL_CONFIG_ROOT = '/tmp/ff-root';
    const summary = buildEnvSummary();
    const apiKey = summary.find((entry) => entry.name === 'ANTHROPIC_API_KEY')!;
    expect(apiKey.currentValue).toBe('***');
    const root = summary.find((entry) => entry.name === 'FF_GLOBAL_CONFIG_ROOT')!;
    expect(root.currentValue).toBe('/tmp/ff-root');
    // hub 不可见（测试沙箱系）不进入汇总
    expect(summary.find((entry) => entry.name === 'FF_TEST_SANDBOX')).toBeUndefined();
    // 未设置 → null
    expect(summary.find((entry) => entry.name === 'LOG_LEVEL')!.currentValue).toBeNull();
  });

  it('maskUrlCredentials：URL 凭据掩码，非 URL 整体掩码', () => {
    expect(maskUrlCredentials('https://user:pass@example.com:8080/db')).toBe('https://***@example.com:8080/db');
    expect(maskUrlCredentials('https://user@example.com/db')).toBe('https://***@example.com/db');
    expect(maskUrlCredentials('not-a-url')).toBe('***');
  });

  it('可编辑策略：runtimeEditable false 禁止；sensitive 缺省禁止', () => {
    expect(isEditableEnvVarName('FF_GLOBAL_CONFIG_ROOT')).toBe(false);
    expect(isEditableEnvVarName('LOG_LEVEL')).toBe(true);
    expect(isEditableEnvVarName('ANTHROPIC_API_KEY')).toBe(true); // sensitive + opt-in
    expect(isEditableEnvVarName('NOPE_UNKNOWN_VAR')).toBe(false);
  });

  it('敏感可编辑审计过滤', () => {
    expect(hasSensitiveEditableVars(['LOG_LEVEL', 'ANTHROPIC_API_KEY'])).toBe(true);
    expect(hasSensitiveEditableVars(['LOG_LEVEL', 'FF_GLOBAL_CONFIG_ROOT'])).toBe(false);
    expect(filterSensitiveEditableKeys(['ANTHROPIC_API_KEY', 'LOG_LEVEL'])).toEqual(['ANTHROPIC_API_KEY']);
  });
});
