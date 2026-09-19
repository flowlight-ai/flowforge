/**
 * 真实飞书通道适配器（S1 stretch）。
 *
 * 实现 `IImChannelAdapter`（`kind: 'lark'`），移植 clowder-ai feishu 群发送
 * 语义为真实的飞书 OpenAPI v2 出站：
 * - 先 `auth/v3/tenant_access_token/internal` 换取 tenant_access_token
 * - 再 `im/v1/messages?receive_id_type=<type>` 发送 text / interactive_card
 * - 入站回调归一化：识别 `url_verification` / 消息 / 卡片 action 负载
 *
 * S1 决策（配置探测 → 降级）：凭据不齐（`!isFeishuConfigured`）时本适配器
 * 不回退为平台级 mock 实例，而是**自身**降级——出站仅本地记录返回
 * `delivered:false`（不伪造飞书投递）、入站返回 `ignored`、健康检查返回
 * `ok:false` + 缺键诊断。装配层据此保持既有 mock 装配不被破坏（R13 一切皆插件，
 * 无模块级状态，全部经构造注入）。
 *
 * HTTP 传输注入式（缺省 `globalThis.fetch`），与代码库既有 HTTP 约定一致。
 *
 * @module @flowforge/chat-stretch/feishu-im-channel
 */

import type {
  IImChannelAdapter,
  ImCardPayload,
  ImHealth,
  ImInboundEvent,
  ImInboundOutcome,
  ImOutboundMessage,
  ImSendResult,
} from '../im-ports.ts'
import {
  FEISHU_DEFAULT_BASE_URL,
  feishuConfigGap,
  isFeishuConfigured,
  type FeishuChannelConfig,
  type FeishuReceiveIdType,
} from './feishu-config.ts'

export interface FeishuImChannelOptions {
  /** 飞书通道配置（appId/appSecret/chatId/baseUrl/receiveIdType）。 */
  config: FeishuChannelConfig
  /** 注入 HTTP 传输（缺省 globalThis.fetch；测试注入 fake）。 */
  fetchImpl?: typeof fetch | undefined
}

interface TenantTokenResponse {
  code?: number | undefined
  msg?: string | undefined
  tenant_access_token?: string | undefined
  expire?: number | undefined
}

interface SendMessageResponse {
  code?: number | undefined
  msg?: string | undefined
  data?: { message_id?: string } | undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * 真实飞书通道适配器。凭据齐备走 OpenAPI，否则自身降级（记录 + 健康降级）。
 */
export class FeishuImChannelAdapter implements IImChannelAdapter {
  readonly kind = 'lark' as const
  readonly configured: boolean
  /** 全部已发送出站消息（含降级期本地记录，时序可断言）。 */
  readonly sent: ImOutboundMessage[] = []
  private readonly baseUrl: string
  private readonly receiveIdType: FeishuReceiveIdType
  private readonly appId: string | undefined
  private readonly appSecret: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(options: FeishuImChannelOptions) {
    const { config } = options
    this.configured = isFeishuConfigured(config)
    this.baseUrl = config.baseUrl ?? FEISHU_DEFAULT_BASE_URL
    this.receiveIdType = config.receiveIdType ?? 'chat_id'
    this.appId = config.appId
    this.appSecret = config.appSecret
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  async send(message: ImOutboundMessage): Promise<ImSendResult> {
    this.sent.push(message)
    if (!this.configured) {
      // S1 降级：缺凭据不伪造飞书投递，仅本地记录（健康检查呈现 ok:false）。
      return { delivered: false }
    }
    try {
      if (message.card) {
        return await this.sendCard(message.target, message.text, message.card)
      }
      return await this.sendText(message.target, message.text)
    } catch {
      return { delivered: false }
    }
  }

  async handleInbound(_event: ImInboundEvent): Promise<ImInboundOutcome> {
    if (!this.configured) return 'ignored'
    return this.normalizeInbound(_event.raw)
  }

  async health(): Promise<ImHealth> {
    if (!this.configured) {
      return { ok: false, latencyMs: 0, detail: feishuConfigGap({ appId: this.appId, appSecret: this.appSecret, chatId: undefined }) }
    }
    try {
      const started = Date.now()
      await this.resolveTenantToken()
      return { ok: true, latencyMs: Date.now() - started }
    } catch {
      return { ok: false, detail: 'feishu token probe failed' }
    }
  }

  // -------------------------------------------------------------------------
  // 入站归一化（align callback-lark-action-routes 语义的薄弱形状）
  // -------------------------------------------------------------------------

  private normalizeInbound(raw: Record<string, unknown>): ImInboundOutcome {
    if (raw['type'] === 'url_verification') return 'handled'
    const event = asRecord(raw['event'])
    if (!event) return 'ignored'
    // 卡片按钮回调 → handled
    const action = event['action']
    if (action && typeof action === 'object') return 'handled'
    // 消息回调（含文本）→ handled
    const message = event['message']
    if (message && typeof message === 'object') return 'handled'
    return 'ignored'
  }

  // -------------------------------------------------------------------------
  // 出站（text / interactive_card）
  // -------------------------------------------------------------------------

  private async sendText(target: string, text: string): Promise<ImSendResult> {
    const token = (await this.resolveTenantToken()).token
    const body = JSON.stringify({
      receive_id: target,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    })
    const data = await this.postJson<SendMessageResponse>(
      `${this.baseUrl}/im/v1/messages?receive_id_type=${this.receiveIdType}`,
      token,
      body,
    )
    if (data.code !== 0 || !data.data?.message_id) return { delivered: false }
    return { delivered: true, channelMessageId: data.data.message_id }
  }

  private async sendCard(target: string, text: string, card: ImCardPayload): Promise<ImSendResult> {
    const token = (await this.resolveTenantToken()).token
    const elements: unknown[] = []
    if (card.title && card.body) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${card.title}**\n${card.body}` } })
    } else if (card.title || card.body) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: card.title ?? card.body ?? '' } })
    } else {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: text } })
    }
    if (card.actions && card.actions.length > 0) {
      elements.push({
        tag: 'action',
        actions: card.actions.map((a) => ({
          tag: 'button',
          text: { tag: 'plain_text', content: a.label },
          value: a.value ? JSON.parse(a.value) : { action_id: a.id },
        })),
      })
    }
    const body = JSON.stringify({
      receive_id: target,
      msg_type: 'interactive',
      content: JSON.stringify({ config: { wide_screen_mode: true }, elements }),
    })
    const data = await this.postJson<SendMessageResponse>(
      `${this.baseUrl}/im/v1/messages?receive_id_type=${this.receiveIdType}`,
      token,
      body,
    )
    if (data.code !== 0 || !data.data?.message_id) return { delivered: false }
    return { delivered: true, channelMessageId: data.data.message_id }
  }

  private async resolveTenantToken(): Promise<{ token: string; expiresIn: number }> {
    const res = await this.fetchImpl(`${this.baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    })
    const data = (await res.json()) as TenantTokenResponse
    if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`feishu token failed (${res.status}: ${data.msg ?? data.code ?? 'unknown'})`)
    }
    return { token: data.tenant_access_token, expiresIn: data.expire ?? 7200 }
  }

  private async postJson<T>(url: string, token: string, body: string): Promise<T> {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'flowforge/chat-stretch' },
      body,
    })
    return (await res.json()) as T
  }
}