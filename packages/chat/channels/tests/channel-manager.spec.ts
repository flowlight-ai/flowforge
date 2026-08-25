/**
 * @flowforge/chat-channels — T7.16 ChannelManager 契约验证。
 *
 * 对齐 `core/channel_manager.py` + `core/interfaces/plugin.py`：
 *   - register：按 plugin.name 注册（同名覆盖）
 *   - getChannel：未注册抛 Error（对齐 Python KeyError 语义）
 *   - listChannels / unregister
 *   - broadcastStatus：单通道异常不阻断其他通道
 *   - handleIncomingMessage：未注册通道返回 null
 *   - BaseMessageChannelPlugin 默认实现（supportedActions/onTaskStatusChange）
 *
 * @module @flowforge/chat-channels/tests
 */

import { describe, expect, it, vi } from 'vitest';
import { BaseMessageChannelPlugin } from '../src/message-channel-plugin.js';
import { ChannelManager } from '../src/channel-manager.js';

/** 可控测试通道。 */
class TestChannel extends BaseMessageChannelPlugin {
  override readonly name: string;
  override readonly description = 'test channel';
  onMessageResult: Record<string, unknown> = { ok: true };
  onTaskStatusThrows = false;

  constructor(name: string) {
    super();
    this.name = name;
  }

  override async onMessage(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
    return { ...this.onMessageResult, echo: raw };
  }

  override async sendMessage(_recipient: string, content: string): Promise<boolean> {
    return content.length > 0;
  }

  override async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('ChannelManager 注册与查询', () => {
  it('register 按 name 注册，listChannels 返回全部', () => {
    const mgr = new ChannelManager();
    mgr.register(new TestChannel('console'));
    mgr.register(new TestChannel('webchat'));
    expect(mgr.listChannels()).toEqual(['console', 'webchat']);
  });

  it('同名注册覆盖（对齐 Python dict 语义）', () => {
    const mgr = new ChannelManager();
    const first = new TestChannel('console');
    const second = new TestChannel('console');
    mgr.register(first);
    mgr.register(second);
    expect(mgr.getChannel('console')).toBe(second);
  });

  it('getChannel 未注册抛 Error；unregister 返回被移除实例或 null', () => {
    const mgr = new ChannelManager();
    const ch = new TestChannel('trae');
    mgr.register(ch);
    expect(() => mgr.getChannel('nope')).toThrow(/通道未注册/);
    expect(mgr.unregister('trae')).toBe(ch);
    expect(mgr.unregister('trae')).toBeNull();
  });
});

describe('ChannelManager 广播与分发', () => {
  it('broadcastStatus 通知所有通道 onTaskStatusChange', async () => {
    const mgr = new ChannelManager();
    const a = new TestChannel('a');
    const b = new TestChannel('b');
    const onA = vi.spyOn(a, 'onTaskStatusChange');
    const onB = vi.spyOn(b, 'onTaskStatusChange');
    mgr.register(a);
    mgr.register(b);
    await mgr.broadcastStatus('task_1', 'running', { step: 1 });
    expect(onA).toHaveBeenCalledWith('task_1', 'running', { step: 1 });
    expect(onB).toHaveBeenCalledWith('task_1', 'running', { step: 1 });
  });

  it('单通道广播异常不阻断其他通道', async () => {
    const mgr = new ChannelManager();
    const bad = new TestChannel('bad');
    bad.onTaskStatusThrows = true;
    bad.onTaskStatusChange = async () => {
      if (bad.onTaskStatusThrows) throw new Error('boom');
      return true;
    };
    const good = new TestChannel('good');
    const onGood = vi.spyOn(good, 'onTaskStatusChange');
    mgr.register(bad);
    mgr.register(good);
    await expect(mgr.broadcastStatus('t1', 'done', {})).resolves.toBeUndefined();
    expect(onGood).toHaveBeenCalledTimes(1);
  });

  it('handleIncomingMessage 分发到对应通道，未注册返回 null', async () => {
    const mgr = new ChannelManager();
    const ch = new TestChannel('console');
    mgr.register(ch);
    const result = await mgr.handleIncomingMessage('console', { text: 'hi' });
    expect(result).toMatchObject({ ok: true, echo: { text: 'hi' } });
    expect(await mgr.handleIncomingMessage('missing', {})).toBeNull();
  });
});

describe('BaseMessageChannelPlugin 默认实现', () => {
  it('supportedActions 默认 [pass, reject]；onTaskStatusChange 默认 true', async () => {
    const ch = new TestChannel('console');
    expect(ch.supportedActions).toEqual(['pass', 'reject']);
    expect(ch.description).toBe('test channel');
    expect(await ch.onTaskStatusChange('t1', 'ok', {})).toBe(true);
    expect(await ch.sendMessage('someone', 'hello')).toBe(true);
    expect(await ch.sendMessage('someone', '')).toBe(false);
  });
});
