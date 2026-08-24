/**
 * tracing — T7.12 trace_id 全链路传播契约验证。
 *
 * 移植自 `core/tracing.py`：
 *   - setTraceId/getTraceId 设置与读取
 *   - withTraceId 异步上下文隔离（对齐 ContextVar 语义）
 *   - TraceLogger 接口（info/warning/error/debug/exception）
 *
 * @module @flowforge/forgekin-observability/tests
 */

import { describe, expect, it, vi } from 'vitest';
import {
  TraceLogger,
  getLogger,
  getTraceId,
  setTraceId,
  withTraceId,
} from '../src/tracing.js';

describe('trace_id 传播', () => {
  it('默认 getTraceId 返回 unknown，setTraceId 后返回设置值', () => {
    expect(getTraceId()).toBe('unknown');
    const tid = setTraceId();
    expect(tid.length).toBeGreaterThan(0);
    expect(getTraceId()).toBe(tid);
  });

  it('setTraceId 可指定外部链路 id', () => {
    const tid = setTraceId('ext-trace-123');
    expect(tid).toBe('ext-trace-123');
    expect(getTraceId()).toBe('ext-trace-123');
  });

  it('withTraceId 异步上下文隔离：内部生效，外部不受影响', async () => {
    const outer = setTraceId('outer-trace');
    let inside = '';
    await withTraceId('inner-trace', async () => {
      inside = getTraceId();
      expect(inside).toBe('inner-trace');
    });
    expect(getTraceId()).toBe(outer);
  });
});

describe('TraceLogger', () => {
  it('getLogger 返回 TraceLogger，五个方法可调用（不抛错）', () => {
    const logger = getLogger('test.logger');
    expect(logger).toBeInstanceOf(TraceLogger);
    logger.info('hello');
    logger.warning('warn');
    logger.error('err');
    logger.debug('dbg');
    logger.exception('exc');
  });

  it('日志输出包含 trace_id（注入后生效）', () => {
    const logger = new TraceLogger('test.name');
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    setTraceId('trace-in-log');
    logger.info('msg');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[trace_id=trace-in-log] msg'),
    );
    spy.mockRestore();
  });
});
