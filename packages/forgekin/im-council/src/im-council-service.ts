/**
 * @flowforge/forgekin-im-council — 阶段7 T7.16 IM 议事 Cordis 插件。
 *
 * 挂载 `ctx.forgeImCouncil`：
 *   - manager: IMCouncilManager（F047 §2.4 多通道议事 + CL-033 ApprovalHub 集成）
 *   - channels: 已注册通道表（console / webchat / trae）
 *
 * TS 重写自 Python `core/im_council.py`（F047）+ `config/im_council.yaml`
 * 配置语义（铁律 5 参数外置、红线 11 路径占位符、红线 12 DI 注入）。
 * 通道实例由 options 注入（缺省按配置新建 Console/WebChat/Trae 通道）。
 *
 * @module @flowforge/forgekin-im-council
 */

import { Context, Service } from '@flowforge/cordis';
import { IMCouncilChannel } from './channel.js';
import { ConsoleChannel, type ConsoleChannelOptions } from './console-channel.js';
import { IMCouncilManager, type IMCouncilConfig } from './im-council-manager.js';
import { TraeBridgeChannel } from './trae-channel.js';
import { WebChatChannel, type WebChatChannelOptions } from './webchat-channel.js';

export * from './models.js';
export * from './channel.js';
export * from './console-channel.js';
export * from './webchat-channel.js';
export * from './trae-channel.js';
export * from './im-council-manager.js';

/** im-council 插件选项（对齐 im_council.yaml 结构，铁律 5 配置外置）。 */
export interface ImCouncilServiceOptions {
  /** ApprovalHub 实例（CL-033，必须注入）。 */
  readonly approvalHub: IMCouncilManagerOptions['approvalHub'];
  /** 议事配置（default_channel / approval / archive 段）。 */
  readonly config?: IMCouncilConfig | undefined;
  /** 手动注册的通道（按通道名；缺省按 config.channels 新建）。 */
  readonly channels?: Partial<Record<string, IMCouncilChannel>> | undefined;
  /** console 通道选项（缺省自动注册 enabled=true）。 */
  readonly consoleOptions?: ConsoleChannelOptions | undefined;
  /** webchat 通道选项（缺省注册但骨架降级）。 */
  readonly webchatOptions?: WebChatChannelOptions | undefined;
  /** trae 通道选项。 */
  readonly traeOptions?: TraeBridgeChannelOptions | undefined;
}

import type { IMCouncilManagerOptions } from './im-council-manager.js';
import type { TraeBridgeChannelOptions } from './trae-channel.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** IM 议事域：多通道议事管理器 + 已注册通道 */
    forgeImCouncil: ImCouncilService;
  }
}

/**
 * IM 议事域服务 — 通道注册 + 五步议事流程统一入口。
 *
 * 组装：manager（IMCouncilManager）+ channels（通道实例表）。
 * requestApproval 为唯一公开审批入口（I3 不变量）。
 */
export class ImCouncilService extends Service {
  readonly manager: IMCouncilManager;
  readonly channels: ReadonlyMap<string, IMCouncilChannel>;

  constructor(ctx: Context, options: ImCouncilServiceOptions) {
    super(ctx, 'forgeImCouncil');
    const channels = new Map<string, IMCouncilChannel>();
    // 缺省按配置注册三通道（对齐 im_council.yaml channels 段）
    if (options.channels === undefined) {
      channels.set('console', new ConsoleChannel(options.consoleOptions));
      channels.set('webchat', new WebChatChannel(options.webchatOptions));
      if (options.traeOptions !== undefined) {
        channels.set('trae', new TraeBridgeChannel(options.traeOptions));
      }
    } else {
      for (const [name, channel] of Object.entries(options.channels)) {
        if (channel !== undefined) channels.set(name, channel);
      }
    }
    const manager = new IMCouncilManager({
      approvalHub: options.approvalHub,
      config: options.config,
    });
    for (const [name, channel] of channels) {
      manager.registerChannel(name, channel);
    }
    this.manager = manager;
    this.channels = channels;
  }

  /** 审批便捷委托（I3 唯一公开入口）。 */
  requestApproval(...args: Parameters<IMCouncilManager['requestApproval']>): Promise<boolean> {
    return this.manager.requestApproval(...args);
  }

  /** 发送消息给 operator 便捷委托（I1 降级链路）。 */
  sendToOperator(...args: Parameters<IMCouncilManager['sendToOperator']>): Promise<string> {
    return this.manager.sendToOperator(...args);
  }
}

export default function Plugin(
  ctx: Context,
  options: ImCouncilServiceOptions,
): void {
  ctx.forgeImCouncil = new ImCouncilService(ctx, options);
}
