/**
 * @flowforge/forgekin-app — 配置加载（对齐 `forgemind/config` 模式）
 *
 * ForgeMind 应用层依赖配置驱动（铁律5+P16）：
 *   - config/auto-forge.yaml — 自我进化配置（F100 Mode A/B/C）
 *
 * 内置 YAML 随包发布（`packages/forgekin/app/config/`），缺省从包内加载；
 * 文件不存在时抛错（对齐 Python FileNotFoundError 语义）。
 *
 * @module @flowforge/forgekin-app/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** 内置配置目录（包根下 `config/`，相对本文件定位，src 与 lib 布局均可解析） */
export function builtinConfigDir(): string {
  return fileURLToPath(new URL('../config/', import.meta.url));
}

/** 内置 auto-forge.yaml 绝对路径 */
export function builtinAutoForgeYamlPath(): string {
  return fileURLToPath(new URL('../config/auto-forge.yaml', import.meta.url));
}

function readYamlOrThrow(yamlPath: string, usage: string): Record<string, unknown> {
  if (!existsSync(yamlPath)) {
    throw new Error(`配置文件不存在: ${yamlPath}（${usage}，铁律5+P16）。`);
  }
  const raw = readFileSync(yamlPath, 'utf-8');
  const data = parseYaml(raw);
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

/**
 * 加载 ForgeMind 自动锻造配置（auto-forge.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/auto-forge.yaml`。
 * @throws 文件不存在时抛错（配置驱动，禁止降级为硬编码）。
 */
export function loadAutoForgeConfig(yamlPath: string = builtinAutoForgeYamlPath()): Record<string, unknown> {
  return readYamlOrThrow(yamlPath, 'ForgeMind 自动锻造依赖配置驱动');
}
