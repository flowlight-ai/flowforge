/**
 * trace-tree-utils — Trace Span 树构建与扁平化工具
 *
 * 提供 TraceSpan / SpanNode 类型 + buildForest / flattenForest 工具。
 *
 * 独立性：不依赖任何外部模块，可直接用于单元测试。
 */

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  durationMs: number;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  startTimeMs: number;
  endTimeMs: number;
  events: ReadonlyArray<{
    name: string;
    timeMs: number;
    attributes?: Record<string, unknown>;
  }>;
}

export interface SpanNode {
  span: TraceSpan;
  children: SpanNode[];
  depth: number;
}

/**
 * 根据 spans 构建 forest（多根树）。
 *
 * 规则：
 *   - parentSpanId 不存在 / 指向自身 / 指向不存在的 span → root
 *   - 同父节点下子节点按 startTimeMs 升序
 *   - 多个 root 按 startTimeMs 升序
 *   - 兜底：未访问到的 span（如孤立环）也作为 root 加入
 *
 * 防御：使用 visited Set 避免循环引用导致的无限递归。
 */
export function buildForest(spans: TraceSpan[]): SpanNode[] {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const childMap = new Map<string, TraceSpan[]>();
  const roots: TraceSpan[] = [];

  for (const span of spans) {
    if (
      span.parentSpanId &&
      span.parentSpanId !== span.spanId &&
      byId.has(span.parentSpanId)
    ) {
      const arr = childMap.get(span.parentSpanId) ?? [];
      arr.push(span);
      childMap.set(span.parentSpanId, arr);
    } else {
      roots.push(span);
    }
  }

  const visited = new Set<string>();

  function build(s: TraceSpan, depth: number): SpanNode {
    visited.add(s.spanId);
    const children = (childMap.get(s.spanId) ?? [])
      .filter((c) => !visited.has(c.spanId))
      .sort((a, b) => a.startTimeMs - b.startTimeMs)
      .map((c) => build(c, depth + 1));
    return { span: s, children, depth };
  }

  const forest = roots
    .sort((a, b) => a.startTimeMs - b.startTimeMs)
    .map((r) => build(r, 0));

  // 兜底：未访问到的 span（如孤立环）作为 root 加入
  for (const span of spans) {
    if (!visited.has(span.spanId)) forest.push(build(span, 0));
  }

  return forest;
}

/**
 * 将 forest 扁平化为 SpanNode 数组（深度优先遍历）。
 * 用于树形瀑布图渲染：保留 depth 信息以计算缩进。
 */
export function flattenForest(nodes: SpanNode[]): SpanNode[] {
  const result: SpanNode[] = [];

  function walk(node: SpanNode) {
    result.push(node);
    for (const child of node.children) walk(child);
  }

  for (const root of nodes) walk(root);
  return result;
}
