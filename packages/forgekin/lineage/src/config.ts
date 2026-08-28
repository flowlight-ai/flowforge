/**
 * @flowforge/forgekin-lineage — 配置加载（对齐 `forgemind/config` 模式）
 *
 * Forgekin Lineage 依赖配置驱动（铁律5+P16）：
 *   - config/forgekin-lineage.yaml — 谱系存储后端 / 分裂规则
 *     （max_children_per_split=5 / operator 审批）/ 融合规则
 *     （max_parents_per_fuse=3 / weighted_by_performance）/ 查询深度 / 审计策略
 *
 * 内置 YAML 随包发布（`packages/forgekin/lineage/config/`），缺省从包内
 * 加载；文件不存在时抛错（对齐 Python FileNotFoundError 语义）。
 *
 * @module @flowforge/forgekin-lineage/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** 内置配置目录（包根下 `config/`，相对本文件定位，src 与 lib 布局均可解析） */
export function builtinConfigDir(): string {
  return fileURLToPath(new URL('../config/', import.meta.url));
}

/** 内置 forgekin-lineage.yaml 绝对路径 */
export function builtinLineageYamlPath(): string {
  return fileURLToPath(new URL('../config/forgekin-lineage.yaml', import.meta.url));
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
 * 加载 Forgekin Lineage 配置（forgekin-lineage.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/forgekin-lineage.yaml`。
 * @throws 文件不存在时抛错（配置驱动，禁止降级为硬编码）。
 */
export function loadLineageConfig(yamlPath: string = builtinLineageYamlPath()): Record<string, unknown> {
  return readYamlOrThrow(yamlPath, 'Forgekin Lineage 依赖配置驱动');
}
