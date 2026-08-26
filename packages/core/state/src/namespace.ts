/**
 * namespace — Agent 命名空间规范（TS 重写自 `core/namespace.py`，F27）。
 *
 * 提供命名空间前缀解析和转换的通用工具；各项目通过注册自己的
 * 命名空间映射使用（DevForge/ContentForge 等）。
 *
 * @module @flowforge/core-state
 */

/** 项目命名空间注册表（各项目初始化时注册自己的映射）。 */
const namespaceRegistry = new Map<string, Map<string, string>>();

/** 默认命名空间前缀。 */
export const NAMESPACE_PREFIX = 'flowforge';

/** 注册项目的命名空间映射。 */
export function registerNamespace(
  project: string,
  agentMap: Record<string, string>,
): void {
  namespaceRegistry.set(project, new Map(Object.entries(agentMap)));
}

/**
 * 解析 Agent 名称，支持带命名空间和不带命名空间两种格式。
 *
 * @example
 * resolveAgentName('devforge:coder') // → 'coder'
 * resolveAgentName('coder')          // → 'coder'
 */
export function resolveAgentName(name: string): string {
  if (!name.includes(':')) {
    return name;
  }
  for (const agentMap of namespaceRegistry.values()) {
    const mapped = agentMap.get(name);
    if (mapped !== undefined) {
      return mapped;
    }
  }
  // 未找到则去掉前缀返回（对齐 Python name.split(":", 1)[1]）
  return name.split(':')[1] ?? name;
}

/**
 * 将本地名称转换为命名空间格式。
 *
 * @example
 * toNamespaceName('coder')                     // → 'flowforge:coder'
 * toNamespaceName('coder', { project: 'devforge' }) // → 'devforge:coder'
 */
export function toNamespaceName(
  localName: string,
  project?: string,
): string {
  const prefix = project || NAMESPACE_PREFIX;
  return `${prefix}:${localName}`;
}

/** 获取指定项目的命名空间映射。 */
export function getNamespaceMap(project: string): Record<string, string> {
  return Object.fromEntries(namespaceRegistry.get(project) ?? new Map());
}

/** 获取所有已注册的命名空间映射。 */
export function getAllNamespaces(): Record<string, Record<string, string>> {
  const all: Record<string, Record<string, string>> = {};
  for (const [project, agentMap] of namespaceRegistry) {
    all[project] = Object.fromEntries(agentMap);
  }
  return all;
}
