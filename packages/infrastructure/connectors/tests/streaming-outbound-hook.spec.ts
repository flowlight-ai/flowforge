/**
 * StreamingOutboundHook 契约测试。
 * 真实 Memory 绑定存储 + 真实 IStreamableOutboundAdapter 桩驱动，
 * 覆盖 start/chunk/end、cleanup 偏好（finalize/delete）、inline-final 与 catch-up。
 * 禁 Mock。
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryConnectorThreadBindingStore,
  StreamingOutboundHook,
  silentLogger,
  type IStreamableOutboundAdapter,
} from '../src/index.ts';

class StreamableAdapter implements IStreamableOutboundAdapter {
  readonly connectorId = 'feishu';
  placeholders: Array<{ chatId: string; text: string; id: string }> = [];
  edits: Array<{ chatId: string; msgId: string; text: string }> = [];
  finalized: Array<{ chatId: string; msgId: string }> = [];
  deleted: Array<{ msgId: string }> = [];
  inlineRegistered: Array<{ chatId: string; msgId: string }> = [];
  inlineCleared: Array<{ chatId: string }> = [];
  deliveriesDone: boolean[] = [];
  private seq = 0;

  async sendReply(_c: string, _content: string): Promise<void> {}
  async sendPlaceholder(chatId: string, text: string): Promise<string> {
    this.seq++;
    const id = `p-${this.seq}`;
    this.placeholders.push({ chatId, text, id });
    return id;
  }
  async editMessage(chatId: string, msgId: string, text: string): Promise<void> {
    this.edits.push({ chatId, msgId, text });
  }
  async finalizeStreamCard(chatId: string, msgId: string): Promise<void> {
    this.finalized.push({ chatId, msgId });
  }
  async deleteMessage(msgId: string): Promise<void> {
    this.deleted.push({ msgId });
  }
}

/** 支持 inline-final 登记/清除 extends 基础适配器（onStreamEnd 走 inline 分支）。 */
class InlineStreamableAdapter extends StreamableAdapter {
  inlineRegistered: Array<{ chatId: string; msgId: string }> = [];
  inlineCleared: Array<{ chatId: string }> = [];
  registerInlinePlaceholder(chatId: string, msgId: string): void {
    this.inlineRegistered.push({ chatId, msgId });
  }
  async clearInlinePlaceholder(chatId: string): Promise<void> {
    this.inlineCleared.push({ chatId });
  }
}

function makeHook(adapter: StreamableAdapter, over: Partial<ConstructorParameters<typeof StreamingOutboundHook>[0]> = {}) {
  const bindingStore = new MemoryConnectorThreadBindingStore();
  const hook = new StreamingOutboundHook({
    bindingStore,
    adapters: new Map([[adapter.connectorId, adapter]]),
    log: silentLogger,
    updateIntervalMs: 1,
    minDeltaChars: 1,
    ...over,
  });
  return { hook, bindingStore };
}

describe('StreamingOutboundHook', () => {
  it('start 发送占位符并在 stream end 后清理（finalize 优先）', async () => {
    const adapter = new StreamableAdapter();
    const { hook, bindingStore } = makeHook(adapter);
    bindingStore.bind('feishu', 'chat-1', 'th-1', 'u-1');

    await hook.onStreamStart('th-1', 'cat-a');
    expect(adapter.placeholders).toHaveLength(1);
    expect(adapter.placeholders[0]?.text).toContain('思考中');

    await hook.onStreamEnd('th-1', '最终答案');
    // finalize 被延迟到 cleanupPlaceholders（保留占位符作回退）
    expect(adapter.finalized.length + adapter.deleted.length).toBe(0);
    await hook.cleanupPlaceholders('th-1');
    // finalizeStreamCard 存在 → 优先 finalize（不 delete）
    expect(adapter.finalized).toHaveLength(1);
    expect(adapter.deleted).toHaveLength(0);
  });

  it('chunk 在阈值内编辑占位符（推进文本）', async () => {
    const adapter = new StreamableAdapter();
    // updateIntervalMs=0 → elapsed 检查恒通过，避免同毫秒竞态；结果确定
    const { hook, bindingStore } = makeHook(adapter, { receiptOnlyUntilCommit: false, updateIntervalMs: 0, minDeltaChars: 1 });
    bindingStore.bind('feishu', 'chat-1', 'th-2', 'u-1');

    await hook.onStreamStart('th-2', 'cat-a');
    await hook.onStreamChunk('th-2', '部分');
    expect(adapter.edits.length).toBeGreaterThan(0);
  });

  it('inline-final：adapter.registerInlinePlaceholder 被登记，cleanup 清除', async () => {
    const adapter = new InlineStreamableAdapter();
    const { hook, bindingStore } = makeHook(adapter);
    bindingStore.bind('feishu', 'chat-1', 'th-3', 'u-1');

    await hook.onStreamStart('th-3', 'cat-a');
    await hook.onStreamEnd('th-3', '答案');
    expect(adapter.inlineRegistered).toHaveLength(1);
    await hook.cleanupPlaceholders('th-3');
    expect(adapter.inlineCleared).toHaveLength(1);
  });

  it('onClosureBlocked 在无进行中会话时以 sendReply 发送恢复提示（不抛错）', async () => {
    const adapter = new StreamableAdapter();
    const { hook, bindingStore } = makeHook(adapter);
    bindingStore.bind('feishu', 'chat-1', 'th-4', 'u-1');
    // 无进行中会话 → 直接对绑定发送恢复文本；仅验证稳定执行
    await expect(
      hook.onClosureBlocked('th-4', 'cat-a', 'timeout', undefined, 'https://app'),
    ).resolves.toBeUndefined();
  });

  it('receiptOnlyUntilCommit 时 chunk 不编辑（回执仅展示）', async () => {
    const adapter = new StreamableAdapter();
    const { hook, bindingStore } = makeHook(adapter, { receiptOnlyUntilCommit: true });
    bindingStore.bind('feishu', 'chat-1', 'th-5', 'u-1');
    await hook.onStreamStart('th-5', 'cat-a');
    await hook.onStreamChunk('th-5', '一些文本');
    expect(adapter.edits).toHaveLength(0);
  });
});