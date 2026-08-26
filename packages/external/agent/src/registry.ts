/**
 * @flowforge/external-agent registry — ProviderTransportRegistry（F241 CL-014）。
 *
 * TS 重写自 flowforge/core/external_agent/registry.py：
 *   - register：重复注册抛错
 *   - discover(capability)：按能力过滤
 *   - get / list_all / list_provider_names / unregister
 *   - loadFromDir：YAML glob + 已存在则覆盖
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentProviderManifest,
  loadManifestFromYaml,
} from './manifest.js';

/** 重复注册错误。 */
export class ProviderAlreadyRegisteredError extends Error {}

/** Provider 注册表（registry.py ProviderTransportRegistry）。 */
export class ProviderTransportRegistry {
  private readonly _manifests = new Map<string, AgentProviderManifest>();

  /** 注册 Provider（重复注册抛 ProviderAlreadyRegisteredError）。 */
  register(manifest: AgentProviderManifest): void {
    if (this._manifests.has(manifest.provider_name)) {
      throw new ProviderAlreadyRegisteredError(
        `provider already registered: ${manifest.provider_name}`,
      );
    }
    this._manifests.set(manifest.provider_name, manifest);
  }

  /** 按能力发现 Provider（registry.py discover）。 */
  discover(capability: string): AgentProviderManifest[] {
    return [...this._manifests.values()].filter((manifest) =>
      manifest.capabilities.includes(capability),
    );
  }

  /** 按名称获取 Manifest（未注册返回 undefined）。 */
  get(providerName: string): AgentProviderManifest | undefined {
    return this._manifests.get(providerName);
  }

  /** 列出全部 Manifest（按注册顺序）。 */
  listAll(): AgentProviderManifest[] {
    return [...this._manifests.values()];
  }

  /** 列出全部 Provider 名称。 */
  listProviderNames(): string[] {
    return [...this._manifests.keys()];
  }

  /** 注销 Provider（返回是否曾注册）。 */
  unregister(providerName: string): boolean {
    return this._manifests.delete(providerName);
  }

  /**
   * 从目录加载全部 Manifest（registry.py load_from_dir 语义）：
   * 已存在的 Provider 覆盖注册（不抛错）；返回覆盖的 provider_name 列表。
   */
  loadFromDir(dirPath: string): { loaded: string[]; overridden: string[] } {
    const loaded: string[] = [];
    const overridden: string[] = [];
    const files = readdirSync(dirPath)
      .filter((name) => name.endsWith('.yaml'))
      .sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      const manifest = loadManifestFromYaml(join(dirPath, file));
      if (this._manifests.has(manifest.provider_name)) {
        overridden.push(manifest.provider_name);
      }
      // 覆盖注册：先删后加（保持顺序稳定）
      this._manifests.delete(manifest.provider_name);
      this._manifests.set(manifest.provider_name, manifest);
      loaded.push(manifest.provider_name);
    }
    return { loaded, overridden };
  }

  /** 已注册 Provider 数量。 */
  get size(): number {
    return this._manifests.size;
  }
}
