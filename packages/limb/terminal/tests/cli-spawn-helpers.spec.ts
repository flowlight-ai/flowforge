/**
 * maybeCollectStreamError 单元测试 — T6.5 cli/cli-spawn-helpers.ts
 * 覆盖（对齐 clowder-ai cli-spawn maybeCollectStreamError 语义）：
 * - 非对象输入直接返回
 * - type='error' 事件：Error 实例字段显式提取（JSON.stringify 丢非枚举字段）
 * - type='result' is_error:true / subtype!=='success' 判定
 * - structuredSink 仅 result error 准入（AC-D3 安全源红线）
 * - 有界收集：50 条上限 + 16384 字符上限
 */

import { describe, expect, it } from 'vitest';
import { maybeCollectStreamError } from '../src/cli/cli-spawn-helpers.js';

describe('maybeCollectStreamError', () => {
  it('非对象 / null / 无 error 语义的普通事件直接返回', () => {
    const sink: string[] = [];
    maybeCollectStreamError(undefined, sink);
    maybeCollectStreamError(null, sink);
    maybeCollectStreamError('string', sink);
    maybeCollectStreamError({ type: 'message', content: 'hi' }, sink);
    maybeCollectStreamError({ type: 'result', subtype: 'success', is_error: false }, sink);
    expect(sink).toEqual([]);
  });

  it('type=error 的 Error 实例：显式提取 name/message', () => {
    const sink: string[] = [];
    const err = new Error('connection refused');
    maybeCollectStreamError({ type: 'error', error: err }, sink);
    expect(sink.length).toBe(1);
    expect(sink[0]).toContain('Error: connection refused');
  });

  it('type=error 普通对象：提取 message 字段 + JSON 序列化', () => {
    const sink: string[] = [];
    maybeCollectStreamError({ type: 'error', message: 'spawn codex ENOENT' }, sink);
    expect(sink[0]).toContain('spawn codex ENOENT');
    expect(sink[0]).toContain('"type":"error"');
  });

  it('data.message / data.statusCode 提取', () => {
    const sink: string[] = [];
    maybeCollectStreamError({ type: 'error', data: { message: 'rate limit', statusCode: 429 } }, sink);
    expect(sink[0]).toContain('rate limit');
    expect(sink[0]).toContain('429');
  });

  it('result is_error=true：result 文本入 sink 与 structuredSink（CC 标准措辞）', () => {
    const sink: string[] = [];
    const structured: string[] = [];
    maybeCollectStreamError(
      { type: 'result', subtype: 'success', is_error: true, result: "The model's tool call could not be parsed", errors: null },
      sink,
      structured,
    );
    expect(sink[0]).toContain("tool call could not be parsed");
    expect(structured).toHaveLength(1);
    expect(structured[0]).toContain("tool call could not be parsed");
  });

  it('result subtype!=success 且无 is_error：仍视为 result error', () => {
    const sink: string[] = [];
    maybeCollectStreamError({ type: 'result', subtype: 'error_during_execution', errors: ['boom'] }, sink);
    expect(sink[0]).toContain('boom');
  });

  it('structuredSink 对 type=error 事件保持关闭（任意 stderr 类内容不得经 AC-D3 泄漏）', () => {
    const sink: string[] = [];
    const structured: string[] = [];
    maybeCollectStreamError({ type: 'error', message: 'raw provider stderr-like content' }, sink, structured);
    expect(sink).toHaveLength(1);
    expect(structured).toEqual([]);
  });

  it('errors[] 字符串数组全部入 sink', () => {
    const sink: string[] = [];
    maybeCollectStreamError({ type: 'result', is_error: true, errors: ['e1', 'e2'] }, sink);
    expect(sink[0]).toContain('e1');
    expect(sink[0]).toContain('e2');
  });

  it('有界收集：条目数达 50 后跳过', () => {
    const sink: string[] = [];
    for (let i = 0; i < 60; i++) {
      maybeCollectStreamError({ type: 'error', message: `err-${i}` }, sink);
    }
    expect(sink.length).toBe(50);
  });

  it('有界收集：总字符达 16384 后跳过', () => {
    const sink: string[] = [];
    maybeCollectStreamError({ type: 'error', message: 'x'.repeat(16384) }, sink);
    expect(sink).toHaveLength(1);
    maybeCollectStreamError({ type: 'error', message: 'overflow' }, sink);
    expect(sink).toHaveLength(1);
  });

  it('不可序列化对象（循环引用）至少保留提取文本', () => {
    const sink: string[] = [];
    const circular: Record<string, unknown> = { type: 'error', message: 'circular-safe' };
    circular.self = circular;
    maybeCollectStreamError(circular, sink);
    expect(sink[0]).toContain('circular-safe');
  });
});
