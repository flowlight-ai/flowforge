/**
 * @flowforge/forgekin-im-council — T7.16 数据模型契约验证。
 *
 * 对齐 `core/im_council.py` 的 CouncilMessage / CouncilReply（F047 §2.4）：
 *   - newId 生成带前缀 UUID（`{prefix}_{hex12}`）
 *   - newCouncilMessage：默认 message_type=info / payload 深拷贝 / createdAt UTC ISO
 *   - newCouncilReply：默认 reply_type=decision
 *
 * @module @flowforge/forgekin-im-council/tests
 */

import { describe, expect, it } from 'vitest';
import {
  newCouncilMessage,
  newCouncilReply,
  newId,
  type CouncilMessage,
} from '../src/models.js';

describe('newId', () => {
  it('生成 `{prefix}_{12位hex}` 格式且两次不重复', () => {
    const a = newId('council_msg');
    const b = newId('council_msg');
    expect(a).toMatch(/^council_msg_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('newCouncilMessage', () => {
  it('默认字段：message_type=info、payload 空对象、createdAt 为 UTC ISO 字符串', () => {
    const msg = newCouncilMessage({
      channel: 'console',
      forgekinId: 'sherlock',
      content: 'test',
    });
    expect(msg.messageId).toMatch(/^council_msg_/);
    expect(msg.messageType).toBe('info');
    expect(msg.payload).toEqual({});
    expect(new Date(msg.createdAt).toISOString()).toBe(msg.createdAt);
  });

  it('payload 深拷贝：外部修改不影响消息', () => {
    const payload = { request_id: 'r1', nested: { a: 1 } };
    const msg = newCouncilMessage({
      channel: 'console',
      forgekinId: 'sherlock',
      content: 'c',
      payload,
    });
    payload['request_id'] = 'mutated';
    payload['nested'] = { a: 99 };
    expect(msg.payload['request_id']).toBe('r1');
    expect(msg.payload['nested']).toEqual({ a: 1 });
  });

  it('createdAt 接受 Date 实例并转为 ISO', () => {
    const date = new Date('2026-08-24T00:00:00.000Z');
    const msg = newCouncilMessage({
      channel: 'console',
      forgekinId: 'sherlock',
      content: 'c',
      createdAt: date,
    });
    expect(msg.createdAt).toBe('2026-08-24T00:00:00.000Z');
  });
});

describe('newCouncilReply', () => {
  it('默认 reply_type=decision，replier/content 透传', () => {
    const reply = newCouncilReply({
      messageId: 'council_msg_abc',
      replier: 'operator',
      content: 'approve',
    });
    expect(reply.replyId).toMatch(/^reply_/);
    expect(reply.messageId).toBe('council_msg_abc');
    expect(reply.replier).toBe('operator');
    expect(reply.content).toBe('approve');
    expect(reply.replyType).toBe('decision');
  });

  it('decidedAt 为 UTC ISO 字符串', () => {
    const reply = newCouncilReply({
      messageId: 'm1',
      replier: 'operator',
      content: 'ok',
    });
    expect(new Date(reply.decidedAt).toISOString()).toBe(reply.decidedAt);
  });
});

describe('CouncilMessage 类型完整性', () => {
  it('字段与 Python CouncilMessage 对齐（snake_case 语义映射 camelCase）', () => {
    const msg: CouncilMessage = {
      messageId: 'm1',
      channel: 'trae',
      forgekinId: 'holmes',
      content: 'hello',
      messageType: 'alert',
      payload: {},
      createdAt: '2026-08-24T00:00:00.000Z',
    };
    expect(msg.channel).toBe('trae');
    expect(msg.messageType).toBe('alert');
  });
});
