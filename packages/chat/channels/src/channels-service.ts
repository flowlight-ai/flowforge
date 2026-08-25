/**
 * @flowforge/chat-channels — 阶段7 T7.16 通道管理 Cordis 插件。
 *
 * 挂载 `ctx.chatChannels`：
 *   - manager: ChannelManager（注册/分发/广播消息通道插件）
 *   - plugins: 已注册插件表（options 注入，红线 12）
 *
 * TS 重写自 Python `core/channel_manager.py` + `core/interfaces/plugin.py`
 * （MessageChannelPlugin 契约），chat 域通道统一入口。
 *
 * @module @flowforge/chat-channels
 */

import { Context, Service } from '@flowforge/cordis';
import { ChannelManager } from './channel-manager.js';
import { MessageChannelPlugin } from './message-channel-plugin.js';

export * from './message-channel-plugin.js';
export * from './channel-manager.js';

/** 通道管理插件选项（插件实例由 options 注入，红线 12）。 */
export interface ChannelsServiceOptions {
  /** 初始注册的通道插件（按 plugin.name 注册）。 */
  readonly plugins?: readonly MessageChannelPlugin[] | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 通道管理域：消息通道插件注册 / 分发 / 状态广播 */
    chatChannels: ChannelsService;
  }
}

/**
 * 通道管理域服务 — 消息通道插件统一调度入口。
 *
 * 组装：manager（ChannelManager）+ 初始插件注册。
 * broadcastStatus / handleIncomingMessage 为任务状态与入站消息统一入口。
 */
export class ChannelsService extends Service {
  readonly manager: ChannelManager;

  constructor(ctx: Context, options: ChannelsServiceOptions = {}) {
    super(ctx, 'chatChannels');
    const manager = new ChannelManager();
    for (const plugin of options.plugins ?? []) {
      manager.register(plugin);
    }
    this.manager = manager;
  }

  /** 注册通道插件便捷委托。 */
  register(plugin: MessageChannelPlugin): void {
    this.manager.register(plugin);
  }

  /** 任务状态广播便捷委托。 */
  broadcastStatus(
    taskId: string,
    status: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    return this.manager.broadcastStatus(taskId, status, meta);
  }

  /** 入站消息分发便捷委托。 */
  handleIncomingMessage(
    channelName: string,
    rawMessage: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    return this.manager.handleIncomingMessage(channelName, rawMessage);
  }
}

export default function Plugin(
  ctx: Context,
  options: ChannelsServiceOptions = {},
): void {
  ctx.chatChannels = new ChannelsService(ctx, options);
}
