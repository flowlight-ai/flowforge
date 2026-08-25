/**
 * registry — MarketplaceRegistry 插件注册表（T7.11/F11，对齐 `core/marketplace.py`）。
 *
 * 管理插件清单集合：本地 YAML 目录（config/marketplace/*.yaml）+ 内置注册表 +
 * 可选远程 registry URL 刷新（Node 全局 fetch）。
 *
 * @module @flowforge/forgekin-plugins
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  PluginCategory,
  PluginManifest,
  RegistryRefreshResult,
} from './types.js';
import { BUILTIN_REGISTRY_PLUGINS } from './types.js';

/** MarketplaceRegistry 构造选项。 */
export interface RegistryOptions {
  /** 本地注册表目录（含 plugins 列表的 *.yaml/*.yml），缺省仅加载内置注册表。 */
  registryPath?: string;
  /** 远程注册表 URL（refreshRegistry 时拉取）。 */
  remoteUrl?: string;
}

/** 注册表数据文件结构（对齐 registry.yaml：顶层 plugins 列表）。 */
interface RegistryFileData {
  plugins?: unknown[];
}

/**
 * MarketplaceRegistry — 插件注册表（本地 YAML + 内置 + 远程刷新）。
 *
 * 内置注册表对齐 `config/marketplace/registry.yaml`（flowforge-web-search /
 * flowforge-mcp-bridge 全量内嵌）；传入 registryPath 时合并外部 YAML 目录，
 * 同名插件以外部为准。
 */
export class MarketplaceRegistry {
  private readonly registryPath: string | undefined;
  private readonly plugins = new Map<string, PluginManifest>();
  private remoteUrl: string | undefined;
  private loaded = false;

  constructor(options: RegistryOptions = {}) {
    this.registryPath = options.registryPath;
    this.remoteUrl = options.remoteUrl;
  }

  /** 首次访问时惰性加载注册表（内置 + 本地目录）。 */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.loadLocalRegistry();
    this.loaded = true;
  }

  /** 加载内置注册表 + 外部 YAML 目录（目录不存在时仅内置，对齐 Python warning 语义）。 */
  async loadLocalRegistry(): Promise<void> {
    for (const manifest of BUILTIN_REGISTRY_PLUGINS) {
      this.plugins.set(manifest.name, manifest);
    }
    if (this.registryPath === undefined) {
      return;
    }
    let files: string[];
    try {
      files = readdirSync(this.registryPath).filter((f) =>
        f.endsWith('.yaml') || f.endsWith('.yml'),
      );
    } catch {
      // 注册表目录不存在——仅内置（对齐 Python：warning 后继续）
      return;
    }
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.registryPath, file), 'utf-8');
        const data = parseYaml(raw) as RegistryFileData | null;
        const pluginList = data?.plugins ?? [];
        for (const pluginData of pluginList) {
          const manifest = normalizeManifest(pluginData);
          this.plugins.set(manifest.name, manifest);
        }
      } catch {
        // 单个 YAML 文件解析失败——跳过（对齐 Python：error 后继续）
      }
    }
  }

  /** 按关键字（name/display_name/description/tags）与可选分类搜索。 */
  async search(
    query: string,
    category?: PluginCategory,
  ): Promise<PluginManifest[]> {
    await this.ensureLoaded();
    const queryLower = query.toLowerCase();
    const results: PluginManifest[] = [];
    for (const manifest of this.plugins.values()) {
      if (category !== undefined && manifest.category !== category) {
        continue;
      }
      const searchable = [
        manifest.name,
        manifest.display_name ?? '',
        manifest.description ?? '',
        ...(manifest.tags ?? []),
      ].join(' ').toLowerCase();
      if (queryLower.length === 0 || searchable.includes(queryLower)) {
        results.push(manifest);
      }
    }
    return results;
  }

  /** 按名获取插件清单（不存在返回 undefined）。 */
  async getPlugin(name: string): Promise<PluginManifest | undefined> {
    await this.ensureLoaded();
    return this.plugins.get(name);
  }

  /** 列出全部插件（可选按分类过滤）。 */
  async listPlugins(
    category?: PluginCategory,
  ): Promise<PluginManifest[]> {
    await this.ensureLoaded();
    const all = [...this.plugins.values()];
    if (category === undefined) {
      return all;
    }
    return all.filter((m) => m.category === category);
  }

  /** 注册表插件总数。 */
  get size(): number {
    return this.plugins.size;
  }

  /**
   * 配置远程注册表 URL（refreshRegistry 时拉取）。
   * 对齐 Python：fetch JSON `{ plugins: [...] }`，同名插件按版本覆盖。
   */
  setRemoteUrl(url: string): void {
    this.remoteUrl = url;
  }

  /** 从远程注册表刷新（未配置远程 URL 时返回 skipped，对齐 Python）。 */
  async refreshRegistry(): Promise<RegistryRefreshResult> {
    await this.ensureLoaded();
    if (this.remoteUrl === undefined) {
      return {
        status: 'skipped',
        reason: 'no_remote_configured',
        total_plugins: this.plugins.size,
      };
    }
    try {
      const resp = await fetch(this.remoteUrl);
      if (!resp.ok) {
        return { status: 'error', reason: `HTTP ${resp.status}` };
      }
      const data = (await resp.json()) as { plugins?: unknown[] };
      let added = 0;
      let updated = 0;
      for (const pluginData of data.plugins ?? []) {
        const manifest = normalizeManifest(pluginData);
        const existing = this.plugins.get(manifest.name);
        if (existing !== undefined && existing.version !== manifest.version) {
          updated += 1;
        } else if (existing === undefined) {
          added += 1;
        }
        this.plugins.set(manifest.name, manifest);
      }
      return {
        status: 'refreshed',
        added,
        updated,
        total_plugins: this.plugins.size,
      };
    } catch (e) {
      return {
        status: 'error',
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

/** 规范化外部清单数据 → PluginManifest（默认值对齐 Python pydantic 模型）。 */
function normalizeManifest(data: unknown): PluginManifest {
  if (typeof data !== 'object' || data === null) {
    throw new Error('invalid manifest: not an object');
  }
  const raw = data as Record<string, unknown>;
  if (typeof raw['name'] !== 'string' || raw['name'].length === 0) {
    throw new Error('invalid manifest: missing name');
  }
  return {
    name: raw['name'],
    display_name: strOr(raw['display_name'], ''),
    description: strOr(raw['description'], ''),
    version: strOr(raw['version'], '1.0.0'),
    author: strOr(raw['author'], ''),
    category: (raw['category'] as PluginCategory | undefined) ?? 'tool',
    tags: Array.isArray(raw['tags'])
      ? (raw['tags'] as string[])
      : [],
    homepage: nullishStr(raw['homepage']),
    repository: nullishStr(raw['repository']),
    license: strOr(raw['license'], 'MIT'),
    min_flowforge_version: nullishStr(raw['min_flowforge_version']),
    dependencies: Array.isArray(raw['dependencies'])
      ? (raw['dependencies'] as string[])
      : [],
    permissions: Array.isArray(raw['permissions'])
      ? (raw['permissions'] as string[])
      : [],
    entry_point: strOr(raw['entry_point'], ''),
    checksum: nullishStr(raw['checksum']),
    frontend_entry: strOr(raw['frontend_entry'], ''),
    mount_points: Array.isArray(raw['mount_points'])
      ? (raw['mount_points'] as string[])
      : [],
  };
}

function strOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullishStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
