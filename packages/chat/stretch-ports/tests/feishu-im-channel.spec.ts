/**
 * S1 飞书通道 stretch：配置探测 + 真实 adapter + connector 桥 + 装配接线。
 *
 * 覆盖（docs/refactor/35-stage-stretch-batch.md §4-2 决策）：
 * - feishu-config：resolveFeishuChannelConfig / isFeishuConfigured / feishuConfigGap
 * - FeishuImChannelAdapter 配置齐备走真实 OpenAPI（注入 fake fetch）：
 *   token → send text/card；token 失败 → delivered:false；健康探测 ok
 * - 未配置降级：send 仅本地记录返回 delivered:false、handleInbound 'ignored'、
 *   health ok:false + 缺键诊断、入站 url_verification/action 归一化 handled
 * - 出站桥：sendReply 成功 / 投递失败抛错
 * - ChatStretchService 装配：options.feishu 覆盖缺省 lark mock（feishuChannel 可探测）
 *
 * @module @flowforge/chat-stretch/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import {
  ChatStretchService,
  FeishuConnectorOutboundAdapter,
  FeishuImChannelAdapter,
  createFeishuConnectorOutboundAdapter,
  feishuConfigGap,
  isFeishuConfigured,
  resolveFeishuChannelConfig,
} from '../src/index.ts'
import type { FeishuChannelConfig } from '../src/index.ts'

const BASE = 'https://open.feishu.cn/open-apis'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 按 URL 路由的 fake fetch（token → send）。 */
function feishuFetchOk() {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : ''
    if (url.includes('/auth/v3/tenant_access_token/')) {
      return jsonResponse({ code: 0, tenant_access_token: 'tok', expire: 7200 })
    }
    if (url.includes('/im/v1/messages')) {
      return jsonResponse({ code: 0, data: { message_id: 'm1' } })
    }
    return jsonResponse({ code: 0 })
  })
}

const configured: FeishuChannelConfig = {
  appId: 'app',
  appSecret: 'sec',
  chatId: 'chat',
  baseUrl: BASE,
  receiveIdType: 'chat_id',
}

describe('feishu-config 配置探测', () => {
  it('resolveFeishuChannelConfig 从 env 探测三键 + 默认基址/类型', () => {
    const cfg = resolveFeishuChannelConfig({
      FEISHU_APP_ID: 'app',
      FEISHU_APP_SECRET: 'sec',
      FEISHU_CHAT_ID: 'chat',
    })
    expect(cfg).toMatchObject({
      appId: 'app',
      appSecret: 'sec',
      chatId: 'chat',
      baseUrl: BASE,
      receiveIdType: 'chat_id',
    })
  })

  it('isFeishuConfigured 三键齐备为真，缺任一为假', () => {
    expect(isFeishuConfigured(configured)).toBe(true)
    expect(isFeishuConfigured({ appId: 'app' })).toBe(false)
    expect(isFeishuConfigured({})).toBe(false)
  })

  it('feishuConfigGap 列出缺失键', () => {
    expect(feishuConfigGap({})).toContain('FEISHU_APP_ID')
    expect(feishuConfigGap({ appId: 'a', appSecret: 's' })).toContain('FEISHU_CHAT_ID')
    expect(feishuConfigGap(configured)).toBe('')
  })
})

describe('FeishuImChannelAdapter — 未配置降级（S1 决策）', () => {
  const adapter = new FeishuImChannelAdapter({ config: {} })

  it('configured=false，kind=lark', () => {
    expect(adapter.configured).toBe(false)
    expect(adapter.kind).toBe('lark')
  })

  it('send 仅本地记录返回 delivered:false（不伪造飞书投递）', async () => {
    const result = await adapter.send({ target: 'chat', text: 'hello' })
    expect(result).toEqual({ delivered: false })
    expect(adapter.sent).toHaveLength(1)
    expect(adapter.sent[0]).toMatchObject({ target: 'chat', text: 'hello' })
  })

  it('handleInbound 未配置返回 ignored', async () => {
    await expect(adapter.handleInbound({ kind: 'lark', raw: { type: 'url_verification' } })).resolves.toBe('ignored')
  })

  it('health 未配置返回 ok:false + 缺键诊断', async () => {
    const h = await adapter.health()
    expect(h.ok).toBe(false)
    expect(h.detail).toContain('FEISHU_APP_ID')
  })
})

describe('FeishuImChannelAdapter — 配置齐备走真实 OpenAPI', () => {
  it('send text：token → 消息发送 → channelMessageId', async () => {
    const fetchImpl = feishuFetchOk()
    const adapter = new FeishuImChannelAdapter({ config: configured, fetchImpl })
    const result = await adapter.send({ target: 'chat', text: 'hello' })
    expect(result).toEqual({ delivered: true, channelMessageId: 'm1' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/auth/v3/tenant_access_token/')
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('/im/v1/messages?receive_id_type=chat_id')
  })

  it('send card：interactive 消息透传 action', async () => {
    const fetchImpl = feishuFetchOk()
    const adapter = new FeishuImChannelAdapter({ config: configured, fetchImpl })
    const result = await adapter.send({
      target: 'chat',
      text: '',
      card: { title: 'T', body: 'B', actions: [{ id: 'a1', label: '批准', value: '{"action_id":"a1"}' }] },
    })
    expect(result).toEqual({ delivered: true, channelMessageId: 'm1' })
  })

  it('token 失败 → delivered:false（不抛）', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : ''
      if (url.includes('/auth/v3/tenant_access_token/')) {
        return jsonResponse({ code: 10003, msg: 'secret invalid' })
      }
      return jsonResponse({ code: 0 })
    })
    const adapter = new FeishuImChannelAdapter({ config: configured, fetchImpl })
    await expect(adapter.send({ target: 'chat', text: 'x' })).resolves.toEqual({ delivered: false })
  })

  it('health 配置齐备：token 探测 ok', async () => {
    const fetchImpl = feishuFetchOk()
    const adapter = new FeishuImChannelAdapter({ config: configured, fetchImpl })
    await expect(adapter.health()).resolves.toMatchObject({ ok: true })
  })

  it('handleInbound 归一化：url_verification / action handled，未知 ignored', async () => {
    const adapter = new FeishuImChannelAdapter({ config: configured, fetchImpl: feishuFetchOk() })
    await expect(adapter.handleInbound({ kind: 'lark', raw: { type: 'url_verification' } })).resolves.toBe('handled')
    await expect(
      adapter.handleInbound({ kind: 'lark', raw: { event: { action: { value: { action_id: 'a1' } } } } }),
    ).resolves.toBe('handled')
    await expect(adapter.handleInbound({ kind: 'lark', raw: { event: { message: { content: 'hi' } } } })).resolves.toBe('handled')
    await expect(adapter.handleInbound({ kind: 'lark', raw: { event: { something: 'else' } } })).resolves.toBe('ignored')
  })
})

describe('FeishuConnectorOutboundAdapter 出站桥', () => {
  it('connectorId=feishu；sendReply 委托 channel.send() 成功', async () => {
    const fetchImpl = feishuFetchOk()
    const channel = new FeishuImChannelAdapter({ config: configured, fetchImpl })
    const bridge: FeishuConnectorOutboundAdapter = createFeishuConnectorOutboundAdapter(channel)
    expect(bridge.connectorId).toBe('feishu')
    await expect(bridge.sendReply('chat', 'hello')).resolves.toBeUndefined()
    expect(channel.sent).toHaveLength(1)
  })

  it('投递失败（未配置降级 delivered:false）→ sendReply 抛错', async () => {
    const channel = new FeishuImChannelAdapter({ config: {} })
    const bridge = createFeishuConnectorOutboundAdapter(channel)
    await expect(bridge.sendReply('chat', 'x')).rejects.toThrow('delivered:false')
  })
})

describe('ChatStretchService 装配接线（S1）', () => {
  it('提供 options.feishu 时覆盖缺省 lark mock（feishuChannel 可探测）', () => {
    const ctx = new Context()
    const stretch = new ChatStretchService(ctx, { feishu: configured })
    const channel = stretch.feishuChannel
    expect(channel).toBeInstanceOf(FeishuImChannelAdapter)
    expect(stretch.imChannels.get('lark')).toBe(channel)
    // 其余四通道仍为 mock（不破坏既有装配）
    expect(stretch.imChannels.listKinds()).toContain('wecom')
  })

  it('缺省不启用飞书：feishuChannel undefined，lark 为 mock', () => {
    const ctx = new Context()
    const stretch = new ChatStretchService(ctx)
    expect(stretch.feishuChannel).toBeUndefined()
    expect(stretch.imChannels.get('lark')).toBeInstanceOf(Object)
  })

  it('配置齐备时 sendIm 走真实通道（注入 fake fetch）', async () => {
    const fetchImpl = feishuFetchOk()
    const ctx = new Context()
    const stretch = new ChatStretchService(ctx, { feishu: configured, fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await stretch.sendIm('lark', { target: 'chat', text: 'hello' })
    expect(result).toEqual({ delivered: true, channelMessageId: 'm1' })
    await expect(stretch.imHealth('lark')).resolves.toMatchObject({ ok: true })
  })
})