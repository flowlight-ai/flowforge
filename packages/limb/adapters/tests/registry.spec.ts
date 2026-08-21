/**
 * registry — T6.6 CLI 适配器注册表契约验证。
 *
 * 覆盖：默认五适配器装配（EAC 顺序）、register 覆盖、get/has/list、
 * seed 自定义装配。
 */

import { describe, expect, it } from 'vitest';
import { buildDefaultAdapters, createLimbCliAdapterRegistry } from '../src/registry.js';
import type { CliAdapter } from '../src/types.js';

describe('buildDefaultAdapters', () => {
  it('默认装配五个适配器（EAC 顺序）', () => {
    const adapters = buildDefaultAdapters();
    expect(adapters.map((a) => a.config.kind)).toEqual(['claude', 'codex', 'gemini', 'agy', 'opencode']);
  });

  it('各适配器配置完整（binary/description/默认 120s 超时）', () => {
    for (const adapter of buildDefaultAdapters()) {
      expect(adapter.config.binary).toBeTruthy();
      expect(adapter.config.description).toBeTruthy();
      expect(adapter.config.defaultTimeoutMs).toBe(120_000);
    }
  });
});

describe('createLimbCliAdapterRegistry', () => {
  it('默认注册五适配器（注册序）', () => {
    const registry = createLimbCliAdapterRegistry();
    expect(registry.list().map((a) => a.config.kind)).toEqual(['claude', 'codex', 'gemini', 'agy', 'opencode']);
  });

  it('get / has 按 kind 查询', () => {
    const registry = createLimbCliAdapterRegistry();
    expect(registry.get('claude')?.config.binary).toBe('claude');
    expect(registry.has('gemini')).toBe(true);
    expect(registry.get('custom')).toBeUndefined();
    expect(registry.has('custom')).toBe(false);
  });

  it('register 覆盖同 kind（后注册者生效）', () => {
    const registry = createLimbCliAdapterRegistry();
    const fake: CliAdapter = {
      config: { kind: 'claude', binary: 'claude-custom', description: 'fake', defaultTimeoutMs: 10_000 },
      isAvailable: () => true,
      buildSpawnArgs: () => ['-p', 'custom'],
      createParser: () => ({ transform: () => null }),
    };
    registry.register(fake);
    expect(registry.get('claude')).toBe(fake);
    expect(registry.list().length).toBe(5);
  });

  it('seed 自定义装配（不加载默认）', () => {
    const fake: CliAdapter = {
      config: { kind: 'custom', binary: 'my-cli', description: 'seed', defaultTimeoutMs: 5_000 },
      isAvailable: () => true,
      buildSpawnArgs: () => [],
      createParser: () => ({ transform: () => null }),
    };
    const registry = createLimbCliAdapterRegistry([fake]);
    expect(registry.list()).toEqual([fake]);
    expect(registry.has('claude')).toBe(false);
  });
});
