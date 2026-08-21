/**
 * IM 通道 mock 实现（T5.10 stretch）：内存发送记录 + 可编程回调结论。
 *
 * 真实通道（飞书/企微/Telegram/钉钉/WebChat）按凭据启用（阶段 11+），
 * stretch 阶段以本 mock 验证 ports 契约与编排语义。
 *
 * @module @flowforge/chat-stretch/mock
 */

import type {
  ImChannelKind,
  IImChannelAdapter,
  ImHealth,
  ImInboundEvent,
  ImInboundOutcome,
  ImOutboundMessage,
  ImSendResult,
} from '../im-ports.ts'

export interface InMemoryImChannelOptions {
  /** 入站回调处理结论（可编程，默认 'handled'）。 */
  inboundOutcome?: ImInboundOutcome | undefined
  /** 健康检查是否故障（默认 ok）。 */
  unhealthy?: boolean | undefined
}

/** 内存 IM 通道 mock：记录出站消息、可编程回放入站结论、健康检查。 */
export class InMemoryImChannelAdapter implements IImChannelAdapter {
  readonly kind: ImChannelKind
  /** 全部已发送出站消息（发送时序可断言）。 */
  readonly sent: ImOutboundMessage[] = []
  private readonly inboundOutcome: ImInboundOutcome
  private readonly unhealthy: boolean

  constructor(kind: ImChannelKind, options: InMemoryImChannelOptions = {}) {
    this.kind = kind
    this.inboundOutcome = options.inboundOutcome ?? 'handled'
    this.unhealthy = options.unhealthy ?? false
  }

  async send(message: ImOutboundMessage): Promise<ImSendResult> {
    this.sent.push(message)
    return { delivered: true, channelMessageId: `${this.kind}:${this.sent.length}` }
  }

  async handleInbound(_event: ImInboundEvent): Promise<ImInboundOutcome> {
    return this.inboundOutcome
  }

  async health(): Promise<ImHealth> {
    return this.unhealthy
      ? { ok: false, detail: `mock ${this.kind} channel unhealthy` }
      : { ok: true, latencyMs: 0 }
  }
}
