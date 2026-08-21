/**
 * IM 通道 ports（T5.10 / stage-map §3.4 S1，stretch）。
 *
 * 移植 clowder-ai `callback-lark-action-routes.ts` / `callback-wecom-action-routes.ts`
 * / `connector-webhooks.ts` 的通道语义为纯接口 + mock 实现：
 * - 通道种类：飞书（lark）/ 企微（wecom）/ Telegram / 钉钉（dingtalk）/ WebChat
 * - `IImChannelAdapter`：出站发送 + 入站回调归一化处理 + 健康检查
 * - `ImChannelRegistry`：按 kind 注册/查找（真实适配器按凭据在组合根装配，
 *   stretch 阶段仅 mock）
 *
 * R13 一切皆插件：本模块仅定义 ports（无模块级状态），适配器由插件装配层
 * （`src/index.ts` 的 ChatStretchService）持有。
 *
 * @module @flowforge/chat-stretch/im-ports
 */

/** 通道种类全集（S1 有界集合）。 */
export const IM_CHANNEL_KINDS = ['lark', 'wecom', 'telegram', 'dingtalk', 'webchat'] as const
export type ImChannelKind = (typeof IM_CHANNEL_KINDS)[number]

/** 出站消息最小公共形状（发送到 IM 通道）。 */
export interface ImOutboundMessage {
  /** 接收者/会话标识（open_id / chat_id / user_id / room id）。 */
  target: string
  /** 纯文本内容。 */
  text: string
  /** 可选交互卡片（action 卡，飞书/企微 card 语义）。 */
  card?: ImCardPayload | undefined
}

/** 交互卡片负载（对齐 clowder action-card 语义）。 */
export interface ImCardPayload {
  title?: string | undefined
  body?: string | undefined
  actions?: Array<{ id: string; label: string; value?: string | undefined }> | undefined
}

/** 入站回调事件（action 卡 / 消息回调归一化形状）。 */
export interface ImInboundEvent {
  kind: ImChannelKind
  /** 通道回调原始负载（未知通道字段透传）。 */
  raw: Record<string, unknown>
  /** 归一化 action：卡片按钮回调（callback-*-action-routes 语义）。 */
  action?: { cardId: string; actionId: string; actor: string; value?: string | undefined } | undefined
  /** 归一化消息：文本消息到达。 */
  message?: { from: string; threadId?: string | undefined; text: string } | undefined
}

/** 出站发送结果。 */
export interface ImSendResult {
  delivered: boolean
  channelMessageId?: string | undefined
}

/** 入站回调处理结论。 */
export type ImInboundOutcome = 'handled' | 'ignored' | 'error'

/** 通道健康快照。 */
export interface ImHealth {
  ok: boolean
  latencyMs?: number | undefined
  detail?: string | undefined
}

/** IM 通道适配器端口。stretch 阶段仅 mock 实现；真实适配器（飞书/企微等）按凭据在阶段 11+ 落地。 */
export interface IImChannelAdapter {
  readonly kind: ImChannelKind
  send(message: ImOutboundMessage): Promise<ImSendResult>
  handleInbound(event: ImInboundEvent): Promise<ImInboundOutcome>
  health(): Promise<ImHealth>
}

/** 通道注册表：按 kind 注册/查找（组合根装配真实 adapter，缺省 mock）。 */
export class ImChannelRegistry {
  private readonly adapters = new Map<ImChannelKind, IImChannelAdapter>()

  register(adapter: IImChannelAdapter): void {
    this.adapters.set(adapter.kind, adapter)
  }

  get(kind: ImChannelKind): IImChannelAdapter | undefined {
    return this.adapters.get(kind)
  }

  list(): IImChannelAdapter[] {
    return [...this.adapters.values()]
  }

  listKinds(): ImChannelKind[] {
    return [...this.adapters.keys()]
  }
}
