/**
 * registry — MarketplaceRegistry 注册表测试（对齐 core/marketplace.py 语义）。
 *
 * @module @flowforge/forgekin-plugins/tests
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarketplaceRegistry } from '../src/registry.js';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('MarketplaceRegistry 内置注册表', () => {
  it('内置注册表加载 2 个插件（对齐 config/marketplace/registry.yaml）', async () => {
    const registry = new MarketplaceRegistry();
    const plugins = await registry.listPlugins();
    expect(plugins).toHaveLength(2);
    const names = plugins.map((p) => p.name);
    expect(names).toContain('flowforge-web-search');
    expect(names).toContain('flowforge-mcp-bridge');
  });

  it('内置清单字段默认值完整（category/tags/dependencies/permissions）', async () => {
    const registry = new MarketplaceRegistry();
    const plugin = await registry.getPlugin('flowforge-web-search');
    expect(plugin).toBeDefined();
    expect(plugin!.category).toBe('tool');
    expect(plugin!.version).toBe('1.2.0');
    expect(plugin!.min_flowforge_version).toBe('0.5.0');
    expect(plugin!.tags).toContain('search');
    expect(plugin!.permissions).toEqual(['network_access']);
    expect(plugin!.dependencies).toEqual([]);
  });

  it('search 大小写不敏感匹配 name/display_name/description/tags', async () => {
    const registry = new MarketplaceRegistry();
    const byName = await registry.search('WEB-SEARCH');
    expect(byName.map((p) => p.name)).toContain('flowforge-web-search');
    const byTag = await registry.search('mcp');
    expect(byTag.map((p) => p.name)).toContain('flowforge-mcp-bridge');
    const byDisplay = await registry.search('Bridge Integration');
    expect(byDisplay.map((p) => p.name)).toContain('flowforge-mcp-bridge');
    const byDescription = await registry.search('relevance scoring');
    expect(byDescription.map((p) => p.name)).toContain('flowforge-web-search');
  });

  it('search 空查询返回全部；无匹配返回空列表', async () => {
    const registry = new MarketplaceRegistry();
    expect(await registry.search('')).toHaveLength(2);
    expect(await registry.search('nonexistent-token')).toHaveLength(0);
  });

  it('listPlugins 按分类过滤', async () => {
    const registry = new MarketplaceRegistry();
    const tools = await registry.listPlugins('tool');
    expect(tools.map((p) => p.name)).toEqual(['flowforge-web-search']);
    const integrations = await registry.listPlugins('integration');
    expect(integrations.map((p) => p.name)).toEqual(['flowforge-mcp-bridge']);
    expect(await registry.listPlugins('agent')).toHaveLength(0);
  });

  it('getPlugin 不存在返回 undefined', async () => {
    const registry = new MarketplaceRegistry();
    expect(await registry.getPlugin('no-such-plugin')).toBeUndefined();
  });
});

describe('MarketplaceRegistry 外部 YAML 目录', () => {
  it('加载外部 registry YAML 的 plugins 列表（合并覆盖同名内置）', async () => {
    const dir = tempDir('ff-mp-reg-');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'extra.yaml'),
        [
          'plugins:',
          '  - name: flowforge-custom-tool',
          '    display_name: "Custom Tool"',
          '    description: "A custom marketplace tool"',
          '    version: "0.3.0"',
          '    category: tool',
          '    tags: [custom]',
          '  - name: flowforge-web-search',
          '    display_name: "Web Search Aggregator v2"',
          '    version: "2.0.0"',
          '    category: tool',
          '',
        ].join('\n'),
        'utf-8',
      );
      const registry = new MarketplaceRegistry({ registryPath: dir });
      const plugins = await registry.listPlugins();
      expect(plugins).toHaveLength(3);
      // 同名插件以外部为准（版本覆盖）
      const overwritten = await registry.getPlugin('flowforge-web-search');
      expect(overwritten!.version).toBe('2.0.0');
      const custom = await registry.getPlugin('flowforge-custom-tool');
      expect(custom!.display_name).toBe('Custom Tool');
      expect(custom!.tags).toEqual(['custom']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('外部目录不存在时仅内置（不抛错）', async () => {
    const registry = new MarketplaceRegistry({
      registryPath: join(tempDir('ff-mp-missing-'), 'nope'),
    });
    expect(await registry.listPlugins()).toHaveLength(2);
  });

  it('清单缺失 name 的 YAML 条目被跳过', async () => {
    const dir = tempDir('ff-mp-bad-');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'bad.yaml'),
        'plugins:\n  - display_name: "No Name"\n',
        'utf-8',
      );
      const registry = new MarketplaceRegistry({ registryPath: dir });
      expect(await registry.listPlugins()).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MarketplaceRegistry 远程刷新', () => {
  it('未配置远程 URL 时 refreshRegistry 返回 skipped', async () => {
    const registry = new MarketplaceRegistry();
    const result = await registry.refreshRegistry();
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_remote_configured');
    expect(result.total_plugins).toBe(2);
  });

  it('setRemoteUrl 后刷新失败返回 error（fetch 网络错误）', async () => {
    const registry = new MarketplaceRegistry();
    registry.setRemoteUrl('http://127.0.0.1:1/nonexistent');
    const result = await registry.refreshRegistry();
    expect(result.status).toBe('error');
  });
});
