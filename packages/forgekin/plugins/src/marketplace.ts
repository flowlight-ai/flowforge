/**
 * marketplace — Marketplace 插件市场（T7.11/F11，对齐 `core/marketplace.py`）。
 *
 * 协调注册表（发现）与插件管理（生命周期），提供一键安装/卸载/更新/验证：
 * 依赖递归解析 + FlowForge 版本兼容 + checksum 完整性 + 危险模式安全扫描 +
 * installed.json 持久化。
 *
 * 融合策略（03-fusion-strategy.md F15）：Python 插件注册表机制废弃，
 * 加载统一由 dsh cordis 装配承担；本模块保留市场发现/安装记录/前端注册语义。
 *
 * @module @flowforge/forgekin-plugins
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  MarketplaceRegistry,
  type RegistryOptions,
} from './registry.js';
import type {
  MarketplaceResult,
  PluginManifest,
} from './types.js';

/** Marketplace 构造选项。 */
export interface MarketplaceOptions {
  /** 注册表实例（缺省新建，含内置插件）。 */
  registry?: MarketplaceRegistry;
  /** 注册表选项（registry 未传入时生效）。 */
  registryOptions?: RegistryOptions;
  /** 已安装插件目录（installed.json 所在目录）。 */
  pluginsDir?: string;
  /** FlowForge 版本来源（package.json 路径；无法读取时允许安装，对齐 Python）。 */
  flowforgeVersionPath?: string;
}

/** 安全扫描危险模式（对齐 Python _safety_scan + TS 化）。 */
const DANGEROUS_PATTERNS: readonly string[] = [
  'eval(',
  'exec(',
  'child_process.',
  'os.system(',
  'subprocess.call(',
  'subprocess.Popen(',
  '__import__(',
];

/**
 * Marketplace — 主市场接口：发现、安装与管理插件。
 */
export class Marketplace {
  private readonly registry: MarketplaceRegistry;
  private readonly pluginsDir: string;
  private readonly installedManifestPath: string;
  private readonly flowforgeVersionPath: string | undefined;
  private readonly installed = new Map<string, PluginManifest>();

  constructor(options: MarketplaceOptions = {}) {
    this.registry =
      options.registry ?? new MarketplaceRegistry(options.registryOptions);
    this.pluginsDir = options.pluginsDir ?? resolve('.flowforge/plugins');
    this.installedManifestPath = join(this.pluginsDir, 'installed.json');
    this.flowforgeVersionPath = options.flowforgeVersionPath;
  }

  /** 底层注册表（高级操作）。 */
  get registryRef(): MarketplaceRegistry {
    return this.registry;
  }

  /** 已安装插件目录。 */
  get pluginsDirectory(): string {
    return this.pluginsDir;
  }

  /** 惰性加载 installed.json。 */
  private ensureInstalledLoaded(): void {
    if (this.installed.size > 0 || !existsSync(this.installedManifestPath)) {
      return;
    }
    try {
      const data = JSON.parse(
        readFileSync(this.installedManifestPath, 'utf-8'),
      ) as Record<string, unknown>;
      for (const [name, manifestData] of Object.entries(data)) {
        this.installed.set(name, manifestData as PluginManifest);
      }
    } catch {
      // installed.json 损坏——忽略（对齐 Python error 后继续）
    }
  }

  /** 持久化已安装清单到 installed.json。 */
  private saveInstalledManifest(): void {
    mkdirSync(this.pluginsDir, { recursive: true });
    const data = Object.fromEntries(this.installed);
    writeFileSync(
      this.installedManifestPath,
      `${JSON.stringify(data, null, 2)}\n`,
      'utf-8',
    );
  }

  /** 搜索市场插件（转发注册表）。 */
  async search(
    query: string,
    category?: PluginManifest['category'],
  ): Promise<PluginManifest[]> {
    return this.registry.search(query, category);
  }

  /** 获取插件详情（转发注册表）。 */
  async getPlugin(name: string): Promise<PluginManifest | undefined> {
    return this.registry.getPlugin(name);
  }

  /** 列出注册表全部插件（可选按分类过滤）。 */
  async listPlugins(
    category?: PluginManifest['category'],
  ): Promise<PluginManifest[]> {
    return this.registry.listPlugins(category);
  }

  /**
   * 安装插件（对齐 Python 七步流程）：
   * 1 registry 查找 → 2 版本检查 → 3 已装检查 → 4 FlowForge 版本兼容 →
   * 5 依赖递归安装 → 6 checksum 校验 → 7 下载/复制 + installed.json 持久化。
   */
  async install(
    name: string,
    version?: string,
  ): Promise<MarketplaceResult> {
    this.ensureInstalledLoaded();

    // 1. registry 查找
    const manifest = await this.registry.getPlugin(name);
    if (manifest === undefined) {
      return {
        status: 'error',
        name,
        error: `Plugin '${name}' not found in registry`,
      };
    }

    // 2. 版本检查
    const targetVersion = manifest.version ?? '1.0.0';
    if (version !== undefined && targetVersion !== version) {
      return {
        status: 'error',
        name,
        error: `Version ${version} not available (latest: ${targetVersion})`,
      };
    }

    // 3. 已装检查
    const existing = this.installed.get(name);
    if (existing !== undefined && existing.version === targetVersion) {
      return {
        status: 'already_installed',
        name,
        version: targetVersion,
      };
    }

    // 4. FlowForge 版本兼容
    if (manifest.min_flowforge_version) {
      const compat = await this.checkFlowforgeVersion(
        manifest.min_flowforge_version,
      );
      if (!compat) {
        return {
          status: 'error',
          name,
          error: `Plugin requires FlowForge >= ${manifest.min_flowforge_version}`,
        };
      }
    }

    // 5. 依赖递归安装
    for (const depName of manifest.dependencies ?? []) {
      if (this.installed.has(depName)) {
        continue;
      }
      const depResult = await this.install(depName);
      if (depResult.status === 'error') {
        return {
          status: 'error',
          name,
          error: `Failed to install dependency '${depName}': ${depResult.error ?? ''}`,
        };
      }
    }

    // 6. checksum 完整性校验
    if (manifest.checksum) {
      const verified = await this.verifyChecksum(name, manifest.checksum);
      if (!verified) {
        return {
          status: 'error',
          name,
          error: 'Plugin checksum verification failed',
        };
      }
    }

    // 7. 下载/复制插件文件 + 持久化
    const pluginDir = join(this.pluginsDir, name);
    try {
      await this.downloadPlugin(manifest, pluginDir);
    } catch (e) {
      return {
        status: 'error',
        name,
        error: `Download failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    this.installed.set(name, manifest);
    this.saveInstalledManifest();
    return {
      status: 'installed',
      name,
      version: targetVersion,
    };
  }

  /**
   * 卸载插件（对齐 Python）：先检查依赖者，再注销/删目录/删记录。
   */
  async uninstall(name: string): Promise<MarketplaceResult> {
    this.ensureInstalledLoaded();
    if (!this.installed.has(name)) {
      return {
        status: 'error',
        name,
        error: `Plugin '${name}' is not installed`,
      };
    }

    // 依赖者检查
    const dependents = this.findDependents(name);
    if (dependents.length > 0) {
      return {
        status: 'error',
        name,
        error: `Cannot uninstall: plugins ${dependents.join(', ')} depend on it`,
      };
    }

    // 删除插件目录
    const pluginDir = join(this.pluginsDir, name);
    try {
      rmSync(pluginDir, { recursive: true, force: true });
    } catch {
      // 目录删除失败——继续（对齐 Python warning）
    }

    // 删除安装记录 + 持久化
    this.installed.delete(name);
    this.saveInstalledManifest();
    return { status: 'uninstalled', name };
  }

  /** 列出已安装插件。 */
  async listInstalled(): Promise<PluginManifest[]> {
    this.ensureInstalledLoaded();
    return [...this.installed.values()];
  }

  /** 已安装插件是否包含指定插件。 */
  async isInstalled(name: string): Promise<boolean> {
    this.ensureInstalledLoaded();
    return this.installed.has(name);
  }

  /**
   * 更新插件到注册表最新版本（对齐 Python）：
   * 未安装/注册表无此插件 → error；已最新 → up_to_date；
   * 否则先卸载旧版再安装新版。
   */
  async update(name: string): Promise<MarketplaceResult> {
    this.ensureInstalledLoaded();
    const current = this.installed.get(name);
    if (current === undefined) {
      return {
        status: 'error',
        name,
        error: `Plugin '${name}' is not installed`,
      };
    }
    const latest = await this.registry.getPlugin(name);
    if (latest === undefined) {
      return {
        status: 'error',
        name,
        error: `Plugin '${name}' not found in registry`,
      };
    }
    const currentVersion = current.version ?? '1.0.0';
    const latestVersion = latest.version ?? '1.0.0';
    if (latestVersion === currentVersion) {
      return {
        status: 'up_to_date',
        name,
        version: currentVersion,
      };
    }

    const uninstallResult = await this.uninstall(name);
    if (uninstallResult.status !== 'uninstalled') {
      return {
        status: 'error',
        name,
        error: `Failed to uninstall old version: ${uninstallResult.error ?? ''}`,
      };
    }
    const installResult = await this.install(name);
    if (
      installResult.status !== 'installed' &&
      installResult.status !== 'already_installed'
    ) {
      return installResult;
    }
    return {
      status: 'updated',
      name,
      previous_version: currentVersion,
      new_version: latestVersion,
    };
  }

  /**
   * 验证插件完整性（对齐 Python）：文件存在 + 入口点可加载 + checksum +
   * 安全扫描四检查。
   */
  async verify(name: string): Promise<MarketplaceResult> {
    this.ensureInstalledLoaded();
    if (!this.installed.has(name)) {
      return {
        status: 'error',
        name,
        error: `Plugin '${name}' is not installed`,
      };
    }
    const manifest = this.installed.get(name)!;
    const pluginDir = join(this.pluginsDir, name);
    const checks: Record<string, boolean | string> = {};

    // 文件存在
    checks['files_exist'] = existsSync(pluginDir);
    if (!existsSync(pluginDir)) {
      return {
        status: 'failed',
        name,
        checks,
        error: 'Plugin directory not found',
      };
    }

    // 入口点可加载
    checks['entry_point'] = manifest.entry_point
      ? await this.checkEntryPoint(manifest.entry_point)
      : 'not_specified';

    // checksum
    checks['checksum'] = manifest.checksum
      ? await this.verifyChecksum(name, manifest.checksum)
      : 'not_specified';

    // 安全扫描
    checks['safety_scan'] = this.safetyScan(pluginDir);

    const allPassed = Object.values(checks).every(
      (v) => v === true || v === 'not_specified',
    );
    return {
      status: allPassed ? 'verified' : 'failed',
      name,
      version: manifest.version ?? '1.0.0',
      checks,
    };
  }

  /** 刷新注册表（转发注册表，支持远程 URL）。 */
  async refreshRegistry() {
    return this.registry.refreshRegistry();
  }

  /** 配置远程注册表 URL。 */
  setRemoteUrl(url: string): void {
    this.registry.setRemoteUrl(url);
  }

  // ── 内部辅助（对齐 Python 同名私有方法）──────────────────────────

  /** 查找依赖指定插件的已安装插件列表。 */
  private findDependents(name: string): string[] {
    const dependents: string[] = [];
    for (const [installedName, manifest] of this.installed) {
      if ((manifest.dependencies ?? []).includes(name)) {
        dependents.push(installedName);
      }
    }
    return dependents;
  }

  /**
   * 检查当前 FlowForge 版本是否满足最低要求。
   * 无法确定版本时允许安装（对齐 Python：warning 后返回 True）。
   */
  private async checkFlowforgeVersion(minVersion: string): Promise<boolean> {
    if (this.flowforgeVersionPath === undefined) {
      return true;
    }
    try {
      const pkg = JSON.parse(
        readFileSync(this.flowforgeVersionPath, 'utf-8'),
      ) as { version?: string };
      const current = toTuple(pkg.version ?? '');
      const required = toTuple(minVersion);
      return compareTuple(current, required) >= 0;
    } catch {
      return true;
    }
  }

  /**
   * 校验插件文件 checksum（对齐 Python：目录内源码文件排序哈希）。
   */
  private async verifyChecksum(
    name: string,
    expectedChecksum: string,
  ): Promise<boolean> {
    const pluginDir = join(this.pluginsDir, name);
    if (!existsSync(pluginDir)) {
      return false;
    }
    const hasher = createHash('sha256');
    const files = collectSourceFiles(pluginDir);
    for (const file of files) {
      try {
        hasher.update(readFileSync(file));
      } catch {
        continue;
      }
    }
    return hasher.digest('hex') === expectedChecksum;
  }

  /**
   * 下载/复制插件文件（对齐 Python _download_plugin）：
   * entry_point "module:Class" → module 段定位本机源目录/文件 → 复制到目标目录。
   * 无法定位源文件时抛错（对齐 Python RuntimeError）。
   */
  private async downloadPlugin(
    manifest: PluginManifest,
    targetDir: string,
  ): Promise<void> {
    mkdirSync(targetDir, { recursive: true });
    const modulePath = extractModulePath(manifest.entry_point ?? '');
    if (modulePath === undefined) {
      throw new Error(
        `Failed to download plugin '${manifest.name}': could not locate source files for entry_point '${manifest.entry_point ?? ''}'`,
      );
    }
    const resolved = resolve(modulePath);
    if (existsSync(resolved)) {
      const st = statSync(resolved);
      if (st.isDirectory()) {
        for (const file of readdirSync(resolved)) {
          if (/\\.(ts|js|mjs|cjs)$/.test(file)) {
            copyFileSync(join(resolved, file), join(targetDir, file));
          }
        }
        return;
      }
      copyFileSync(resolved, join(targetDir, basename(resolved)));
      return;
    }
    throw new Error(
      `Failed to download plugin '${manifest.name}': could not locate source files for entry_point '${manifest.entry_point ?? ''}'`,
    );
  }

  /** 检查入口点是否可加载（TS 版：入口模块路径存在即可）。 */
  private async checkEntryPoint(entryPoint: string): Promise<boolean> {
    const modulePath = extractModulePath(entryPoint);
    if (modulePath === undefined) {
      return false;
    }
    try {
      return existsSync(resolve(modulePath)) || existsSync(modulePath);
    } catch {
      return false;
    }
  }

  /** 安全扫描：插件文件中的危险模式检测（eval/exec/child_process 等）。 */
  private safetyScan(pluginDir: string): boolean {
    for (const file of collectSourceFiles(pluginDir)) {
      try {
        const content = readFileSync(file, 'utf-8');
        for (const pattern of DANGEROUS_PATTERNS) {
          if (content.includes(pattern)) {
            return false;
          }
        }
      } catch {
        continue;
      }
    }
    return true;
  }
}

/** 收集目录内源码文件（*.ts/*.js/*.mjs/*.cjs，排序保证 checksum 稳定）。 */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(full));
      } else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) {
        files.push(full);
      }
    }
  } catch {
    // 目录不可读——返回已收集部分
  }
  return files.sort();
}

/** "1.2.3" → [1, 2, 3]（非数字段截断为 0）。 */
function toTuple(version: string): number[] {
  return version.split('.').slice(0, 3).map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

/** 元组逐位比较（a >= b）。 */
function compareTuple(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) {
      return av > bv ? 1 : -1;
    }
  }
  return 0;
}

/**
 * 提取入口点的模块路径段（"module:Class" → module）。
 * 兼容 Windows 盘符路径（"C:\\a\\b.ts:Plugin" → "C:\\a\\b.ts"）。
 */
function extractModulePath(entryPoint: string): string | undefined {
  if (entryPoint.length === 0) {
    return undefined;
  }
  const firstColon = entryPoint.indexOf(':');
  if (firstColon === -1) {
    return entryPoint;
  }
  const hasDrivePrefix = /^[A-Za-z]:[\\/]/.test(entryPoint);
  if (hasDrivePrefix) {
    const secondColon = entryPoint.indexOf(':', firstColon + 1);
    return secondColon === -1
      ? entryPoint
      : entryPoint.slice(0, secondColon);
  }
  return entryPoint.slice(0, firstColon);
}
