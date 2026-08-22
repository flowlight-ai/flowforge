/**
 * models — Trae 桥接协议数据模型契约验证（对齐 Python models.py）。
 *
 * @module @flowforge/forgekin-trae-bridge/tests
 */

import { describe, expect, it } from 'vitest';
import {
  BridgeRequestStatus,
  BridgeResponseStatus,
  isBridgeRequestStatus,
  isBridgeResponseStatus,
  makeBridgeAck,
  makeBridgeCancel,
  makeBridgeRequest,
  makeBridgeRequestContext,
  makeBridgeStatus,
  parseBridgeCancel,
  parseBridgeResponse,
  parseBridgeStatus,
  validateBridgeMessage,
} from '../src/models.js';

describe('枚举', () => {
  it('BridgeRequestStatus 6 态', () => {
    expect(Object.values(BridgeRequestStatus)).toEqual([
      'pending', 'acked', 'processing', 'completed', 'timeout', 'cancelled',
    ]);
  });

  it('BridgeResponseStatus 4 态', () => {
    expect(Object.values(BridgeResponseStatus)).toEqual([
      'completed', 'error', 'partial', 'timeout',
    ]);
  });

  it('isBridge*Status 守卫', () => {
    expect(isBridgeRequestStatus('pending')).toBe(true);
    expect(isBridgeRequestStatus('nope')).toBe(false);
    expect(isBridgeResponseStatus('error')).toBe(true);
    expect(isBridgeResponseStatus('pending')).toBe(false);
  });
});

describe('validateBridgeMessage', () => {
  it('合法 role（system/user/assistant）', () => {
    expect(validateBridgeMessage({ role: 'user', content: 'hi' })).toEqual({
      role: 'user',
      content: 'hi',
    });
  });

  it('非法 role / 非对象 / content 缺失均抛错', () => {
    expect(() => validateBridgeMessage({ role: 'tool', content: 'x' })).toThrow(TypeError);
    expect(() => validateBridgeMessage(null)).toThrow(TypeError);
    expect(() => validateBridgeMessage({ role: 'user' })).toThrow(TypeError);
  });
});

describe('makeBridgeRequestContext', () => {
  it('默认值（task_type=chat/model=trae/temperature=0.7/max_tokens=4096/tools=null）', () => {
    const ctx = makeBridgeRequestContext({ forgekin_id: 'forgemind:luban' });
    expect(ctx).toMatchObject({
      forgekin_id: 'forgemind:luban',
      task_type: 'chat',
      task_summary: '',
      model: 'trae',
      temperature: 0.7,
      max_tokens: 4096,
      tools: null,
    });
  });

  it('forgekin_id 为空抛错（min_length=1）', () => {
    expect(() => makeBridgeRequestContext({ forgekin_id: '' })).toThrow(TypeError);
  });

  it('temperature 越界 / max_tokens<1 抛错', () => {
    expect(() =>
      makeBridgeRequestContext({ forgekin_id: 'a', temperature: 2.5 }),
    ).toThrow(TypeError);
    expect(() =>
      makeBridgeRequestContext({ forgekin_id: 'a', max_tokens: 0 }),
    ).toThrow(TypeError);
  });
});

describe('makeBridgeRequest', () => {
  it('默认值（session_id=""/timeout=300/status=pending/created_at 自动）', () => {
    const req = makeBridgeRequest({
      request_id: 'rid-1',
      messages: [{ role: 'user', content: 'hi' }],
      context: makeBridgeRequestContext({ forgekin_id: 'f' }),
    });
    expect(req.session_id).toBe('');
    expect(req.timeout_seconds).toBe(300);
    expect(req.status).toBe(BridgeRequestStatus.PENDING);
    expect(Number.isNaN(Date.parse(req.created_at))).toBe(false);
  });

  it('request_id 为空 / messages 为空 / timeout<1 抛错', () => {
    const ctx = makeBridgeRequestContext({ forgekin_id: 'f' });
    expect(() =>
      makeBridgeRequest({ request_id: '', messages: [{ role: 'user', content: 'x' }], context: ctx }),
    ).toThrow(TypeError);
    expect(() =>
      makeBridgeRequest({ request_id: 'r', messages: [], context: ctx }),
    ).toThrow(TypeError);
    expect(() =>
      makeBridgeRequest({
        request_id: 'r',
        messages: [{ role: 'user', content: 'x' }],
        context: ctx,
        timeout_seconds: 0,
      }),
    ).toThrow(TypeError);
  });
});

describe('parseBridgeResponse', () => {
  it('合法响应解析（含扩展字段保留）', () => {
    const resp = parseBridgeResponse({
      request_id: 'rid-1',
      content: 'hello',
      status: 'completed',
      model: 'Doubao-Seed2.0',
      usage: { total_tokens: 10 },
      completed_at: '2026-08-21T00:00:00.000Z',
      extra_field: 1,
    });
    expect(resp.content).toBe('hello');
    expect(resp.status).toBe(BridgeResponseStatus.COMPLETED);
    expect(resp.tool_calls).toBeNull();
    expect(resp['extra_field']).toBe(1);
  });

  it('缺 request_id / status 非法抛错', () => {
    expect(() => parseBridgeResponse({ status: 'completed' })).toThrow(TypeError);
    expect(() => parseBridgeResponse({ request_id: 'r', status: 'nope' })).toThrow(TypeError);
    expect(() => parseBridgeResponse('not-object')).toThrow(TypeError);
  });

  it('可选字段缺失时兜底默认值', () => {
    const resp = parseBridgeResponse({ request_id: 'r', status: 'completed' });
    expect(resp.content).toBe('');
    expect(resp.model).toBe('trae');
    expect(resp.usage).toEqual({});
    expect(resp.error).toBe('');
    expect(resp.completed_at).not.toBe('');
  });
});

describe('makeBridgeCancel / parseBridgeCancel', () => {
  it('默认值（reason=""/cancelled_by=operator/cancelled_at 自动）', () => {
    const cancel = makeBridgeCancel({ request_id: 'rid-1' });
    expect(cancel.reason).toBe('');
    expect(cancel.cancelled_by).toBe('operator');
    expect(Number.isNaN(Date.parse(cancel.cancelled_at))).toBe(false);
  });

  it('宽松解析：非法数据兜底', () => {
    expect(parseBridgeCancel('garbage', 'rid-9').request_id).toBe('rid-9');
    expect(parseBridgeCancel({ reason: 'stop' }, 'rid-9').reason).toBe('stop');
  });
});

describe('makeBridgeAck / makeBridgeStatus / parseBridgeStatus', () => {
  it('ack 默认值', () => {
    const ack = makeBridgeAck({ request_id: 'rid-1' });
    expect(ack.acked_by).toBe('operator');
    expect(ack.acked_at).not.toBe('');
  });

  it('status 全零默认 + 解析兜底', () => {
    expect(makeBridgeStatus()).toEqual({
      pending_count: 0,
      processing_count: 0,
      completed_total: 0,
      timeout_total: 0,
      cancelled_total: 0,
      last_activity_at: null,
    });
    expect(parseBridgeStatus(null)).toEqual(makeBridgeStatus());
    expect(parseBridgeStatus({ pending_count: 3, completed_total: -1 })).toMatchObject({
      pending_count: 3,
      completed_total: 0, // 非法值回退 0
    });
  });
});
