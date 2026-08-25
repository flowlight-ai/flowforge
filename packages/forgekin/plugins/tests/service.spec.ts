/**
 * service — MarketplaceService 挂载测试（ctx.forgePlugins）。
 *
 * @module @flowforge/forgekin-plugins/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Plugin, {
  MarketplaceService,
  type ForgePluginsOptions,
} from '../src/service.js';
import type { PluginManifest } from '../src/types.js';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function mount(options: ForgePluginsOptions = {}): {
  ctx: Context;
  dir: string;
} {
  const dir = tempDir('ff-mp-svc-');
  const ctx = new Context();
  Plugin(ctx, { pluginsDir: join(dir, 'plugins'), ...options });
  return { ctx, dir };
}

describe('MarketplaceService 挂载', () => {
  it('Plugin(ctx) 同步挂载 ctx.forgePlugins', () => {
    const { ctx } = mount();
    expect(ctx.forgePlugins).toBeInstanceOf(MarketplaceService);
  });

  it('内置注册表 2 插件 + 搜索/列表快捷方法', async () => {
    const { ctx } = mount();
    const plugins = await ctx.forgePlugins.listPlugins();
    expect(plugins).toHaveLength(2);
    const hits = await ctx.forgePlugins.search('mcp');
    expect(hits.map((p) => p.name)).toContain('flowforge-mcp-bridge');
    const detail = await ctx.forgePlugins.getPlugin('flowforge-web-search');
    expect(detail!.category).toBe('tool');
  });

  it('内置插件无本机源文件 → 下载失败 error', async () => {
    const { ctx } = mount();
    const result = await ctx.forgePlugins.install('flowforge-web-search');
    expect(result.status).toBe('error'); // 内置插件无本机源文件，下载失败
    expect(result.error).toContain('Download failed');
  });

  it('自定义 registry 插件安装成功（外部 YAML + 本机源文件）', async () => {
    const { dir } = mount();
    // 独立 ctx（mount 已注册 forgePlugins，Cordis service 单 ctx 单注册）
    const svcCtx = new Context();
    // 通过底层注册表注入自定义插件（外部 YAML 目录）
    const registryDir = join(dir, 'registry');
    mkdirSync(registryDir, { recursive: true });
    mkdirSync(join(dir, 'src', 'demo'), { recursive: true });
    writeFileSync(join(dir, 'src', 'demo', 'index.ts'), 'export const d = 1;\n');
    writeFileSync(
      join(registryDir, 'demo.yaml'),
      [
        'plugins:',
        '  - name: demo-plugin',
        '    display_name: "Demo"',
        '    version: "0.1.0"',
        '    category: tool',
        `    entry_point: '${join(dir, 'src', 'demo', 'index.ts')}:Plugin'`,
        '',
      ].join('\n'),
      'utf-8',
    );
    const svc = new MarketplaceService(svcCtx, {
      registryOptions: { registryPath: registryDir },
      pluginsDir: join(dir, 'plugins'),
    });
    const result = await svc.install('demo-plugin');
    expect(result.status).toBe('installed');
    expect(await svc.isInstalled('demo-plugin')).toBe(true);
    const uninstalled = await svc.uninstall('demo-plugin');
    expect(uninstalled.status).toBe('uninstalled');
  });

  it('verify / update / refreshRegistry / setRemoteUrl 快捷方法', async () => {
    const { ctx } = mount();
    const verifyResult = await ctx.forgePlugins.verify('flowforge-web-search');
    expect(verifyResult.status).toBe('error');
    expect(verifyResult.error).toContain('is not installed');

    const refresh = await ctx.forgePlugins.refreshRegistry();
    expect(refresh.status).toBe('skipped');
    ctx.forgePlugins.setRemoteUrl('http://127.0.0.1:1/x');
    expect((await ctx.forgePlugins.refreshRegistry()).status).toBe('error');
  });

  it('前端插件注册表：register/unregister/挂载点查询', () => {
    const { ctx } = mount();
    const manifest: PluginManifest = {
      name: 'ui-theme',
      version: '0.2.0',
      frontend_entry: 'ui-theme/dist/index.js',
      mount_points: ['sidebar', 'dashboard'],
    };
    ctx.forgePlugins.registerFrontend('ui-theme', manifest);
    expect(ctx.forgePlugins.getAllFrontendPlugins()).toHaveLength(1);
    const sidebar = ctx.forgePlugins.getFrontendPluginsForMount('sidebar');
    expect(sidebar.map((p) => p.name)).toEqual(['ui-theme']);
    expect(
      ctx.forgePlugins.getFrontendPluginsForMount('toolbar'),
    ).toHaveLength(0);

    // 无 frontend_entry 的清单跳过注册
    ctx.forgePlugins.registerFrontend('no-ui', {
      name: 'no-ui',
      version: '1.0.0',
    });
    expect(ctx.forgePlugins.getAllFrontendPlugins()).toHaveLength(1);

    ctx.forgePlugins.unregisterFrontend('ui-theme');
    expect(ctx.forgePlugins.getAllFrontendPlugins()).toHaveLength(0);
  });

  it('挂载点常量暴露', () => {
    mount();
    expect(MarketplaceService.mountPoints.SIDEBAR).toBe('sidebar');
    expect(MarketplaceService.mountPoints.REVIEW_PANEL).toBe('review_panel');
  });

  it('snapshot 汇总注册表/已安装/前端插件', async () => {
    const { ctx } = mount();
    const snap = await ctx.forgePlugins.snapshot();
    expect(snap.registry_total).toBe(2);
    expect(snap.installed).toEqual([]);
    expect(snap.frontend_plugins).toEqual([]);
  });
});
