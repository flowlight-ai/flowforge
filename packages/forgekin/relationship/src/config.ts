/**
 * @flowforge/forgekin-relationship — 配置加载（对齐 `forgemind/config` 模式）
 *
 * Forge Relationship 依赖配置驱动（铁律5+P16）：
 *   - config/forge-relationship.yaml — 承载层注册表 + 跨层迁移规则
 *     （evolve: min_eval_score=0.85 / min_task_count=5 / operator 审批；
 *      reclaim: 仅蒸馏通用能力 / 垂直能力保留原层 / operator 审批）
 *
 * 内置 YAML 随包发布（`packages/forgekin/relationship/config/`），缺省从包内
 * 加载；文件不存在时抛错（对齐 Python FileNotFoundError 语义）。
 *
 * @module @flowforge/forgekin-relationship/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** 内置配置目录（包根下 `config/`，相对本文件定位，src 与 lib 布局均可解析） */
export function builtinConfigDir(): string {
  return fileURLToPath(new URL('../config/', import.meta.url));
}

/** 内置 forge-relationship.yaml 绝对路径 */
export function builtinRelationshipYamlPath(): string {
  return fileURLToPath(new URL('../config/forge-relationship.yaml', import.meta.url));
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
 * 加载 Forge Relationship 配置（forge-relationship.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/forge-relationship.yaml`。
 * @throws 文件不存在时抛错（配置驱动，禁止降级为硬编码）。
 */
export function loadRelationshipConfig(yamlPath: string = builtinRelationshipYamlPath()): Record<string, unknown> {
  return readYamlOrThrow(yamlPath, 'Forge Relationship 依赖配置驱动');
}
