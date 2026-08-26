/**
 * @flowforge/llm-route — 配置加载（对齐 Python `config/llm_route.yaml` 语义）
 *
 * F28 配置驱动：路由定义 / Agent 映射 / 故障转移条件全部外置 YAML（铁律5），
 * 内置 YAML 随包发布（`packages/llm/route/config/`），缺省从包内加载；
 * 文件不存在时抛错（对齐 Python FileNotFoundError 语义）。
 *
 * @module @flowforge/llm-route/config
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** 内置配置目录（包根下 `config/`，相对本文件定位，src 与 lib 布局均可解析） */
export function builtinConfigDir(): string {
  return fileURLToPath(new URL('../config/', import.meta.url));
}

/** 内置 llm-route.yaml 绝对路径 */
export function builtinLlmRouteYamlPath(): string {
  return fileURLToPath(new URL('../config/llm-route.yaml', import.meta.url));
}

function readYamlOrThrow(yamlPath: string, usage: string): Record<string, unknown> {
  if (!existsSync(yamlPath)) {
    throw new Error(
      `llm-route: 配置文件不存在: ${yamlPath}。${usage}（F28 配置驱动，禁止硬编码降级）`,
    );
  }
  const parsed = parseYaml(readFileSync(yamlPath, 'utf-8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`llm-route: 配置文件格式错误（应为映射）: ${yamlPath}`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * 加载 LLM 路由配置（llm-route.yaml）。
 *
 * @param yamlPath - 缺省用内置 `config/llm-route.yaml`。
 * @throws 文件不存在时抛错（配置驱动，禁止降级为硬编码）。
 */
export function loadLlmRouteConfig(
  yamlPath: string = builtinLlmRouteYamlPath(),
): Record<string, unknown> {
  return readYamlOrThrow(yamlPath, 'LLM 路由依赖配置驱动');
}

/**
 * 将配置对象按路由段拆解（供 RouteResolver.loadRoutesFromConfig 使用）。
 *
 * @param config - loadLlmRouteConfig 的返回值。
 */
export function extractRouteSections(
  config: Record<string, unknown>,
): {
  routes: Record<string, unknown>;
  agentRoutes: Record<string, unknown>;
  agentModelParams: Record<string, unknown>;
  failoverConditions: Record<string, unknown>;
} {
  return {
    routes: isRecord(config['routes']) ? config['routes'] : {},
    agentRoutes: isRecord(config['agent_routes']) ? config['agent_routes'] : {},
    agentModelParams: isRecord(config['agent_model_params'])
      ? config['agent_model_params']
      : {},
    failoverConditions: isRecord(config['failover_conditions'])
      ? config['failover_conditions']
      : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
