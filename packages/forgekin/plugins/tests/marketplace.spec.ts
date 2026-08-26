/**
 * marketplace — Marketplace 插件市场测试（对齐 core/marketplace.py 语义）。
 *
 * @module @flowforge/forgekin-plugins/tests
 */

import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Marketplace } from '../src/marketplace.js';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** 构造一个含自定义插件的 registry YAML（源文件位于 root/src/<name>/）。 */
function makeRegistryYaml(
  dir: string,
  entries: Array<{
    name: string;
    version: string;
    minFlowforge?: string;
    deps?: string[];
    checksum?: string | null;
  }>,
): void {
  const lines = ['plugins:'];
  for (const e of entries) {
    lines.push(`  - name: ${e.name}`);
    lines.push(`    display_name: "Test ${e.name}"`);
    lines.push(`    description: "Marketplace test plugin"`);
    lines.push(`    version: "${e.version}"`);
    lines.push(`    category: tool`);
    lines.push(`    tags: [test]`);
    lines.push(`    entry_point: '${join(dir, 'src', e.name, 'index.ts')}:Plugin'`);
    if (e.minFlowforge) {
      lines.push(`    min_flowforge_version: "${e.minFlowforge}"`);
    }
    if (e.deps && e.deps.length > 0) {
      lines.push(`    dependencies: [${e.deps.map((d) => `"${d}"`).join(', ')}]`);
    }
    if (e.checksum !== undefined) {
      lines.push(`    checksum: "${e.checksum}"`);
    }
  }
  lines.push('');
  writeFileSync(join(dir, 'extra.yaml'), lines.join('\n'), 'utf-8');
}

function makeSourceFile(dir: string, name: string): string {
  const srcDir = join(dir, 'src', name);
  mkdirSync(srcDir, { recursive: true });
  const file = join(srcDir, 'index.ts');
  writeFileSync(file, 'export const ok = true;\n', 'utf-8');
  return file;
}

interface Setup {
  root: string;
  marketplace: Marketplace;
}

/** 标准测试布局：root/{registry,src,plugins,ver}。 */
function setup(opts: {
  entries?: Array<{
    name: string;
    version: string;
    minFlowforge?: string;
    deps?: string[];
    checksum?: string | null;
  }>;
  flowforgeVersion?: string;
  makeSources?: boolean;
} = {}): Setup {
  const root = tempDir('ff-mp-');
  const registryDir = join(root, 'registry');
  mkdirSync(registryDir, { recursive: true });
  const entries = opts.entries ?? [
    { name: 'flowforge-test-plugin', version: '0.1.0' },
  ];
  makeRegistryYaml(registryDir, entries);
  if (opts.makeSources !== false) {
    for (const e of entries) {
      makeSourceFile(registryDir, e.name);
    }
  }
  let flowforgeVersionPath: string | undefined;
  if (opts.flowforgeVersion !== undefined) {
    const verDir = join(root, 'ver');
    mkdirSync(verDir, { recursive: true });
    flowforgeVersionPath = join(verDir, 'package.json');
    writeFileSync(
      flowforgeVersionPath,
      JSON.stringify({ version: opts.flowforgeVersion }),
      'utf-8',
    );
  }
  const marketplace = new Marketplace({
    registryOptions: { registryPath: registryDir },
    pluginsDir: join(root, 'plugins'),
    ...(flowforgeVersionPath !== undefined
      ? { flowforgeVersionPath }
      : {}),
  });
  return { root, marketplace };
}

describe('Marketplace 安装', () => {
  it('registry 无此插件 → error', async () => {
    const { marketplace } = setup();
    const result = await marketplace.install('ghost-plugin');
    expect(result.status).toBe('error');
    expect(result.error).toContain("not found in registry");
  });

  it('指定版本不存在 → error', async () => {
    const { marketplace } = setup();
    const result = await marketplace.install('flowforge-test-plugin', '9.9.9');
    expect(result.status).toBe('error');
    expect(result.error).toContain('Version 9.9.9 not available');
  });

  it('成功安装：复制源文件 + installed.json 持久化', async () => {
    const { root, marketplace } = setup();
    const result = await marketplace.install('flowforge-test-plugin');
    console.log('DBG install:', JSON.stringify(result));
    expect(result.status).toBe('installed');
    expect(result.version).toBe('0.1.0');
    // 源文件已复制到插件目录
    expect(
      existsSync(join(root, 'plugins', 'flowforge-test-plugin', 'index.ts')),
    ).toBe(true);
    // installed.json 持久化
    const installedJson = JSON.parse(
      readFileSync(join(root, 'plugins', 'installed.json'), 'utf-8'),
    ) as Record<string, { version: string }>;
    expect(installedJson['flowforge-test-plugin']!.version).toBe('0.1.0');
    // listInstalled / isInstalled
    const installed = await marketplace.listInstalled();
    expect(installed.map((m) => m.name)).toEqual(['flowforge-test-plugin']);
    expect(await marketplace.isInstalled('flowforge-test-plugin')).toBe(true);
  });

  it('已安装同版本 → already_installed', async () => {
    const { marketplace } = setup();
    await marketplace.install('flowforge-test-plugin');
    const result = await marketplace.install('flowforge-test-plugin');
    expect(result.status).toBe('already_installed');
    expect(result.version).toBe('0.1.0');
  });

  it('FlowForge 版本不兼容 → error', async () => {
    const { marketplace } = setup({
      entries: [
        {
          name: 'flowforge-test-plugin',
          version: '0.1.0',
          minFlowforge: '9.0.0',
        },
      ],
      flowforgeVersion: '0.5.0',
    });
    const result = await marketplace.install('flowforge-test-plugin');
    expect(result.status).toBe('error');
    expect(result.error).toContain('requires FlowForge >= 9.0.0');
  });

  it('版本兼容通过（当前版本 >= 最低要求）', async () => {
    const { marketplace } = setup({
      entries: [
        {
          name: 'flowforge-test-plugin',
          version: '0.1.0',
          minFlowforge: '0.4.0',
        },
      ],
      flowforgeVersion: '0.5.0',
    });
    const result = await marketplace.install('flowforge-test-plugin');
    expect(result.status).toBe('installed');
  });

  it('依赖递归安装：a 依赖 b → 两者都装', async () => {
    const { root, marketplace } = setup({
      entries: [
        { name: 'plugin-a', version: '1.0.0', deps: ['plugin-b'] },
        { name: 'plugin-b', version: '2.0.0' },
      ],
    });
    const result = await marketplace.install('plugin-a');
    expect(result.status).toBe('installed');
    expect(
      existsSync(join(root, 'plugins', 'plugin-a', 'index.ts')),
    ).toBe(true);
    expect(
      existsSync(join(root, 'plugins', 'plugin-b', 'index.ts')),
    ).toBe(true);
    const installed = await marketplace.listInstalled();
    expect(installed.map((m) => m.name).sort()).toEqual(['plugin-a', 'plugin-b']);
  });

  it('依赖不在 registry → error 且不落盘', async () => {
    const { root, marketplace } = setup({
      entries: [
        { name: 'plugin-a', version: '1.0.0', deps: ['ghost-plugin'] },
      ],
    });
    const result = await marketplace.install('plugin-a');
    expect(result.status).toBe('error');
    expect(result.error).toContain("Failed to install dependency 'ghost-plugin'");
    expect(existsSync(join(root, 'plugins'))).toBe(false);
  });

  it('checksum 校验失败 → error', async () => {
    const { root, marketplace } = setup({
      entries: [
        { name: 'flowforge-test-plugin', version: '0.1.0', checksum: 'deadbeef' },
      ],
    });
    // 预建插件目录（checksum 检查发生在下载前，目录已存在才能校验）
    mkdirSync(join(root, 'plugins', 'flowforge-test-plugin'), {
      recursive: true,
    });
    writeFileSync(
      join(root, 'plugins', 'flowforge-test-plugin', 'index.ts'),
      'export const preexisting = true;\n',
      'utf-8',
    );
    const result = await marketplace.install('flowforge-test-plugin');
    expect(result.status).toBe('error');
    expect(result.error).toContain('checksum verification failed');
  });
});

describe('Marketplace 卸载', () => {
  it('未安装 → error', async () => {
    const { marketplace } = setup();
    const result = await marketplace.uninstall('flowforge-test-plugin');
    expect(result.status).toBe('error');
    expect(result.error).toContain('is not installed');
  });

  it('有依赖者 → 拒绝卸载', async () => {
    const { marketplace } = setup({
      entries: [
        { name: 'plugin-a', version: '1.0.0', deps: ['plugin-b'] },
        { name: 'plugin-b', version: '2.0.0' },
      ],
    });
    await marketplace.install('plugin-a');
    const result = await marketplace.uninstall('plugin-b');
    expect(result.status).toBe('error');
    expect(result.error).toContain('Cannot uninstall: plugins plugin-a depend on it');
    // 插件目录保留
    expect(await marketplace.isInstalled('plugin-b')).toBe(true);
  });

  it('成功卸载：删目录 + 删记录', async () => {
    const { root, marketplace } = setup();
    await marketplace.install('flowforge-test-plugin');
    const result = await marketplace.uninstall('flowforge-test-plugin');
    expect(result.status).toBe('uninstalled');
    expect(existsSync(join(root, 'plugins', 'flowforge-test-plugin'))).toBe(false);
    expect(await marketplace.listInstalled()).toHaveLength(0);
    expect(await marketplace.isInstalled('flowforge-test-plugin')).toBe(false);
    // installed.json 不含该插件
    const installedJson = JSON.parse(
      readFileSync(join(root, 'plugins', 'installed.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(installedJson['flowforge-test-plugin']).toBeUndefined();
  });
});

describe('Marketplace 更新', () => {
  it('未安装 → error', async () => {
    const { marketplace } = setup();
    const result = await marketplace.update('flowforge-test-plugin');
    expect(result.status).toBe('error');
    expect(result.error).toContain('is not installed');
  });

  it('已最新 → up_to_date', async () => {
    const { marketplace } = setup();
    await marketplace.install('flowforge-test-plugin');
    const result = await marketplace.update('flowforge-test-plugin');
    expect(result.status).toBe('up_to_date');
    expect(result.version).toBe('0.1.0');
  });

  it('registry 有新版本 → updated（先卸旧再装新）', async () => {
    const { root, marketplace } = setup();
    await marketplace.install('flowforge-test-plugin');
    // 升级 registry 版本到 0.2.0（改写 YAML）
    makeRegistryYaml(join(root, 'registry'), [
      { name: 'flowforge-test-plugin', version: '0.2.0' },
    ]);
    // 重建 marketplace 以重新加载注册表
    const upgraded = new Marketplace({
      registryOptions: { registryPath: join(root, 'registry') },
      pluginsDir: join(root, 'plugins'),
    });
    const result = await upgraded.update('flowforge-test-plugin');
    expect(result.status).toBe('updated');
    expect(result.previous_version).toBe('0.1.0');
    expect(result.new_version).toBe('0.2.0');
    const installed = await upgraded.listInstalled();
    expect(installed[0]!.version).toBe('0.2.0');
  });
});

describe('Marketplace 验证', () => {
  it('未安装 → error', async () => {
    const { marketplace } = setup();
    const result = await marketplace.verify('flowforge-test-plugin');
    expect(result.status).toBe('error');
    expect(result.error).toContain('is not installed');
  });

  it('插件目录缺失 → failed（files_exist false）', async () => {
    const { marketplace } = setup();
    // 先正常安装再删目录
    await marketplace.install('flowforge-test-plugin');
    rmSync(join(marketplace.pluginsDirectory, 'flowforge-test-plugin'), {
      recursive: true,
      force: true,
    });
    const result = await marketplace.verify('flowforge-test-plugin');
    expect(result.status).toBe('failed');
    expect(result.checks!['files_exist']).toBe(false);
    expect(result.error).toContain('Plugin directory not found');
  });

  it('全部检查通过 → verified', async () => {
    const { marketplace } = setup();
    await marketplace.install('flowforge-test-plugin');
    const result = await marketplace.verify('flowforge-test-plugin');
    expect(result.status).toBe('verified');
    expect(result.checks!['files_exist']).toBe(true);
    expect(result.checks!['entry_point']).toBe(true);
    expect(result.checks!['checksum']).toBe('not_specified');
    expect(result.checks!['safety_scan']).toBe(true);
  });

  it('危险模式检测 → failed（safety_scan false）', async () => {
    const { root, marketplace } = setup();
    await marketplace.install('flowforge-test-plugin');
    // 向插件目录注入含危险模式的文件
    writeFileSync(
      join(root, 'plugins', 'flowforge-test-plugin', 'evil.ts'),
      'export function evil() { eval("1+1"); }\n',
      'utf-8',
    );
    const result = await marketplace.verify('flowforge-test-plugin');
    expect(result.status).toBe('failed');
    expect(result.checks!['safety_scan']).toBe(false);
  });

  it('入口点不可解析 → failed（entry_point false）', async () => {
    const { root, marketplace } = setup();
    await marketplace.install('flowforge-test-plugin');
    // 删除源文件使入口点失效
    rmSync(join(root, 'registry', 'src', 'flowforge-test-plugin'), {
      recursive: true,
      force: true,
    });
    const result = await marketplace.verify('flowforge-test-plugin');
    expect(result.status).toBe('failed');
    expect(result.checks!['entry_point']).toBe(false);
  });
});
