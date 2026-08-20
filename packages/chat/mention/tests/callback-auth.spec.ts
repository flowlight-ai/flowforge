/**
 * callback-auth — callback-auth 签名校验纯函数 + F174 D2b-1 notifier 契约验证
 * （阶段5 批次5，T5.3.3）。
 *
 * 覆盖 clowder-ai `callback-auth-prehandler.ts` / `callback-auth-system-message.ts`：
 * - extractCallbackCredentials：headers 优先 / legacy body-query 回退 / 混合来源 null
 * - extractLegacyCredentials：部分结果 fail-closed
 * - callbackToolFromUrl：/api/callbacks/<tool> 解析
 * - CallbackAuthSystemMessageNotifier：表面化决策（surfaceable / 心跳跳过 / 去重 /
 *   hideSimilar 24h 抑制 / 持久化失败回滚槽位）
 *
 * @module @flowforge/chat-mention/tests
 */

import { describe, expect, it } from 'vitest'
import type { CatId } from '@flowforge/cats-shared'
import {
  CallbackAuthSystemMessageNotifier,
  type CallbackAuthMessageStore,
  type CallbackAuthSocketBroadcaster,
  callbackToolFromUrl,
  extractCallbackCredentials,
  extractLegacyCredentials,
  isBackgroundHeartbeatTool,
  isSurfaceableReason,
} from '../src/index.ts'

const catA = 'cat-a' as CatId

interface Stored {
  id: string
  content: string
  timestamp: number
  extra?: unknown
}

function makeNotifier(opts?: {
  now?: () => number
  store?: CallbackAuthMessageStore
  socket?: CallbackAuthSocketBroadcaster
}): {
  notifier: CallbackAuthSystemMessageNotifier
  appended: Stored[]
  broadcast: { room: string; event: string; payload: unknown }[]
} {
  const appended: Stored[] = []
  const broadcast: { room: string; event: string; payload: unknown }[] = []
  const store: CallbackAuthMessageStore = opts?.store ?? {
    append: async (msg) => {
      const stored = { id: `m${appended.length + 1}`, content: msg.content, timestamp: msg.timestamp, extra: msg.extra }
      appended.push(stored)
      return stored
    },
  }
  const socket: CallbackAuthSocketBroadcaster = opts?.socket ?? {
    broadcastToRoom: (room, event, payload) => broadcast.push({ room, event, payload }),
  }
  const notifier = new CallbackAuthSystemMessageNotifier({
    messageStore: store,
    socketManager: socket,
    ...(opts?.now ? { now: opts.now } : {}),
  })
  return { notifier, appended, broadcast }
}

describe('extractCallbackCredentials', () => {
  it('headers 存在且完整 → 取 header 对', () => {
    const creds = extractCallbackCredentials({ 'x-invocation-id': 'inv1', 'x-callback-token': 'tok1' })
    expect(creds).toEqual({ invocationId: 'inv1', callbackToken: 'tok1' })
  })

  it('headers 皆缺 → 回退 legacy body/query', () => {
    expect(extractCallbackCredentials({}, { invocationId: 'i', callbackToken: 't' })).toEqual({
      invocationId: 'i',
      callbackToken: 't',
    })
    expect(extractCallbackCredentials({}, undefined, { invocationId: 'i', callbackToken: 't' })).toEqual({
      invocationId: 'i',
      callbackToken: 't',
    })
  })

  it('混合来源（header id + body token）→ null', () => {
    expect(extractCallbackCredentials({ 'x-invocation-id': 'i' }, { callbackToken: 't' })).toBeNull()
  })

  it('完全缺失 → null', () => {
    expect(extractCallbackCredentials({})).toBeNull()
  })
})

describe('extractLegacyCredentials', () => {
  it('返回部分结果供 fail-closed', () => {
    expect(extractLegacyCredentials({ invocationId: 'i' })).toEqual({
      invocationId: 'i',
      callbackToken: undefined,
    })
  })

  it('无任一字段 → null', () => {
    expect(extractLegacyCredentials({ foo: 1 })).toBeNull()
    expect(extractLegacyCredentials()).toBeNull()
  })
})

describe('callbackToolFromUrl', () => {
  it('解析 /api/callbacks/<tool>', () => {
    expect(callbackToolFromUrl('/api/callbacks/multi-mention')).toBe('multi-mention')
    expect(callbackToolFromUrl('/api/callbacks/post_message?x=1')).toBe('post_message')
  })

  it('不匹配返回 unknown', () => {
    expect(callbackToolFromUrl('/api/other')).toBe('unknown')
    expect(callbackToolFromUrl('')).toBe('unknown')
  })
})

describe('表面化判定', () => {
  it('expired / invalid_token 可表面化', () => {
    expect(isSurfaceableReason('expired')).toBe(true)
    expect(isSurfaceableReason('invalid_token')).toBe(true)
  })

  it('其余原因不可表面化', () => {
    expect(isSurfaceableReason('stale_invocation')).toBe(false)
    expect(isSurfaceableReason('unknown_invocation')).toBe(false)
    expect(isSurfaceableReason('missing_creds')).toBe(false)
  })

  it('心跳工具跳过表面化', () => {
    expect(isBackgroundHeartbeatTool('refresh-token')).toBe(true)
    expect(isBackgroundHeartbeatTool('post_message')).toBe(false)
  })
})

describe('notifier 决策去重', () => {
  const base = { threadId: 't1', catId: catA, userId: 'u1', tool: 'post_message' }

  it('不可表面化原因不投递', async () => {
    const { notifier, appended } = makeNotifier()
    const sent = await notifier.notify({ ...base, reason: 'missing_creds' })
    expect(sent).toBe(false)
    expect(appended).toHaveLength(0)
  })

  it('心跳工具不投递', async () => {
    const { notifier, appended } = makeNotifier()
    const sent = await notifier.notify({ ...base, tool: 'refresh-token', reason: 'expired' })
    expect(sent).toBe(false)
    expect(appended).toHaveLength(0)
  })

  it('可表面化原因投递富块 + 广播', async () => {
    const { notifier, appended, broadcast } = makeNotifier()
    const sent = await notifier.notify({ ...base, reason: 'expired' })
    expect(sent).toBe(true)
    expect(appended).toHaveLength(1)
    expect(broadcast[0]?.room).toBe('thread:t1')
    expect(broadcast[0]?.event).toBe('connector_message')
    expect(appended[0]?.content).toContain('[callback-auth] post_message → expired')
  })

  it('5 分钟窗口内同 tuple 去重', async () => {
    const nowBase = 1_000_000
    let now = nowBase
    const { notifier, appended } = makeNotifier({ now: () => now })
    await notifier.notify({ ...base, reason: 'expired' })
    await notifier.notify({ ...base, reason: 'expired' })
    now = nowBase + 1000
    await notifier.notify({ ...base, reason: 'expired' })
    expect(appended).toHaveLength(1)
  })

  it('窗口过后可再次投递', async () => {
    let now = 1_000_000
    const { notifier, appended } = makeNotifier({ now: () => now })
    await notifier.notify({ ...base, reason: 'expired' })
    now += 5 * 60 * 1000 + 1
    await notifier.notify({ ...base, reason: 'expired' })
    expect(appended).toHaveLength(2)
  })

  it('hideSimilar 24h 抑制', async () => {
    let now = 1_000_000
    const { notifier, appended } = makeNotifier({ now: () => now })
    await notifier.notify({ ...base, reason: 'expired' })
    notifier.hideSimilar({ ...base, reason: 'expired' })
    now += 60 * 1000
    await notifier.notify({ ...base, reason: 'expired' })
    expect(appended).toHaveLength(1)
  })

  it('持久化失败回滚 dedup 槽位', async () => {
    let now = 1_000_000
    const failingStore: CallbackAuthMessageStore = {
      append: async () => {
        throw new Error('store down')
      },
    }
    const { notifier } = makeNotifier({ now: () => now, store: failingStore })
    await expect(notifier.notify({ ...base, reason: 'expired' })).rejects.toThrow('store down')
    // 槽位已回滚 → 尺寸为 0
    expect(notifier.__getDedupSizeForTest()).toBe(0)
  })

  it('pruneExpired 驱逐过期条目', async () => {
    let now = 1_000_000
    const { notifier } = makeNotifier({ now: () => now })
    await notifier.notify({ ...base, reason: 'expired' })
    expect(notifier.__getDedupSizeForTest()).toBe(1)
    now += 5 * 60 * 1000 + 1
    // 再次 notify 触发 prune
    await notifier.notify({ ...base, reason: 'expired' })
    expect(notifier.__getDedupSizeForTest()).toBe(1)
  })
})