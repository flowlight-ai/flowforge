/**
 * 飞书 → connector gateway 出站桥接（S1 stretch）。
 *
 * 将 `IImChannelAdapter`（飞书 `kind: 'lark'`）暴露为 connector gateway
 * `IOutboundAdapter` 所需的结构形状（`connectorId` + `sendReply`）。为避免
 * stretch-ports 对 `@flowforge/infrastructure-connectors` 的构建图耦合，本桥
 * 不 import 该包类型——仅实现其抽取接口的**必需**子集（其余方法皆为可选），
 * 宿主组合根直接以此对象作为 `adapters` 项注入 gateway（TS 结构化类型即兼容）。
 *
 * connectorId 固定为 `feishu`，与 `@flowforge/cats-shared` connector 注册表
 * 已有的 `feishu` connector id 对齐。
 *
 * @module @flowforge/chat-stretch/feishu-connector-outbound
 */

import type { IImChannelAdapter } from '../im-ports.ts'

/** 与 `IOutboundAdapter` 的必需子集结构一致（`connectorId` + `sendReply`）。 */
export interface IConnectorOutboundBridgeShape {
  readonly connectorId: string
  sendReply(externalChatId: string, content: string, metadata?: Record<string, unknown>): Promise<void>
}

/**
 * 飞书 connector 出站桥。把 IImChannelAdapter 的 send() 适配为 gateway 的
 * sendReply()；飞书投递失败（含 S1 未配置降级 delivered:false）时抛错，
 * 交由 OutboundDeliveryHook 统一记录。
 */
export class FeishuConnectorOutboundAdapter implements IConnectorOutboundBridgeShape {
  readonly connectorId = 'feishu' as const

  constructor(private readonly channel: IImChannelAdapter) {}

  async sendReply(
    externalChatId: string,
    content: string,
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.channel.send({ target: externalChatId, text: content })
    if (!result.delivered) {
      throw new Error('feishu outbound send failed (delivered:false — channel degraded or API error)')
    }
  }
}

/** 便捷工厂：由飞书 IImChannelAdapter 构造 connector 出站桥。 */
export function createFeishuConnectorOutboundAdapter(
  channel: IImChannelAdapter,
): FeishuConnectorOutboundAdapter {
  return new FeishuConnectorOutboundAdapter(channel)
}