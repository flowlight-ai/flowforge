/**
 * service — MarketplaceService（T7.11/F11 插件市场统一入口）。
 *
 * 聚合三组件挂载 `ctx.forgePlugins`（Cordis 插件）：
 *   marketplace（MarketplaceRegistry + Marketplace 安装/卸载/更新/验证）
 *   frontendRegistry（前端插件六挂载点注册表）
 *
 * @module @flowforge/forgekin-plugins
 */

import { Service, type Context } from '@flowforge/cordis';
import {
  FrontendPluginRegistry,
  MOUNT_POINTS,
} from './frontend-registry.js';
import { Marketplace, type MarketplaceOptions } from './marketplace.js';
import type {
  FrontendPluginEntry,
  MarketplaceResult,
  PluginCategory,
  PluginManifest,
  RegistryRefreshResult,
} from './types.js';

declare module '@flowforge/cordis' {
  interface Context {
    forgePlugins: MarketplaceService;
  }
}

/** Forgekin 插件市场服务构造选项（对齐 MarketplaceOptions）。 */
export type ForgePluginsOptions = MarketplaceOptions;

/** 插件市场服务——插件发现/安装/验证/前端注册统一入口（ctx.forgePlugins）。 */
export class MarketplaceService extends Service {
  /** 市场核心（注册表 + 安装/卸载/更新/验证）。 */
  readonly marketplace: Marketplace;
  /** 前端插件注册表（六挂载点）。 */
  readonly frontendRegistry: FrontendPluginRegistry;
  /** 标准前端挂载点常量。 */
  static readonly mountPoints = MOUNT_POINTS;

  constructor(ctx: Context, options: ForgePluginsOptions = {}) {
    super(ctx, 'forgePlugins');
    this.marketplace = new Marketplace(options);
    this.frontendRegistry = new FrontendPluginRegistry();
  }

  // ── 市场发现 ─────────────────────────────────────────────────────

  /** 搜索市场插件（name/display_name/description/tags + 可选分类）。 */
  search(
    query: string,
    category?: PluginCategory,
  ): Promise<PluginManifest[]> {
    return this.marketplace.search(query, category);
  }

  /** 获取插件详情。 */
  getPlugin(name: string): Promise<PluginManifest | undefined> {
    return this.marketplace.getPlugin(name);
  }

  /** 列出注册表全部插件（可选按分类过滤）。 */
  listPlugins(category?: PluginCategory): Promise<PluginManifest[]> {
    return this.marketplace.listPlugins(category);
  }

  // ── 市场生命周期 ─────────────────────────────────────────────────

  /** 一键安装（依赖递归/版本兼容/checksum/持久化）。 */
  install(name: string, version?: string): Promise<MarketplaceResult> {
    return this.marketplace.install(name, version);
  }

  /** 卸载（依赖者保护）。 */
  uninstall(name: string): Promise<MarketplaceResult> {
    return this.marketplace.uninstall(name);
  }

  /** 列出已安装插件。 */
  listInstalled(): Promise<PluginManifest[]> {
    return this.marketplace.listInstalled();
  }

  /** 已安装检查。 */
  isInstalled(name: string): Promise<boolean> {
    return this.marketplace.isInstalled(name);
  }

  /** 更新到最新版本。 */
  update(name: string): Promise<MarketplaceResult> {
    return this.marketplace.update(name);
  }

  /** 完整性验证（文件/入口点/checksum/安全扫描）。 */
  verify(name: string): Promise<MarketplaceResult> {
    return this.marketplace.verify(name);
  }

  // ── 注册表管理 ───────────────────────────────────────────────────

  /** 刷新注册表（远程 URL 已配置时拉取）。 */
  refreshRegistry(): Promise<RegistryRefreshResult> {
    return this.marketplace.refreshRegistry();
  }

  /** 配置远程注册表 URL。 */
  setRemoteUrl(url: string): void {
    this.marketplace.setRemoteUrl(url);
  }

  // ── 前端插件注册表 ───────────────────────────────────────────────

  /** 注册插件前端元数据（无 frontend_entry 跳过）。 */
  registerFrontend(pluginName: string, manifest: PluginManifest): void {
    this.frontendRegistry.register(pluginName, manifest);
  }

  /** 注销插件前端元数据。 */
  unregisterFrontend(pluginName: string): void {
    this.frontendRegistry.unregister(pluginName);
  }

  /** 获取指定挂载点的前端插件列表。 */
  getFrontendPluginsForMount(mountPoint: string): FrontendPluginEntry[] {
    return this.frontendRegistry.getPluginsForMount(mountPoint);
  }

  /** 获取全部前端插件。 */
  getAllFrontendPlugins(): FrontendPluginEntry[] {
    return this.frontendRegistry.getAllPlugins();
  }

  /** 快照：注册表/已安装/前端注册统计。 */
  async snapshot(): Promise<{
    registry_total: number;
    installed: string[];
    frontend_plugins: string[];
  }> {
    const registryPlugins = await this.marketplace.listPlugins();
    const installed = await this.marketplace.listInstalled();
    return {
      registry_total: registryPlugins.length,
      installed: installed.map((m) => m.name),
      frontend_plugins: this.frontendRegistry
        .getAllPlugins()
        .map((p) => p.name),
    };
  }
}

/** Cordis 插件默认导出：同步赋值挂载 ctx.forgePlugins。 */
export default function Plugin(
  ctx: Context,
  options: ForgePluginsOptions = {},
): void {
  ctx.forgePlugins = new MarketplaceService(ctx, options);
}
