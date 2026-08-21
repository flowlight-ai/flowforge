/**
 * ChatStretchService IM 通道面 + ports 契约验证（阶段5 批次8，T5.10）。
 *
 * 覆盖（对齐 clowder-ai callback-lark-action-routes / callback-wecom-action-routes /
 * connector-webhooks 通道语义的 ports 抽象）：
 * - InMemoryImChannelAdapter：send 记录 + 结果 / handleInbound 可编程结论 /
 *   health 故障注入
 * - ImChannelRegistry：register/get/list/listKinds
 * - ChatStretchService 缺省装配：5 通道自动注册 mock + sendIm/handleImEvent/
 *   imHealth 委托 + 未注册通道降级（delivered:false / 'error' / ok:false）
 *
 * @module @flowforge/chat-stretch/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import {
  ChatStretchService,
  IM_CHANNEL_KINDS,
  ImChannelRegistry,
  InMemoryImChannelAdapter,
} from '../src/index.ts'
import type { ChatStretchServiceOptions } from '../src/index.ts'

interface Harness {
  ctx: Context
  stretch: ChatStretchService
}

function harness(overrides: ChatStretchServiceOptions = {}): Harness {
  const ctx = new Context()
  const stretch = new ChatStretchService(ctx, overrides)
  return { ctx, stretch }
}

describe('InMemoryImChannelAdapter', () => {
  it('send 记录出站消息并返回通道消息 id', async () => {
    const adapter = new InMemoryImChannelAdapter('lark')
    const result = await adapter.send({ target: 'open_id:u1', text: 'hello' })
    expect(result.delivered).toBe(true)
    expect(result.channelMessageId).toBe('lark:1')
    expect(adapter.sent).toHaveLength(1)
    expect(adapter.sent[0]).toMatchObject({ target: 'open_id:u1', text: 'hello' })
  })

  it('handleInbound 返回可编程结论（缺省 handled）', async () => {
    const adapter = new InMemoryImChannelAdapter('wecom')
    await expect(
      adapter.handleInbound({ kind: 'wecom', raw: { msg: 1 } }),
    ).resolves.toBe('handled')

    const rejecting = new InMemoryImChannelAdapter('wecom', { inboundOutcome: 'ignored' })
    await expect(
      rejecting.handleInbound({ kind: 'wecom', raw: {} }),
    ).resolves.toBe('ignored')
  })

  it('health 支持故障注入', async () => {
    const ok = new InMemoryImChannelAdapter('telegram')
    await expect(ok.health()).resolves.toMatchObject({ ok: true, latencyMs: 0 })

    const down = new InMemoryImChannelAdapter('telegram', { unhealthy: true })
    await expect(down.health()).resolves.toMatchObject({ ok: false })
  })
})

describe('ImChannelRegistry', () => {
  it('register/get/list/listKinds 契约', () => {
    const lark = new InMemoryImChannelAdapter('lark')
    const web = new InMemoryImChannelAdapter('webchat')
    const registry = new ImChannelRegistry()
    registry.register(lark)
    registry.register(web)
    expect(registry.get('lark')).toBe(lark)
    expect(registry.get('telegram')).toBeUndefined()
    expect(registry.list()).toHaveLength(2)
    expect(registry.listKinds()).toEqual(['lark', 'webchat'])
  })
})

describe('ChatStretchService IM 面（T5.10）', () => {
  it('缺省装配自动注册全部 5 种通道 mock', () => {
    const { stretch } = harness()
    expect(stretch.imChannels.listKinds()).toEqual([...IM_CHANNEL_KINDS])
  })

  it('sendIm 委托到对应通道适配器', async () => {
    const lark = new InMemoryImChannelAdapter('lark')
    const { stretch } = harness({ imAdapters: [lark] })
    const result = await stretch.sendIm('lark', { target: 'chat:1', text: 'hi' })
    expect(result.delivered).toBe(true)
    expect(lark.sent).toHaveLength(1)
  })

  it('未注册通道 sendIm 降级 delivered:false', async () => {
    const { stretch } = harness({ imAdapters: [], autoRegisterMocks: false })
    const result = await stretch.sendIm('lark', { target: 'chat:1', text: 'hi' })
    expect(result).toEqual({ delivered: false })
  })

  it('handleImEvent 委托 + 未注册通道降级 error', async () => {
    const wecom = new InMemoryImChannelAdapter('wecom', { inboundOutcome: 'ignored' })
    const { stretch } = harness({ imAdapters: [wecom] })
    await expect(
      stretch.handleImEvent({ kind: 'wecom', raw: {} }),
    ).resolves.toBe('ignored')

    const { stretch: bare } = harness({ imAdapters: [], autoRegisterMocks: false })
    await expect(
      bare.handleImEvent({ kind: 'telegram', raw: {} }),
    ).resolves.toBe('error')
  })

  it('imHealth 委托 + 未注册通道 ok:false', async () => {
    const { stretch } = harness()
    await expect(stretch.imHealth('dingtalk')).resolves.toMatchObject({ ok: true })
    const { stretch: bare } = harness({ imAdapters: [], autoRegisterMocks: false })
    await expect(bare.imHealth('lark')).resolves.toMatchObject({ ok: false })
  })
})
