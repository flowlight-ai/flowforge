/**
 * OutboundDeliveryHook 契约测试。
 * 真实 Memory 绑定存储 + 真实 IOutboundAdapter 桩（记录发送调用）驱动，
 * 覆盖富块解码、媒体（data-uri → 真实临时文件）、format/formatted 回退与 limb fanout。
 * 禁 Mock。
 */

import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import type { RichBlock } from '@flowforge/cats-shared';
import {
  MemoryConnectorThreadBindingStore,
  OutboundDeliveryHook,
  silentLogger,
  type OutboundDeliveryHookOptions,
  type IOutboundAdapter,
} from '../src/index.ts';
import type { MessageEnvelope } from '../src/connector-message-formatter';

class RecordingAdapter implements IOutboundAdapter {
  readonly connectorId = 'feishu';
  readonly formatted: MessageEnvelope[] = [];
  readonly rich: Array<{ text: string; blocks: RichBlock[] }> = [];
  readonly media: Array<Record<string, unknown>> = [];
  readonly replies: string[] = [];

  async sendReply(_c: string, content: string): Promise<void> {
    this.replies.push(content);
  }
  async sendFormattedReply(_c: string, env: MessageEnvelope): Promise<void> {
    this.formatted.push(env);
  }
  async sendRichMessage(_c: string, text: string, blocks: RichBlock[]): Promise<void> {
    this.rich.push({ text, blocks });
  }
  async sendMedia(_c: string, payload: { type: string }): Promise<void> {
    this.media.push(payload as Record<string, unknown>);
  }
}

function makeHook(over: Partial<OutboundDeliveryHookOptions> = {}) {
  const bindingStore = new MemoryConnectorThreadBindingStore();
  const adapters = new Map<string, IOutboundAdapter>();
  const adapter = new RecordingAdapter();
  adapters.set('feishu', adapter);
  const limb = { deliverCalls: 0 };
  const hook = new OutboundDeliveryHook({
    bindingStore,
    adapters,
    log: silentLogger,
    catLookup: (id: string) => (id === 'cat-a' ? { displayName: '宪宪' } : undefined),
    limbDelivery: {
      deliver: async () => {
        limb.deliverCalls++;
      },
    },
    ...over,
  });
  return { hook, adapter, bindingStore, limb };
}

describe('OutboundDeliveryHook', () => {
  it('绑定线程收到纯文本 → 走 sendFormattedReply 并带身份前缀', async () => {
    const { hook, adapter, bindingStore } = makeHook();
    bindingStore.bind('feishu', 'chat-1', 'th-1', 'u-1');
    await hook.deliver('th-1', '结果如下', 'cat-a', undefined, {
      threadShortId: 'T1',
      threadTitle: '排查',
    });
    expect(adapter.formatted).toHaveLength(1);
    expect(adapter.formatted[0]?.body).toBe('结果如下');
    expect(adapter.replies).toHaveLength(0);
  });

  it('携带富块 → 走 sendRichMessage', async () => {
    const { hook, adapter, bindingStore } = makeHook();
    bindingStore.bind('feishu', 'chat-1', 'th-2', 'u-1');
    const blocks: RichBlock[] = [{ id: 'b1', kind: 'card', v: 1, title: '📋 分析', bodyMarkdown: '结论' }];
    await hook.deliver('th-2', '内容', 'cat-a', blocks);
    expect(adapter.rich).toHaveLength(1);
    expect(adapter.rich[0]?.blocks).toEqual(blocks);
  });

  it('无绑定但有 limbDelivery 时仍触发 limb fanout 且不抛错', async () => {
    const { hook, limb } = makeHook();
    await hook.deliver('th-none', '内容');
    expect(limb.deliverCalls).toBe(1);
  });

  it('media_gallery data-uri 图片 → 写真实临时文件后 sendMedia + 清理', async () => {
    const { hook, adapter, bindingStore } = makeHook();
    bindingStore.bind('feishu', 'chat-1', 'th-3', 'u-1');
    const dataUri =
      'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
    const blocks: RichBlock[] = [
      { id: 'b1', kind: 'media_gallery', v: 1, title: '截图', items: [{ url: dataUri, caption: '主界面' }] },
    ];
    await hook.deliver('th-3', '见图', 'cat-a', blocks);

    const mediaCall = adapter.media.find((m) => m.type === 'image');
    expect(mediaCall).toBeDefined();
    const absPath = mediaCall?.absPath as string;
    expect(absPath).toContain(tmpdir());
    expect(existsSync(absPath)).toBe(false); // 交付后已清理
  });

  it('非格式路径：仅 sendReply 适配器收到纯文本 + limb fanout', async () => {
    const { bindingStore } = makeHook();
    const adapter = new PlainOnlyAdapter();
    const hook = new OutboundDeliveryHook({
      bindingStore,
      adapters: new Map<string, IOutboundAdapter>([['telegram', adapter]]),
      log: silentLogger,
      catLookup: () => undefined,
    });
    bindingStore.bind('telegram', 'chat-1', 'th-4', 'u-1');
    await hook.deliver('th-4', '普通回复', 'cat-a');
    // 仅支持 sendReply → 走纯文本路径
    expect(adapter.replies).toEqual(['普通回复']);
  });
});

/** 仅支持 sendReply 的适配器桩。 */
class PlainOnlyAdapter implements IOutboundAdapter {
  readonly connectorId = 'telegram';
  readonly replies: string[] = [];
  async sendReply(_c: string, content: string): Promise<void> {
    this.replies.push(content);
  }
}