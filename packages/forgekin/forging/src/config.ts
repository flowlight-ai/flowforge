/**
 * @flowforge/forgekin-forging — 配置加载（对齐 `forgemind/forging/pipeline.py:_load_yaml`）
 *
 * Forge Nurturing 流水线依赖配置驱动（铁律5+P16）：
 *   - config/forging.yaml — 阶段参数 / 质量分阈值 / 价值锚点默认清单 / 形态工厂谱系
 *   - config/prompts.yaml — 六阶段提示词模板（占位符 {requirement} 等）
 *
 * 内置 YAML 随包发布（`packages/forgekin/forging/config/`），缺省从包内
 * 加载；文件不存在时抛错（对齐 Python FileNotFoundError 语义）。
 *
 * @module @flowforge/forgekin-forging/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** 内置配置目录（包根下 `config/`，相对本文件定位，src 与 lib 布局均可解析） */
export function builtinConfigDir(): string {
  return fileURLToPath(new URL('../config/', import.meta.url));
}

/** 内置 forging.yaml 绝对路径 */
export function builtinForgingYamlPath(): string {
  return fileURLToPath(new URL('../config/forging.yaml', import.meta.url));
}

/** 内置 prompts.yaml 绝对路径 */
export function builtinPromptsYamlPath(): string {
  return fileURLToPath(new URL('../config/prompts.yaml', import.meta.url));
}

function readYamlOrThrow(yamlPath: string, usage: string): Record<string, unknown> {
  if (!existsSync(yamlPath)) {
    throw new Error(`配置文件不存在: ${yamlPath}。${usage}（铁律5+P16）。`);
  }
  const raw = readFileSync(yamlPath, 'utf-8');
  const data = parseYaml(raw);
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

/**
 * 加载 Forge Nurturing 配置（forging.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/forging.yaml`。
 * @throws 文件不存在时抛错（配置驱动，禁止降级为硬编码）。
 */
export function loadForgingConfig(yamlPath: string = builtinForgingYamlPath()): Record<string, unknown> {
  return readYamlOrThrow(yamlPath, 'Forge Nurturing流水线依赖配置驱动');
}

/**
 * 加载锻造提示词配置（prompts.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/prompts.yaml`。
 * @throws 文件不存在时抛错（铁律5+P16：禁止硬编码）。
 */
export function loadPromptsConfig(yamlPath: string = builtinPromptsYamlPath()): Record<string, unknown> {
  return readYamlOrThrow(yamlPath, 'Forge Nurturing流水线依赖配置驱动');
}
