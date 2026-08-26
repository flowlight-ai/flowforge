/**
 * @flowforge/external-agent config — YAML 配置加载（铁律 5 配置驱动）。
 *
 * 对应 flowforge/core/external_agent/config/*.yaml：
 *   - adapters.yaml: adapter_mapping / default_adapter / load_strategy
 *   - fallback.yaml: default_chain / per_capability_chains / retry /
 *     fallback_triggers / internal_fallback
 *   - prompts.yaml: system_prompt.boundary_template / adapter_prompts /
 *     discovery_prompt / fusion_prompt
 *   - tool_allowlist.yaml: default_allowed / default_forbidden / per_provider /
 *     requires_confirmation
 *   - manifests/*.yaml: 4 个 Provider Manifest
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** 包内 config 目录（随包发布）。 */
export const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');

/** 加载 YAML 配置（解析失败抛 Error）。 */
export function loadYamlConfig(relativePath: string): Record<string, unknown> {
  const text = readFileSync(join(CONFIG_DIR, relativePath), 'utf-8');
  const data = parse(text);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Invalid yaml config: ${relativePath}`);
  }
  return data as Record<string, unknown>;
}

/** 加载 fallback.yaml。 */
export function loadFallbackConfig(): Record<string, unknown> {
  return loadYamlConfig('fallback.yaml');
}

/** 加载 adapters.yaml。 */
export function loadAdaptersConfig(): Record<string, unknown> {
  return loadYamlConfig('adapters.yaml');
}

/** 加载 prompts.yaml。 */
export function loadPromptsConfig(): Record<string, unknown> {
  return loadYamlConfig('prompts.yaml');
}

/** 加载 tool_allowlist.yaml。 */
export function loadToolAllowlistConfig(): Record<string, unknown> {
  return loadYamlConfig('tool_allowlist.yaml');
}

/** 加载 manifests 目录（返回全部 Manifest 数据）。 */
export function loadManifestsConfig(): Record<string, unknown>[] {
  const dirPath = join(CONFIG_DIR, 'manifests');
  const files = ['claude_code.yaml', 'codex.yaml', 'opencode.yaml', 'trae.yaml'];
  return files.map((file) => {
    const text = readFileSync(join(dirPath, file), 'utf-8');
    const data = parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error(`Invalid manifest yaml: ${file}`);
    }
    return data as Record<string, unknown>;
  });
}
