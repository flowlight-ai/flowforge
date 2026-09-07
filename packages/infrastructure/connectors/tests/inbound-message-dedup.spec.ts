/**
 * InboundMessageDedup 去重契约测试。
 * 覆盖跨 connector/会话/消息 ID 的唯一性、重复命中、容量淘汰。
 */

import { describe, expect, it } from 'vitest';

import { InboundMessageDedup } from '../src/index.ts';

describe('InboundMessageDedup', () => {
  it('首次消息不判重，重复消息判重', () => {
    const dedup = new InboundMessageDedup();
    expect(dedup.isDuplicate('feishu', 'chat-1', 'm-1')).toBe(false);
    expect(dedup.isDuplicate('feishu', 'chat-1', 'm-1')).toBe(true);
  });

  it('去重键隔离 connector / chatId / messageId', () => {
    const dedup = new InboundMessageDedup();
    dedup.isDuplicate('feishu', 'chat-1', 'm-1');
    expect(dedup.isDuplicate('feishu', 'chat-2', 'm-1')).toBe(false);
    expect(dedup.isDuplicate('telegram', 'chat-1', 'm-1')).toBe(false);
    expect(dedup.isDuplicate('feishu', 'chat-1', 'm-2')).toBe(false);
  });

  it('容量达到上限后淘汰最旧插入条目（FIFO eviction）', () => {
    const dedup = new InboundMessageDedup(3);
    // 存入 3 个不同键占满容量
    for (const id of ['a', 'b', 'c']) expect(dedup.isDuplicate('feishu', 'chat-1', id)).toBe(false);

    // 再插入第 4 个全新键触发淘汰：最旧的 'a' 被移除，'b'/'c' 留存
    expect(dedup.isDuplicate('feishu', 'chat-1', 'd')).toBe(false);
    expect(dedup.isDuplicate('feishu', 'chat-1', 'b')).toBe(true);
    expect(dedup.isDuplicate('feishu', 'chat-1', 'c')).toBe(true);

    // 已被淘汰的 'a' 重新可见（其再插入会继续按 FIFO 淘汰最旧的 'b'）
    expect(dedup.isDuplicate('feishu', 'chat-1', 'a')).toBe(false);
  });
});