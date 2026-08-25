/**
 * @flowforge/forgekin-observability — T7.12 追踪跨度：Span / TraceManager。
 *
 * TS 重写自 `core/observability.py`（原 DevForge TraceManager/Span）：
 *   - Span：追踪跨度（trace_id/span_id/operation/start/end/parent/attributes/status）
 *   - TraceManager：维护 trace_id 和 span 链（new_trace / new_span / finish_span /
 *     trace_operation / export_spans / save_traces JSONL，P-94）
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { generateTraceId } from './tracing.js';

/** 追踪跨度 — 一次操作的时序 + 属性 + 状态。 */
export class Span {
  /** 追踪链 id。 */
  readonly trace_id: string;
  /** 跨度 id。 */
  readonly span_id: string;
  /** 操作名（如 agent:wenxin / tool:bash）。 */
  readonly operation: string;
  /** 开始时间（epoch ms）。 */
  readonly start_time: number;
  /** 结束时间（epoch ms，finish 前为 null）。 */
  end_time: number | null = null;
  /** 父跨度 id（根 span 为 null）。 */
  readonly parent_span_id: string | null;
  /** 附加属性（可被 trace_operation 写入 error）。 */
  attributes: Record<string, unknown>;
  /** 状态：ok / error。 */
  status: string = 'ok';

  constructor(init: {
    trace_id: string;
    span_id: string;
    operation: string;
    start_time?: number;
    parent_span_id?: string | null;
    attributes?: Record<string, unknown>;
  }) {
    this.trace_id = init.trace_id;
    this.span_id = init.span_id;
    this.operation = init.operation;
    this.start_time = init.start_time ?? Date.now();
    this.parent_span_id = init.parent_span_id ?? null;
    this.attributes = init.attributes ?? {};
  }

  /** 跨度耗时（ms；未结束时按当前时间估算）。 */
  get duration_ms(): number {
    const end = this.end_time ?? Date.now();
    return end - this.start_time;
  }

  /** 标记结束（记录 end_time + status）。 */
  finish(status: string = 'ok'): void {
    this.end_time = Date.now();
    this.status = status;
  }

  /** 导出为 JSON 可序列化结构（对齐 Python export_spans）。 */
  toJSON(): Record<string, unknown> {
    return {
      trace_id: this.trace_id,
      span_id: this.span_id,
      operation: this.operation,
      start_time: this.start_time,
      end_time: this.end_time,
      duration_ms: Math.round(this.duration_ms * 1000) / 1000,
      parent_span_id: this.parent_span_id,
      attributes: this.attributes,
      status: this.status,
    };
  }
}

/**
 * 追踪管理器 — 维护 trace_id 和 span 链。
 */
export class TraceManager {
  private currentTraceId: string | null = null;
  private currentSpanId: string | null = null;
  private readonly spans: Span[] = [];

  /** 创建新的追踪（重置当前 span 链）。 */
  new_trace(): string {
    this.currentTraceId = generateTraceId().replaceAll('-', '').slice(0, 16);
    this.currentSpanId = null;
    return this.currentTraceId;
  }

  /** 当前追踪 id（无追踪时为 null）。 */
  get trace_id(): string | null {
    return this.currentTraceId;
  }

  /** 创建新的跨度（无追踪时自动 new_trace）。 */
  new_span(operation: string, attributes: Record<string, unknown> = {}): Span {
    if (this.currentTraceId === null) {
      this.new_trace();
    }
    const span = new Span({
      trace_id: this.currentTraceId!,
      span_id: generateTraceId().replaceAll('-', '').slice(0, 12),
      operation,
      parent_span_id: this.currentSpanId,
      attributes,
    });
    this.spans.push(span);
    this.currentSpanId = span.span_id;
    return span;
  }

  /** 结束跨度（恢复父 span 为当前）。 */
  finish_span(span: Span, status: string = 'ok'): void {
    span.finish(status);
    this.currentSpanId = span.parent_span_id;
  }

  /**
   * 追踪异步操作（Python asynccontextmanager 的回调式 TS 等价）。
   *
   * @param operation 操作名。
   * @param fn 异步回调（成功/异常自动 finish，异常向上抛）。
   * @param attributes span 附加属性。
   */
  async trace_operation<T>(
    operation: string,
    fn: (span: Span) => Promise<T>,
    attributes: Record<string, unknown> = {},
  ): Promise<T> {
    const span = this.new_span(operation, attributes);
    try {
      const result = await fn(span);
      this.finish_span(span, 'ok');
      return result;
    } catch (err) {
      span.attributes['error'] = String(err);
      this.finish_span(span, 'error');
      throw err;
    }
  }

  /** 导出全部 span 为 JSON 可序列化结构（P-94）。 */
  export_spans(): Record<string, unknown>[] {
    return this.spans.map((s) => s.toJSON());
  }

  /** 将全部 span 追加写入 JSONL 文件（P-94）。 */
  async save_traces(filePath: string = 'logs/traces.jsonl'): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const lines = this.export_spans()
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    if (lines.length > 0) {
      await fs.appendFile(filePath, lines + '\n', 'utf-8');
    }
  }

  /** 已记录 span 总数（测试/审计用）。 */
  get span_count(): number {
    return this.spans.length;
  }
}
