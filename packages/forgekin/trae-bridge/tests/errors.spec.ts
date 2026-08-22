/**
 * errors — Trae 桥接异常层次契约验证（对齐 Python exceptions.py）。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { describe, expect, it } from 'vitest';
import {
  TraeBridgeCancelledError,
  TraeBridgeConfigError,
  TraeBridgeError,
  TraeBridgeIOError,
  TraeBridgeProtocolError,
  TraeBridgeTimeoutError,
  TraeLLMApiError,
  TraeLLMCliError,
  TraeLLMError,
  TraeLLMTimeoutError,
} from '../src/errors.js';

describe('TraeBridgeError 基类', () => {
  it('保留 message + requestId/mode/taskId 字段', () => {
    const err = new TraeBridgeError('boom', { requestId: 'rid-1', mode: 'bridge' });
    expect(err.message).toBe('boom');
    expect(err.requestId).toBe('rid-1');
    expect(err.taskId).toBe('rid-1');
    expect(err.mode).toBe('bridge');
    expect(err.name).toBe('TraeBridgeError');
    expect(err).toBeInstanceOf(Error);
  });

  it('requestId 缺省时回退 taskId（对齐 Python request_id = request_id or task_id）', () => {
    const err = new TraeBridgeError('boom', { taskId: 'task-9' });
    expect(err.requestId).toBe('task-9');
    expect(err.taskId).toBe('task-9');
  });

  it('无参数时字段为空串', () => {
    const err = new TraeBridgeError('boom');
    expect(err.requestId).toBe('');
    expect(err.mode).toBe('');
  });
});

describe('异常子类层次', () => {
  it('五子类均继承自 TraeBridgeError', () => {
    const cases = [
      new TraeBridgeTimeoutError('t'),
      new TraeBridgeCancelledError('c'),
      new TraeBridgeProtocolError('p'),
      new TraeBridgeIOError('io'),
      new TraeBridgeConfigError('cfg'),
    ];
    for (const err of cases) {
      expect(err).toBeInstanceOf(TraeBridgeError);
      expect(err).toBeInstanceOf(Error);
    }
    expect(new TraeBridgeTimeoutError('t').name).toBe('TraeBridgeTimeoutError');
    expect(new TraeBridgeCancelledError('c').name).toBe('TraeBridgeCancelledError');
    expect(new TraeBridgeProtocolError('p').name).toBe('TraeBridgeProtocolError');
    expect(new TraeBridgeIOError('io').name).toBe('TraeBridgeIOError');
    expect(new TraeBridgeConfigError('cfg').name).toBe('TraeBridgeConfigError');
  });

  it('子类透传 requestId 选项', () => {
    const err = new TraeBridgeTimeoutError('超时', { requestId: 'rid-x' });
    expect(err.requestId).toBe('rid-x');
  });
});

describe('向后兼容别名', () => {
  it('TraeLLM* 别名指向对应异常类', () => {
    expect(TraeLLMError).toBe(TraeBridgeError);
    expect(TraeLLMTimeoutError).toBe(TraeBridgeTimeoutError);
    expect(TraeLLMCliError).toBe(TraeBridgeError);
    expect(TraeLLMApiError).toBe(TraeBridgeError);
  });
});
