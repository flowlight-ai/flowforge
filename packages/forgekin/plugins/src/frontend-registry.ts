/**
 * frontend-registry — FrontendPluginRegistry 前端插件注册表（T7.11/F11，
 * 对齐 `core/plugin_frontend.py`）。
 *
 * 追踪哪些插件提供前端组件及挂载点，供 Next.js 前端动态加载：
 * manifest 声明 frontend_entry + mount_points，服务端暴露元数据。
 *
 * @module @flowforge/forgekin-plugins
 */

import type { FrontendPluginEntry, PluginManifest } from './types.js';

/** 标准前端挂载点（对齐 Python 常量）。 */
export const MOUNT_POINTS = {
  SIDEBAR: 'sidebar',
  TOOLBAR: 'toolbar',
  SETTINGS: 'settings',
  DASHBOARD: 'dashboard',
  TASK_PANEL: 'task_panel',
  REVIEW_PANEL: 'review_panel',
} as const;

/**
 * FrontendPluginRegistry — 前端插件组件注册表。
 *
 * 仅注册声明了 frontend_entry 的清单（无前端入口的插件跳过，对齐 Python）。
 */
export class FrontendPluginRegistry {
  private readonly plugins = new Map<string, FrontendPluginEntry>();

  /** 注册插件的前端元数据（无 frontend_entry 时跳过）。 */
  register(pluginName: string, manifest: PluginManifest): void {
    const frontendEntry = manifest.frontend_entry ?? '';
    const mountPoints = manifest.mount_points ?? [];
    if (frontendEntry.length === 0) {
      return;
    }
    this.plugins.set(pluginName, {
      name: pluginName,
      entry: frontendEntry,
      mount_points: mountPoints,
      version: manifest.version ?? '0.1.0',
    });
  }

  /** 注销插件的前端元数据。 */
  unregister(pluginName: string): void {
    this.plugins.delete(pluginName);
  }

  /** 获取提供指定挂载点组件的全部插件。 */
  getPluginsForMount(mountPoint: string): FrontendPluginEntry[] {
    return [...this.plugins.values()].filter((p) =>
      p.mount_points.includes(mountPoint),
    );
  }

  /** 获取全部已注册前端插件。 */
  getAllPlugins(): FrontendPluginEntry[] {
    return [...this.plugins.values()];
  }

  /** 获取指定插件的前端元数据（未注册返回 undefined）。 */
  getPlugin(pluginName: string): FrontendPluginEntry | undefined {
    return this.plugins.get(pluginName);
  }

  /** 已注册前端插件数。 */
  get size(): number {
    return this.plugins.size;
  }
}
