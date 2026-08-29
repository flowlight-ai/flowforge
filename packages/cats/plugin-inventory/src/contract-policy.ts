/**
 * @flowforge/cats-plugin-inventory — C30 contract-policy（契约策略）
 *
 * TS 移植：clowder-ai `domains/plugin/host-inventory/contract-policy.ts`。
 * Host 钉死的契约版本 + 能力规范化（去重排序）。
 */

import type { Capability, PluginManifest } from './contract.js';

export const PLUGIN_CONTRACT_VERSION = '0.1.0-beta.7' as const;

export function canonicalCapabilities(values: readonly Capability[]): Capability[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function requestedCapabilitiesForManifest(manifest: PluginManifest): Capability[] {
  return canonicalCapabilities(manifest.features.flatMap((feature) => [...feature.capabilities]));
}
