/**
 * Span / TraceManager — T7.12 追踪跨度契约验证。
 *
 * 移植自 `core/observability.py`（P-94）：
 *   - new_trace / new_span / finish_span：span 链维护（parent 恢复）
 *   - trace_operation：成功/异常自动 finish（异常向上抛）
 *   - export_spans：JSON 可序列化结构
 *   - save_traces：JSONL 文件追加
 *
 * @module @flowforge/forgekin-observability/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TraceManager } from '../src/span.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'obs-span-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('TraceManager span 链', () => {
  it('new_trace 生成 16 位 trace_id，无追踪时 new_span 自动建链', () => {
    const mgr = new TraceManager();
    const trace_id = mgr.new_trace();
    expect(trace_id).toHaveLength(16);
    expect(mgr.trace_id).toBe(trace_id);

    const standalone = new TraceManager();
    const span = standalone.new_span('op');
    expect(span.trace_id).toHaveLength(16);
    expect(span.parent_span_id).toBeNull();
  });

  it('嵌套 span：子 span 持有父 id，finish 后恢复父为当前', () => {
    const mgr = new TraceManager();
    mgr.new_trace();
    const parent = mgr.new_span('parent');
    const child = mgr.new_span('child');
    expect(child.parent_span_id).toBe(parent.span_id);

    mgr.finish_span(child);
    const sibling = mgr.new_span('sibling');
    expect(sibling.parent_span_id).toBe(parent.span_id);
  });

  it('finish 记录 end_time + status，duration_ms 非负', () => {
    const mgr = new TraceManager();
    const span = mgr.new_span('op');
    expect(span.end_time).toBeNull();
    mgr.finish_span(span, 'error');
    expect(span.status).toBe('error');
    expect(span.end_time).not.toBeNull();
    expect(span.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('trace_operation', () => {
  it('成功自动 finish(ok)，返回结果', async () => {
    const mgr = new TraceManager();
    const result = await mgr.trace_operation('op', async (span) => {
      expect(span.operation).toBe('op');
      return 42;
    });
    expect(result).toBe(42);
    const [span] = mgr.export_spans();
    expect(span?.['status']).toBe('ok');
    expect(span?.['end_time']).not.toBeNull();
  });

  it('异常记录 error 属性 + finish(error)，异常向上抛', async () => {
    const mgr = new TraceManager();
    await expect(
      mgr.trace_operation('op', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const [span] = mgr.export_spans();
    expect(span?.['status']).toBe('error');
    expect(span?.['attributes']).toEqual({ error: 'Error: boom' });
  });
});

describe('导出机制（P-94）', () => {
  it('export_spans 返回 JSON 可序列化结构', async () => {
    const mgr = new TraceManager();
    await mgr.trace_operation('a', async () => {});
    await mgr.trace_operation('b', async () => {});
    const spans = mgr.export_spans();
    expect(spans).toHaveLength(2);
    expect(spans[0]).toHaveProperty('trace_id');
    expect(spans[0]).toHaveProperty('span_id');
    expect(spans[0]).toHaveProperty('operation');
    expect(spans[0]).toHaveProperty('duration_ms');
    expect(spans[0]).toHaveProperty('status');
  });

  it('save_traces 追加写入 JSONL 文件', async () => {
    const mgr = new TraceManager();
    await mgr.trace_operation('op1', async () => {});
    await mgr.trace_operation('op2', async () => {});
    const file = path.join(tmp, 'traces.jsonl');
    await mgr.save_traces(file);

    const content = await fs.readFile(file, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed['operation']).toBe('op1');
  });
});
