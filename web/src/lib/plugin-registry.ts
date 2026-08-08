/**
 * FlowForge Plugin Registry — dynamic component loading for frontend plugins.
 *
 * Plugins can declare a ``frontend_entry`` and ``mount_points`` in their
 * PluginManifest.  The web UI uses PluginRegistry to discover and render
 * these plugin components at the declared mount points.
 *
 * Usage:
 *   1. Fetch plugin metadata from ``GET /api/v1/plugins/{name}/frontend``
 *   2. Register the plugin via ``PluginRegistry.registerPlugin(name, meta)``
 *   3. Load the frontend_entry module (e.g., dynamic import)
 *   4. Register components via ``PluginRegistry.registerComponent(mountPoint, Component)``
 *   5. In the shell, use ``PluginRegistry.getComponent(mountPoint)`` to render
 */

import type { ComponentType } from "react";

/** Plugin frontend metadata — mirrors backend PluginManifest fields. */
export interface PluginFrontendMeta {
  name: string;
  version: string;
  frontend_entry: string;
  mount_points: string[];
}

/**
 * Static registry for plugin components.
 *
 * Plugins register their React components at named mount points.
 * The shell or other UI components look up components by mount point name.
 */
export class PluginRegistry {
  private static _components: Map<string, ComponentType> = new Map();
  private static _plugins: Map<string, PluginFrontendMeta> = new Map();

  /** Register a React component at a named mount point. */
  static registerComponent(mountPoint: string, component: ComponentType): void {
    this._components.set(mountPoint, component);
  }

  /** Get the component registered at a mount point, if any. */
  static getComponent(mountPoint: string): ComponentType | undefined {
    return this._components.get(mountPoint);
  }

  /** Register a plugin's frontend metadata. */
  static registerPlugin(name: string, meta: PluginFrontendMeta): void {
    this._plugins.set(name, meta);
  }

  /** Get a plugin's frontend metadata by name. */
  static getPlugin(name: string): PluginFrontendMeta | undefined {
    return this._plugins.get(name);
  }

  /** Get all registered plugin metadata. */
  static getAllPlugins(): Map<string, PluginFrontendMeta> {
    return this._plugins;
  }

  /** Clear all registered components and plugins (useful for testing). */
  static clear(): void {
    this._components.clear();
    this._plugins.clear();
  }
}
