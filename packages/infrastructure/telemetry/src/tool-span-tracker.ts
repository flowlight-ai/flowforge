/**
 * F153 Phase J Slice J-A AC-J3: ToolSpanTracker per-invocation
 * （TS 移植自 clowder-ai `tool-span-tracker.ts` + `span-helpers.ts` 基础工具计数）。
 *
 * 以真实时长 span（tool_use 开始 → tool_result 结束）取代零时长点标记。
 * Scope（KD-37）：每个 (invocation, cat) 一个 tracker；内部 map 以 toolUseId 为键，
 * tracker 实例作用域天然防止跨调用的 provider-raw-id 冲突。
 *
 * 批次51 适配：OTel Span API → 结构化 TelemetrySpan 端口（setAttribute/setStatus/
 * end/spanContext），OTel 适配层随 T9.5 接线；生命周期语义逐行对齐。
 */

import { AGENT_ID, TOOL_CATEGORY, TOOL_INPUT_KEYS, TOOL_NAME } from './semconv.ts';

const MEMORY_TOOL_PREFIXES = [
  'cat_cafe_search_evidence',
  'cat_cafe_read_session',
  'cat_cafe_read_invocation',
  'cat_cafe_review_distillation',
];

function classifyToolCategory(toolName: string): string | undefined {
  if (MEMORY_TOOL_PREFIXES.some((p) => toolName.startsWith(p))) return 'memory';
  return undefined;
}

/** MCP 工具名判定（对齐 tool-usage/classify.isMcpToolName）。 */
export function isMcpToolName(toolName: string): boolean {
  return (
    toolName.startsWith('mcp__') ||
    toolName.startsWith('mcp:') ||
    toolName.startsWith('cat_cafe_') ||
    toolName.startsWith('signal_')
  );
}

export type ToolResultStatus = 'ok' | 'error' | 'unknown';

/** 结构化 span 端口（OTel Span 最小面；适配层随 T9.5 接线）。 */
export interface TelemetrySpan {
  setAttribute(key: string, value: unknown): void;
  setStatus(status: { code: 'ok' | 'error' | 'unset'; message?: string }): void;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}

export interface SpanFactory {
  startSpan(
    name: string,
    attrs: Record<string, unknown>,
    parent?: { traceId: string; spanId: string },
  ): TelemetrySpan;
}

/** 基础工具调用计数（WeakMap 状态与 legacy fallback 共享，KD-40 + R1）。 */
const toolCallCounts = new WeakMap<object, number>();

/** 基础（非 MCP）工具：在 invocation span 上累加 tool.basic_call_count。 */
function recordBasicToolCall(
  invocationSpan: object,
  catId: string,
  toolName: string,
): void {
  void catId;
  void toolName;
  const prev = (toolCallCounts.get(invocationSpan) ?? 0) + 1;
  toolCallCounts.set(invocationSpan, prev);
  // invocationSpan 须实现 TelemetrySpan 才能设置属性；否则仅更新计数
  const spanLike = invocationSpan as Partial<TelemetrySpan>;
  if (typeof spanLike.setAttribute === 'function') {
    spanLike.setAttribute('tool.basic_call_count', prev);
  }
}

export interface ToolSpanTrackerHost {
  /** invocation 级父 span（基础工具计数挂载点；须可 WeakMap 键控） */
  invocationSpan: object;
  catId: string;
  /** span 工厂（OTel 适配层注入；缺省基于 port 的最小实现由调用方提供） */
  factory: SpanFactory;
}

export class ToolSpanTracker {
  private readonly spans = new Map<string, TelemetrySpan>();

  constructor(private readonly host: ToolSpanTrackerHost) {}

  /**
   * Start a tool_use span. Returns the span for advanced callers, or `undefined`
   * for basic tools (which bump the invocation-span counter and emit no child span).
   *
   * Duplicate `start(toolUseId)` is a no-op (re-emitted event); returns existing span.
   */
  start(toolName: string, toolUseId: string, toolInput?: Record<string, unknown>): TelemetrySpan | undefined {
    if (!isMcpToolName(toolName)) {
      // Delegate to shared WeakMap (counter state unified)
      recordBasicToolCall(this.host.invocationSpan, this.host.catId, toolName);
      return undefined;
    }

    const existing = this.spans.get(toolUseId);
    if (existing) return existing;

    const category = classifyToolCategory(toolName);
    const span = this.host.factory.startSpan(`cat_cafe.tool_use ${toolName}`, {
      [AGENT_ID]: this.host.catId,
      [TOOL_NAME]: toolName,
      ...(toolInput ? { [TOOL_INPUT_KEYS]: Object.keys(toolInput).join(',') } : {}),
      ...(category ? { [TOOL_CATEGORY]: category } : {}),
      'tool.use_id': toolUseId,
    });
    this.spans.set(toolUseId, span);
    return span;
  }

  /**
   * Close a tool_use span with the given status. No-op when toolUseId is unknown.
   * Per Phase J spec "Out of scope: Tool input/result body 写入 span attr — 保持
   * 低敏，只存 keys + status, 不存正文" — does NOT accept a resultMeta blob.
   */
  end(toolUseId: string, status: ToolResultStatus): void {
    const span = this.spans.get(toolUseId);
    if (!span) return;

    span.setAttribute('tool.result.status', status);
    if (status === 'ok') {
      span.setStatus({ code: 'ok' });
    } else if (status === 'error') {
      span.setStatus({ code: 'error' });
    }
    span.end();
    this.spans.delete(toolUseId);
  }

  /**
   * AC-J4: end all currently-open spans, marking them with the given lifecycle reason.
   * Called from invocation lifecycle finally block on abort/error/timeout.
   */
  endAllOrphans(reason: 'aborted' | 'completed' = 'aborted'): void {
    for (const span of this.spans.values()) {
      span.setAttribute('tool.lifecycle', reason);
      span.end();
    }
    this.spans.clear();
  }

  /** Number of currently-open tool spans (for diagnostics / tests). */
  size(): number {
    return this.spans.size;
  }

  /**
   * F153 Phase J Slice J-B AC-J7: peek at an open tool span's trace context without
   * closing it. Returns `undefined` for unknown toolUseId.
   */
  getContext(toolUseId: string): { traceId: string; spanId: string } | undefined {
    const span = this.spans.get(toolUseId);
    if (!span) return undefined;
    return span.spanContext();
  }
}
