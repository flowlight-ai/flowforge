/**
 * @flowforge/chat-channels — T7.16 ChannelManager（通道管理器）。
 *
 * TS 重写自 Python `core/channel_manager.py`：
 *   - register：注册通道插件（按 plugin.name 为键）
 *   - getChannel / listChannels：查询
 *   - broadcastStatus：任务状态变更广播（单通道失败不影响其他通道）
 *   - handleIncomingMessage：按通道名分发入站消息（未注册返回 null）
 *
 * @module @flowforge/chat-channels
 */

import { MessageChannelPlugin } from './message-channel-plugin.js';

/** 通道管理器 — 注册与分发消息通道插件。 */
export class ChannelManager {
  private readonly channels = new Map<string, MessageChannelPlugin>();

  /** 注册通道插件（同名覆盖，对齐 Python dict 语义）。 */
  register(plugin: MessageChannelPlugin): void {
    this.channels.set(plugin.name, plugin);
  }

  /** 注销通道插件（不存在时返回 null）。 */
  unregister(name: string): MessageChannelPlugin | null {
    const plugin = this.channels.get(name);
    if (plugin !== undefined) {
      this.channels.delete(name);
    }
    return plugin ?? null;
  }

  /** 获取通道插件（未注册抛 Error，对齐 Python KeyError 语义）。 */
  getChannel(name: string): MessageChannelPlugin {
    const plugin = this.channels.get(name);
    if (plugin === undefined) {
      throw new Error(`通道未注册: ${name}`);
    }
    return plugin;
  }

  /** 列出所有已注册通道名。 */
  listChannels(): string[] {
    return [...this.channels.keys()];
  }

  /** 任务状态变更广播：单通道异常仅记录，不阻断其他通道。 */
  async broadcastStatus(
    taskId: string,
    status: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    for (const channel of this.channels.values()) {
      try {
        await channel.onTaskStatusChange(taskId, status, meta);
      } catch {
        // 对齐 Python logger.error：单通道失败不影响整体广播
      }
    }
  }

  /** 按通道名分发入站消息；通道未注册返回 null。 */
  async handleIncomingMessage(
    channelName: string,
    rawMessage: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const channel = this.channels.get(channelName);
    if (channel === undefined) return null;
    return channel.onMessage(rawMessage);
  }
}
