/**
 * variable-resolver — 统一变量引用解析器（TS 重写自 `core/variable_resolver.py`，F27）。
 *
 * 将变量引用统一为 ${prefix.path} 格式：
 * - ${state.xxx}   — 工作流状态
 * - ${params.xxx}  — 输入参数
 * - ${result.xxx}  — 上一步执行结果
 * - ${outputs.xxx} — 指定步骤的输出
 * - ${config.xxx}  — 系统配置
 *
 * 向后兼容旧格式：{{state.xxx}} / $outputs.xxx / {output.xxx}。
 *
 * @module @flowforge/core-state
 */

// ── 正则模式 ──────────────────────────────────────────────────

// 新规范: ${prefix.path} 或 ${prefix.path[0].sub}
const CANONICAL_PATTERN = /\$\{(\w+)\.([\w.\[\]]+)\}/g;

// 旧格式兼容: {{state.xxx}}, {{auto.persona}}
const LEGACY_BRACE_PATTERN = /\{\{(\w+)\.([\w.\[\]]+)\}\}/g;

// 旧格式兼容: $outputs.xxx, $state.xxx（不带花括号）
const LEGACY_DOLLAR_PATTERN = /\$(outputs|state|params|result|config)\.([\w.\[\]]+)/g;

// 旧格式兼容: {output.xxx}（单花括号）
const LEGACY_SINGLE_BRACE_PATTERN = /\{(output|state|params|result)\.([\w.\[\]]+)\}/g;

// 前缀别名映射（旧 → 新）
const PREFIX_ALIASES: Record<string, string> = {
  output: 'outputs',
  auto: 'state', // auto.persona → state.persona（向后兼容）
};

/** 变量解析上下文：5 种前缀对应的数据源。 */
export interface ResolverContext {
  state?: Record<string, unknown>;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

/** 解析 ${prefix.path} 格式的变量引用。 */
export class VariableResolver {
  private readonly context: Record<string, unknown>;

  constructor(context: Record<string, unknown>) {
    this.context = context;
  }

  /**
   * 解析模板中的所有变量引用。
   * 按优先级：${prefix.path} → {{prefix.path}} → $prefix.path → {prefix.path}。
   * 未匹配的引用保持原样。
   */
  resolve(template: unknown): string {
    if (typeof template !== 'string') {
      return String(template);
    }
    let result = template.replace(CANONICAL_PATTERN, (match, prefix, path) =>
      this.replacer(match, prefix, path));
    result = result.replace(LEGACY_BRACE_PATTERN, (match, prefix, path) =>
      this.replacer(match, prefix, path));
    result = result.replace(LEGACY_DOLLAR_PATTERN, (match, prefix, path) =>
      this.replacer(match, prefix, path));
    result = result.replace(LEGACY_SINGLE_BRACE_PATTERN, (match, prefix, path) =>
      this.replacer(match, prefix, path));
    return result;
  }

  /**
   * 解析模板；若整个字符串是单个变量引用则保留原始类型。
   * 类似 workflow_compiler.interpolate_template 的类型保留行为。
   */
  resolveValue(template: unknown): unknown {
    if (typeof template !== 'string') {
      return template;
    }
    const trimmed = template.trim();
    const match = CANONICAL_PATTERN.exec(trimmed);
    if (match !== null && match[0] === trimmed) {
      const prefix = PREFIX_ALIASES[match[1]!] ?? match[1]!;
      const value = this.resolvePath(prefix, match[2]!);
      return value !== null && value !== undefined ? value : template;
    }
    return this.resolve(template);
  }

  /**
   * 解析 state_updates 配置中的表达式。
   * 支持简单比较表达式：${result.score < 70} → true/false。
   */
  resolveStateUpdates(
    updates: Record<string, string>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [key, expr] of Object.entries(updates)) {
      if (typeof expr === 'string') {
        resolved[key] = this.resolveExpression(expr);
      } else {
        resolved[key] = expr;
      }
    }
    return resolved;
  }

  /** 解析单个表达式，支持变量引用和简单比较运算。 */
  resolveExpression(expr: string): unknown {
    // 先尝试纯变量引用
    const value = this.resolveValue(expr);
    if (value !== expr) {
      return value;
    }

    // 尝试比较表达式：${result.score < 70}
    const comparisonOps = ['<=', '>=', '!=', '==', '>', '<'];
    for (const op of comparisonOps) {
      const parts = expr.split(op);
      if (parts.length === 2) {
        const leftRaw = parts[0]!.trim();
        const rightRaw = parts[1]!.trim();
        const left = this.resolveValue(leftRaw);
        const right = this.resolveValue(rightRaw);
        if (left !== leftRaw && right !== rightRaw) {
          try {
            return compare(left, right, op);
          } catch {
            // 类型不匹配 → 继续尝试其他操作符
          }
        }
      }
    }

    // 兜底：字符串替换
    return this.resolve(expr);
  }

  /** ${prefix.path} 格式的替换回调。 */
  private replacer(match: string, prefix: string, path: string): string {
    const mappedPrefix = PREFIX_ALIASES[prefix] ?? prefix;
    const value = this.resolvePath(mappedPrefix, path);
    return value !== null && value !== undefined ? String(value) : match;
  }

  /**
   * 按前缀查找值，支持嵌套路径和列表索引。
   *
   * @example
   * resolvePath('state', 'novel.chapters[0].title')
   */
  resolvePath(prefix: string, path: string): unknown {
    const source = this.context[prefix];
    if (source === null || source === undefined) {
      return null;
    }
    const parts = parsePath(path);
    let current: unknown = source;
    for (const part of parts) {
      if (current === null || current === undefined) {
        return null;
      }
      if (typeof part === 'number') {
        if (Array.isArray(current)) {
          current = part >= 0 && part < current.length ? current[part] : null;
        } else {
          return null;
        }
      } else if (
        typeof current === 'object' &&
        !Array.isArray(current) &&
        part in (current as Record<string, unknown>)
      ) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return null;
      }
    }
    return current;
  }
}

/** 执行比较运算。 */
function compare(left: unknown, right: unknown, op: string): boolean {
  switch (op) {
    case '<':
      return (left as number) < (right as number);
    case '<=':
      return (left as number) <= (right as number);
    case '>':
      return (left as number) > (right as number);
    case '>=':
      return (left as number) >= (right as number);
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    default:
      return false;
  }
}

/**
 * 将路径字符串解析为段列表。
 * "novel.chapters[0].title" → ["novel", "chapters", 0, "title"]
 * "items[0][1]" → ["items", 0, 1]
 */
function parsePath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const tokens = path.match(/[^.\[\]]+|\[\d+\]/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('[') && token.endsWith(']')) {
      const index = Number.parseInt(token.slice(1, -1), 10);
      segments.push(Number.isNaN(index) ? token : index);
    } else {
      segments.push(token);
    }
  }
  return segments;
}

/** 从常见上下文组件创建 VariableResolver 的便捷工厂。 */
export function createResolverFromState(
  state: Record<string, unknown>,
  params: Record<string, unknown> = {},
  result: Record<string, unknown> = {},
  outputs: Record<string, unknown> = {},
  config: Record<string, unknown> = {},
): VariableResolver {
  return new VariableResolver({
    state,
    params,
    result,
    outputs,
    config,
  });
}
