/**
 * @flowforge/forgekin-im-council — T7.16 WebChatChannel 契约验证。
 *
 * 对齐 `core/im_council.py` 的 WebChatChannel（F047 §2.2 Phase 2 骨架）：
 *   - send：骨架降级返回 message_id（不抛异常，保持 I1 降级链路）
 *   - wait_reply：骨架返回 null（触发 I4 超时拒绝）
 *   - broadcast：骨架返回空数组
 *
 * @module @flowforge/forgekin-im-council/tests
 */

import { describe, expect, it } from 'vitest';
import { WebChatChannel } from '../src/webchat-channel.js';
import { newCouncilMessage } from '../src/models.js';

function makeMessage() {
  return newCouncilMessage({
    channel: 'webchat',
    forgekinId: 'sherlock',
    content: 'test',
  });
}

describe('WebChatChannel（Phase 2 骨架降级）', () => {
  it('send 不抛异常，返回 message_id 并记录降级日志', async () => {
    const logs: string[] = [];
    const channel = new WebChatChannel({
      websocketUrl: 'ws://localhost:9999/ws/im',
      logger: (t) => logs.push(t),
    });
    const msg = makeMessage();
    const msgId = await channel.send(msg);
    expect(msgId).toBe(msg.messageId);
    expect(logs.join('\n')).toContain('skeleton not implemented');
    expect(logs.join('\n')).toContain('ws://localhost:9999/ws/im');
  });

  it('wait_reply 返回 null（触发 I4 超时拒绝链路）', async () => {
    const channel = new WebChatChannel();
    const reply = await channel.wait_reply('council_msg_1', 5);
    expect(reply).toBeNull();
  });

  it('broadcast 返回空数组（Phase 2 未实现）', async () => {
    const channel = new WebChatChannel();
    const ids = await channel.broadcast(makeMessage());
    expect(ids).toEqual([]);
  });

  it('channelName = webchat', () => {
    expect(new WebChatChannel().channelName).toBe('webchat');
  });
});
