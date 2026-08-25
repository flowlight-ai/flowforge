/**
 * @flowforge/forgekin-im-council — T7.16 TraeBridgeChannel 契约验证。
 *
 * 对齐 `core/im_council.py` 的 TraeBridgeChannel（F047 §2.2 完整实现）：
 *   - send：复用 F045 文件协议 writeRequest（request_id = message_id）
 *   - wait_reply：pollResponse 解析 approve/reject → decision；
 *     含 ? → question；其余 → comment；异常/超时返回 null（I4）
 *   - broadcast：单 bridge_dir 等价 send
 *
 * @module @flowforge/forgekin-im-council/tests
 */

import { describe, expect, it, vi } from 'vitest';
import { TraeBridgeChannel } from '../src/trae-channel.js';
import { newCouncilMessage } from '../src/models.js';

/** 最小 mock protocol（只实现 im-council 用到的两个方法）。 */
function makeMockProtocol(options: {
  pollResult?: { content?: string } | null;
  pollThrows?: boolean;
}) {
  const writeRequest = vi.fn(async (
    _messages: unknown[],
    _context: unknown,
    opts: { requestId?: string } = {},
  ) => opts.requestId ?? 'generated');
  const pollResponse = vi.fn(async () => {
    if (options.pollThrows) throw new Error('timeout');
    return options.pollResult ?? { content: '' };
  });
  return {
    writeRequest,
    pollResponse,
    // 假装满足 TraeBridgeProtocol 类型的最小结构（as any 仅在测试）
    asProtocol: { writeRequest, pollResponse } as unknown as import('@flowforge/forgekin-trae-bridge/protocol').TraeBridgeProtocol,
  };
}

function makeMessage() {
  return newCouncilMessage({
    channel: 'trae',
    forgekinId: 'sherlock',
    content: '请审批 PR #1\n修复登录页',
    messageType: 'approval_request',
    payload: { request_id: 'req_1', pr_url: 'https://gitee.com/x/y/pulls/1' },
  });
}

describe('TraeBridgeChannel.send', () => {
  it('写入 request 文件（request_id = message_id）并返回', async () => {
    const mock = makeMockProtocol({});
    const channel = new TraeBridgeChannel({ protocol: mock.asProtocol });
    const msg = makeMessage();
    const rid = await channel.send(msg);
    expect(rid).toBe(msg.messageId);
    expect(mock.writeRequest).toHaveBeenCalledTimes(1);
    const [messages, context] = mock.writeRequest.mock.calls[0]!;
    expect(context).toMatchObject({ forgekin_id: 'sherlock', task_type: 'council_approval' });
    const first = messages[0] as { content?: string } | undefined;
    expect(String(first?.content ?? '')).toContain('请审批 PR #1');
    expect(String(first?.content ?? '')).toContain('附加数据');
  });
});

describe('TraeBridgeChannel.wait_reply', () => {
  it('approve 回复 → decision 回复', async () => {
    const mock = makeMockProtocol({ pollResult: { content: 'approve' } });
    const channel = new TraeBridgeChannel({ protocol: mock.asProtocol });
    const reply = await channel.wait_reply('council_msg_1', 10);
    expect(reply).not.toBeNull();
    expect(reply!.content).toBe('approve');
    expect(reply!.replyType).toBe('decision');
    expect(reply!.replier).toBe('operator');
  });

  it('自然语言含 ? → question 类型', async () => {
    const mock = makeMockProtocol({ pollResult: { content: '这个改动影响哪些页面？' } });
    const channel = new TraeBridgeChannel({ protocol: mock.asProtocol });
    const reply = await channel.wait_reply('council_msg_1', 10);
    expect(reply!.replyType).toBe('question');
    expect(reply!.content).toBe('这个改动影响哪些页面？');
  });

  it('其他内容 → comment 类型', async () => {
    const mock = makeMockProtocol({ pollResult: { content: '补充一下测试覆盖' } });
    const channel = new TraeBridgeChannel({ protocol: mock.asProtocol });
    const reply = await channel.wait_reply('council_msg_1', 10);
    expect(reply!.replyType).toBe('comment');
  });

  it('超时/协议异常 → null（I4 触发超时拒绝）', async () => {
    const mock = makeMockProtocol({ pollThrows: true });
    const channel = new TraeBridgeChannel({ protocol: mock.asProtocol });
    const reply = await channel.wait_reply('council_msg_1', 1);
    expect(reply).toBeNull();
  });
});

describe('TraeBridgeChannel.broadcast', () => {
  it('单目录写入等价 send', async () => {
    const mock = makeMockProtocol({});
    const channel = new TraeBridgeChannel({ protocol: mock.asProtocol });
    const msg = makeMessage();
    const ids = await channel.broadcast(msg);
    expect(ids).toEqual([msg.messageId]);
  });
});
