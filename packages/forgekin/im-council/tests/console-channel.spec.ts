/**
 * @flowforge/forgekin-im-council — T7.16 ConsoleChannel 契约验证。
 *
 * 对齐 `core/im_council.py` 的 ConsoleChannel（F047 §2.2 Phase 1 完整实现）：
 *   - send 记录 pending + 打印审批请求，返回 message_id
 *   - wait_reply：注入 readInput 模拟 operator 输入；超时返回 null（I4）
 *   - 未识别输入默认 rejected（I3 保守策略）
 *   - broadcast 单接收者等价 send
 *
 * @module @flowforge/forgekin-im-council/tests
 */

import { describe, expect, it } from 'vitest';
import { ConsoleChannel } from '../src/console-channel.js';
import { newCouncilMessage } from '../src/models.js';

function makeMessage(overrides: Partial<Parameters<typeof newCouncilMessage>[0]> = {}) {
  return newCouncilMessage({
    channel: 'console',
    forgekinId: 'sherlock',
    content: '审批测试',
    messageType: 'approval_request',
    payload: { request_id: 'r1' },
    ...overrides,
  });
}

describe('ConsoleChannel.send', () => {
  it('返回 message_id 且打印审批请求（注入 printer）', async () => {
    const printed: string[] = [];
    const channel = new ConsoleChannel({
      promptPrefix: '[TEST]',
      printer: (t) => printed.push(t),
    });
    const msg = makeMessage();
    const msgId = await channel.send(msg);
    expect(msgId).toBe(msg.messageId);
    expect(printed.join('\n')).toContain('[TEST]');
    expect(printed.join('\n')).toContain('议事请求 [approval_request]');
    expect(printed.join('\n')).toContain('来自：sherlock');
    expect(printed.join('\n')).toContain('请回复 approve / reject');
  });
});

describe('ConsoleChannel.wait_reply', () => {
  it('operator 输入 approve → 返回 decision 回复并清理 pending', async () => {
    const channel = new ConsoleChannel({
      readInput: async () => 'approve',
    });
    const msg = makeMessage();
    await channel.send(msg);
    const reply = await channel.wait_reply(msg.messageId, 5);
    expect(reply).not.toBeNull();
    expect(reply!.replier).toBe('operator');
    expect(reply!.content).toBe('approve');
    expect(reply!.replyType).toBe('decision');
    expect(reply!.messageId).toBe(msg.messageId);
  });

  it('超时返回 null（I4 不变量），pending 保留现场', async () => {
    const channel = new ConsoleChannel({
      // 永不 resolve 的输入 → Promise.race 超时分支
      readInput: () => new Promise(() => {}),
    });
    const msg = makeMessage();
    await channel.send(msg);
    const reply = await channel.wait_reply(msg.messageId, 0.05);
    expect(reply).toBeNull();
  });

  it('未知 message_id 返回 null', async () => {
    const channel = new ConsoleChannel();
    const reply = await channel.wait_reply('council_msg_none', 1);
    expect(reply).toBeNull();
  });
});

describe('ConsoleChannel.parseDecision', () => {
  it('approve/yes/同意 → approved', () => {
    expect(ConsoleChannel.parseDecision('approve')).toBe('approved');
    expect(ConsoleChannel.parseDecision('YES')).toBe('approved');
    expect(ConsoleChannel.parseDecision('同意')).toBe('approved');
  });

  it('reject/no/拒绝 → rejected', () => {
    expect(ConsoleChannel.parseDecision('reject')).toBe('rejected');
    expect(ConsoleChannel.parseDecision('n')).toBe('rejected');
    expect(ConsoleChannel.parseDecision('拒绝')).toBe('rejected');
  });

  it('未识别输入默认 rejected（I3 保守策略）', () => {
    expect(ConsoleChannel.parseDecision('maybe')).toBe('rejected');
    expect(ConsoleChannel.parseDecision('')).toBe('rejected');
  });
});

describe('ConsoleChannel.broadcast', () => {
  it('单接收者等价 send，返回单元素数组', async () => {
    const channel = new ConsoleChannel({ printer: () => {} });
    const msg = makeMessage();
    const ids = await channel.broadcast(msg);
    expect(ids).toEqual([msg.messageId]);
  });
});
