/**
 * manifest + registry — Provider Manifest 规范化与 ProviderTransportRegistry 测试。
 *
 * 语义对照 flowforge/core/external_agent/test_manifest.py + test_registry.py：
 *   - normalizeManifest：必需字段校验 / 缺省填充 / 可选字段透传
 *   - parseManifestYaml / loadManifestFromYaml / loadManifestsFromDir
 *   - ProviderTransportRegistry：register / discover / get / list / unregister /
 *     load_from_dir 覆盖语义
 *
 * @module @flowforge/external-agent/tests
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type AgentProviderManifest,
  loadManifestFromYaml,
  loadManifestsFromDir,
  normalizeManifest,
  parseManifestYaml,
} from '../src/manifest.js';
import {
  ProviderAlreadyRegisteredError,
  ProviderTransportRegistry,
} from '../src/registry.js';

/** 最小合法 Manifest 工厂。 */
function makeManifest(overrides: Record<string, unknown> = {}): AgentProviderManifest {
  return normalizeManifest({
    provider_name: 'vendor.tool',
    display_name: 'Vendor Tool',
    version: '1.2.0',
    protocol: 'cli',
    transport: 'stdio',
    capabilities: ['code-gen', 'review'],
    blind_spots: ['deploy'],
    ...overrides,
  });
}

describe('normalizeManifest（manifest.py 校验语义）', () => {
  it('必需字段校验：provider_name 缺失抛错', () => {
    expect(() => normalizeManifest({ display_name: 'x' })).toThrow(/provider_name/);
  });

  it('provider_name 必须含 "."（manifest.py 校验）', () => {
    expect(() => normalizeManifest({ provider_name: 'noseparator' })).toThrow(/must contain/i);
  });

  it('缺省字段自动填充（version/protocol/transport/capabilities/blind_spots）', () => {
    const manifest = normalizeManifest({ provider_name: 'a.b', display_name: 'AB' });
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.protocol).toBe('cli');
    expect(manifest.transport).toBe('stdio');
    expect(manifest.capabilities).toEqual([]);
    expect(manifest.blind_spots).toEqual([]);
  });

  it('可选字段透传（timeout/retry_policy/cost/safety/env_vars/permissions）', () => {
    const manifest = normalizeManifest({
      provider_name: 'a.b',
      display_name: 'AB',
      timeout_seconds: 120,
      retry_policy: { max_attempts: 5, backoff_seconds: 2 },
      cost_per_token: 0.001,
      cost_per_call: 0.01,
      safety_level: 'isolated',
      required_env_vars: ['TOKEN_A'],
      required_permissions: ['read'],
    });
    expect(manifest.timeout_seconds).toBe(120);
    expect(manifest.retry_policy).toEqual({ max_attempts: 5, backoff_seconds: 2 });
    expect(manifest.cost_per_token).toBe(0.001);
    expect(manifest.cost_per_call).toBe(0.01);
    expect(manifest.safety_level).toBe('isolated');
    expect(manifest.required_env_vars).toEqual(['TOKEN_A']);
    expect(manifest.required_permissions).toEqual(['read']);
  });

  it('capabilities 非数组时规范化为空数组', () => {
    const manifest = normalizeManifest({
      provider_name: 'a.b',
      display_name: 'AB',
      capabilities: 'code-gen',
    });
    expect(manifest.capabilities).toEqual([]);
  });
});

describe('parseManifestYaml / loadManifestFromYaml', () => {
  it('解析合法 YAML', () => {
    const manifest = parseManifestYaml(
      'provider_name: a.b\ndisplay_name: AB\ncapabilities:\n  - code-gen\n',
    );
    expect(manifest.provider_name).toBe('a.b');
    expect(manifest.capabilities).toEqual(['code-gen']);
  });

  it('非法 YAML 抛错', () => {
    expect(() => parseManifestYaml('provider_name: [unclosed')).toThrow();
  });

  it('YAML 根不是对象抛错', () => {
    expect(() => parseManifestYaml('- a\n- b\n')).toThrow(/object/i);
  });

  it('文件不存在抛错', () => {
    expect(() => loadManifestFromYaml(join(tmpdir(), 'no-such-manifest.yaml'))).toThrow();
  });
});

describe('loadManifestsFromDir', () => {
  it('加载目录全部 Manifest 并报告覆盖项', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ex-manifests-'));
    try {
      writeFileSync(join(dir, 'a.yaml'), 'provider_name: a.b\ndisplay_name: AB\n');
      writeFileSync(join(dir, 'b.yaml'), 'provider_name: c.d\ndisplay_name: CD\n');
      // 同名覆盖
      writeFileSync(join(dir, 'b2.yaml'), 'provider_name: c.d\ndisplay_name: CD2\n');
      const { manifests, overridden } = loadManifestsFromDir(dir);
      // 覆盖语义：同 provider 替换，列表长度仍为 2
      expect(manifests).toHaveLength(2);
      expect(overridden).toEqual(['c.d']);
      expect(manifests.find((m) => m.provider_name === 'c.d')?.display_name).toBe('CD2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ProviderTransportRegistry（registry.py）', () => {
  it('register / get / listAll / listProviderNames / size', () => {
    const registry = new ProviderTransportRegistry();
    registry.register(makeManifest());
    registry.register(makeManifest({ provider_name: 'x.y' }));
    expect(registry.size).toBe(2);
    expect(registry.get('vendor.tool')?.display_name).toBe('Vendor Tool');
    expect(registry.listProviderNames()).toEqual(['vendor.tool', 'x.y']);
    expect(registry.listAll()).toHaveLength(2);
  });

  it('重复注册抛 ProviderAlreadyRegisteredError', () => {
    const registry = new ProviderTransportRegistry();
    registry.register(makeManifest());
    expect(() => registry.register(makeManifest())).toThrow(ProviderAlreadyRegisteredError);
  });

  it('discover 按能力过滤（registry.py discover）', () => {
    const registry = new ProviderTransportRegistry();
    registry.register(makeManifest({ provider_name: 'a.b', capabilities: ['code-gen'] }));
    registry.register(makeManifest({ provider_name: 'c.d', capabilities: ['deploy'] }));
    const found = registry.discover('code-gen');
    expect(found).toHaveLength(1);
    expect(found[0]!.provider_name).toBe('a.b');
  });

  it('unregister 返回是否曾注册', () => {
    const registry = new ProviderTransportRegistry();
    registry.register(makeManifest());
    expect(registry.unregister('vendor.tool')).toBe(true);
    expect(registry.unregister('vendor.tool')).toBe(false);
  });

  it('loadFromDir：已存在 Provider 覆盖注册不抛错（load_from_dir 语义）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ex-registry-'));
    const registry = new ProviderTransportRegistry();
    try {
      registry.register(makeManifest({ provider_name: 'a.b', version: '1.0.0' }));
      writeFileSync(
        join(dir, 'a.yaml'),
        'provider_name: a.b\ndisplay_name: AB-v2\nversion: 2.0.0\n',
      );
      const { loaded, overridden } = registry.loadFromDir(dir);
      expect(loaded).toEqual(['a.b']);
      expect(overridden).toEqual(['a.b']);
      expect(registry.get('a.b')?.version).toBe('2.0.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
