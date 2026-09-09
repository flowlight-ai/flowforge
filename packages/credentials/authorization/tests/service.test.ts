/**
 * @flowforge/credentials-authorization 契约测试（核心）：registerFlow / list /
 * describe / begin 三级错误 / 中止提前返回 / decline / withdraw / authorized /
 * NOT_COMMITTED / settle 事件 fan-out / cancel。
 *
 * 全部断言对真实内存端口（createAuthorizationRuntime）运行，禁用对被测模块的
 * vi.mock。
 */

import { describe, expect, it } from 'vitest'
import {
  createAuthorizationRuntime,
  AuthorizationDeclinedError,
  credentialKey,
} from '../src/index.ts'
import type { AuthorizationFlow } from '../src/index.ts'
import { makeInteraction, key, noticeLog } from './helpers.ts'

/** 等待微任务/后台调用结算。 */
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

function pendingRun(_commitOn: () => void): { gate: Promise<void>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = () => resolve() })
  return { gate, release }
}

/** 组装一个“run 内 commit”的 flow。 */
function committingFlow(k: import('../src/index.ts').CredentialKey, rt: ReturnType<typeof createAuthorizationRuntime>): AuthorizationFlow {
  return {
    key: k,
    label: 'Commit flow',
    methods: [{ id: 'oauth', label: 'Sign in' }],
    run: async () => { rt.credentials.commit(k) },
  }
}

describe('CredentialKey 契型', () => {
  it('credentialKey 拼接 scope/name，同输入相等', () => {
    expect(credentialKey('p', 'c')).toBe('p/c')
    expect(credentialKey('p', 'c')).toBe(credentialKey('p', 'c'))
  })

  it('不同 scope 或 name 的 key 不等', () => {
    expect(credentialKey('p1', 'c')).not.toBe(credentialKey('p2', 'c'))
    expect(credentialKey('p', 'c1')).not.toBe(credentialKey('p', 'c2'))
  })
})

describe('registerFlow', () => {
  it('注册成功后 list 能返回该 flow 的 entry', () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    const entries = rt.service.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ key: k, label: 'Commit flow', inFlight: false })
    expect(entries[0]!.methods[0]!.id).toBe('oauth')
  })

  it('重复注册同名 key 抛 DUPLICATE_FLOW', () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    expect(() => rt.service.registerFlow(committingFlow(k, rt)))
      .toThrowError(/already registered/)
  })

  it('DUPLICATE_FLOW 错误携带稳定 code', () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    try {
      rt.service.registerFlow(committingFlow(k, rt))
      expect.unreachable()
    } catch (error) {
      expect((error as { code?: string }).code).toBe('DUPLICATE_FLOW')
    }
  })

  it('返回的 disposer 撤回该 flow，list 不再包含它', () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const release = rt.service.registerFlow(committingFlow(k, rt))
    expect(rt.service.list()).toHaveLength(1)
    release()
    expect(rt.service.list()).toHaveLength(0)
    expect(rt.service.describe(k)).toBeUndefined()
  })

  it('宿主上下文销毁促发全部已注册 flow 的清理器', () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    expect(rt.service.list()).toHaveLength(1)
    rt.disposeContext()
    expect(rt.service.list()).toHaveLength(0)
  })
})

describe('describe / list', () => {
  it('describe 已知 key 返回 entry，inFlight 初始为 false', () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    const entry = rt.service.describe(k)
    expect(entry).toBeDefined()
    expect(entry?.inFlight).toBe(false)
  })

  it('describe 未知 key 返回 undefined', () => {
    const rt = createAuthorizationRuntime()
    expect(rt.service.describe(key('nope', 'x'))).toBeUndefined()
  })

  it('list 按注册顺序返回', () => {
    const rt = createAuthorizationRuntime()
    const k1 = key('p', 'a')
    const k2 = key('p', 'b')
    rt.service.registerFlow(committingFlow(k1, rt))
    rt.service.registerFlow(committingFlow(k2, rt))
    expect(rt.service.list().map(e => e.key)).toEqual([k1, k2])
  })
})

describe('begin 前置校验', () => {
  it('未注册 key -> NO_FLOW', async () => {
    const rt = createAuthorizationRuntime()
    await expect(rt.service.begin({ key: key('nope', 'x'), interaction: makeInteraction() }))
      .rejects.toThrowError(/no authorization flow/i)
  })

  it('NO_FLOW 错误携带稳定 code', async () => {
    const rt = createAuthorizationRuntime()
    try {
      await rt.service.begin({ key: key('nope', 'x'), interaction: makeInteraction() })
      expect.unreachable()
    } catch (error) {
      expect((error as { code?: string }).code).toBe('NO_FLOW')
    }
  })

  it('高明的未知 method -> UNKNOWN_METHOD', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    await expect(rt.service.begin({ key: k, method: 'bogus', interaction: makeInteraction() }))
      .rejects.toThrowError(/offers no method "bogus"/)
  })

  it('已中止信号且未知 method：校验仍先跑并报 UNKNOWN_METHOD', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    const controller = new AbortController()
    controller.abort()
    await expect(rt.service.begin({ key: k, method: 'bogus', interaction: makeInteraction(), signal: controller.signal }))
      .rejects.toThrowError(/offers no method "bogus"/)
  })

  it('第二并发调用 -> ALREADY_IN_FLIGHT', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const { gate, release } = pendingRun(() => rt.credentials.commit(k))
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async () => { await gate; rt.credentials.commit(k) },
    })
    const first = rt.service.begin({ key: k, interaction: makeInteraction() })
    await tick()
    await expect(rt.service.begin({ key: k, interaction: makeInteraction() }))
      .rejects.toThrowError(/already running/)
    release()
    await first
  })

  it('begin 前 signal 已中止 -> 直接返回 cancelled 且不跑 flow', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    let ran = false
    rt.service.registerFlow({ ...committingFlow(k, rt), run: async () => { ran = true; rt.credentials.commit(k) } })
    const controller = new AbortController()
    controller.abort()
    const outcome = await rt.service.begin({ key: k, interaction: makeInteraction(), signal: controller.signal })
    expect(outcome.status).toBe('cancelled')
    expect(ran).toBe(false)
    expect(rt.service.describe(k)?.inFlight).toBe(false)
  })
})

describe('尝试结果：authorized / NOT_COMMITTED', () => {
  it('run 内提交记录并被观察 -> authorized', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow(committingFlow(k, rt))
    const outcome = await rt.service.begin({ key: k, interaction: makeInteraction() })
    expect(outcome.status).toBe('authorized')
    expect(rt.credentials.countConfigured()).toBe(1)
  })

  it('run 未提交记录即决议 -> NOT_COMMITTED', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow({ ...committingFlow(k, rt), run: async () => { /* 不提交 */ } })
    await expect(rt.service.begin({ key: k, interaction: makeInteraction() }))
      .rejects.toThrowError(/without committing/)
  })

  it('run 提交后又删除记录 -> NOT_COMMITTED（复查 describeRecord）', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async () => { rt.credentials.commit(k); rt.credentials.remove(k) },
    })
    await expect(rt.service.begin({ key: k, interaction: makeInteraction() }))
      .rejects.toThrowError(/deleted its credential record/)
  })

  it('method 缺省时取 flow 第一个方法，session.method 反映它', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const sessions: import('../src/index.ts').AuthorizationSession[] = []
    rt.service.registerFlow({
      key: k,
      label: 'L',
      methods: [{ id: 'fast', label: 'Fast' }, { id: 'slow', label: 'Slow' }],
      run: async session => { sessions.push(session); rt.credentials.commit(k) },
    })
    const outcome = await rt.service.begin({ key: k, interaction: makeInteraction() })
    expect(outcome.status).toBe('authorized')
    expect(sessions[0]?.method).toBe('fast')
  })

  it('指定 method 被选中到 session', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const sessions: import('../src/index.ts').AuthorizationSession[] = []
    rt.service.registerFlow({
      key: k,
      label: 'L',
      methods: [{ id: 'fast', label: 'Fast' }, { id: 'slow', label: 'Slow' }],
      run: async session => { sessions.push(session); rt.credentials.commit(k) },
    })
    await rt.service.begin({ key: k, method: 'slow', interaction: makeInteraction() })
    expect(sessions[0]?.method).toBe('slow')
  })
})

describe('尝试结果：decline / withdraw / 普通失败', () => {
  it('run 内 prompt 被人类拒绝（DECLINED）-> cancelled', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async session => { await session.prompt({ kind: 'text', message: 'Continue?' }) },
    })
    const outcome = await rt.service.begin({
      key: k,
      interaction: makeInteraction({
        prompt: async () => { throw new AuthorizationDeclinedError() },
      }),
    })
    expect(outcome.status).toBe('cancelled')
  })

  it('非 DECLINED 的 prompt 拒绝作为普通失败抛给调用者', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async session => { await session.prompt({ kind: 'text', message: 'Continue?' }) },
    })
    await expect(rt.service.begin({
      key: k,
      interaction: makeInteraction({ prompt: async () => { throw new Error('surface broke') } }),
    })).rejects.toThrowError(/surface broke/)
  })

  it('flow 普通抛错 -> 原样抛给调用者', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow({ ...committingFlow(k, rt), run: async () => { throw new Error('flow boom') } })
    await expect(rt.service.begin({ key: k, interaction: makeInteraction() }))
      .rejects.toThrowError(/flow boom/)
  })

  it('尝试中撤回（request signal abort）-> cancelled，key 被释放', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const controller = new AbortController()
    const { gate, release } = pendingRun(() => rt.credentials.commit(k))
    const sessions: import('../src/index.ts').AuthorizationSession[] = []
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async session => { sessions.push(session); await gate },
    })
    const outcomePromise = rt.service.begin({ key: k, interaction: makeInteraction(), signal: controller.signal })
    await tick()
    controller.abort()
    const outcome = await outcomePromise
    expect(outcome.status).toBe('cancelled')
    expect(rt.service.describe(k)?.inFlight).toBe(false)
    release()
  })

  it('撤回后未响应 signal 的孤儿 run 被标记已处理，不击垮进程', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const controller = new AbortController()
    const never = new Promise<void>(() => { /* 永不决议 */ })
    rt.service.registerFlow({ ...committingFlow(k, rt), run: () => never })
    const outcomePromise = rt.service.begin({ key: k, interaction: makeInteraction(), signal: controller.signal })
    await tick(10)
    controller.abort()
    await expect(outcomePromise).resolves.toEqual({ status: 'cancelled' })
    await tick(10)
    expect(rt.service.describe(k)?.inFlight).toBe(false)
  })
})

describe('cancel', () => {
  it('cancel 中止在跑尝试 -> cancelled', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const { gate, release } = pendingRun(() => rt.credentials.commit(k))
    rt.service.registerFlow({ ...committingFlow(k, rt), run: () => gate })
    const outcomePromise = rt.service.begin({ key: k, interaction: makeInteraction() })
    await tick()
    rt.service.cancel(k)
    const outcome = await outcomePromise
    expect(outcome.status).toBe('cancelled')
    release()
  })

  it('cancel 无在跑尝试为 no-op', () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    expect(() => rt.service.cancel(k)).not.toThrow()
  })

  it('begin 后 inFlight=true，结束后 describe 回到 false', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const { gate, release } = pendingRun(() => rt.credentials.commit(k))
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async () => { await gate; rt.credentials.commit(k) },
    })
    const outcomePromise = rt.service.begin({ key: k, interaction: makeInteraction() })
    await tick()
    expect(rt.service.describe(k)?.inFlight).toBe(true)
    release()
    await outcomePromise
    expect(rt.service.describe(k)?.inFlight).toBe(false)
  })
})

describe('settle 事件 fan-out', () => {
  it('authorized 尝试向所有 settled 监听者发 authorized', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const log = settledLogFor(() => rt)
    rt.host.onSettled(log.listener)
    rt.service.registerFlow(committingFlow(k, rt))
    const outcome = await rt.service.begin({ key: k, interaction: makeInteraction() })
    expect(outcome.status).toBe('authorized')
    expect(log.events).toHaveLength(1)
    expect(log.events[0]).toMatchObject({ key: k, settlement: 'authorized' })
  })

  it('失败尝试向 settled 监听者发 failed', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const log = settledLogFor(() => rt)
    rt.host.onSettled(log.listener)
    rt.service.registerFlow({ ...committingFlow(k, rt), run: async () => { throw new Error('boom') } })
    await rt.service.begin({ key: k, interaction: makeInteraction() }).catch(() => undefined)
    expect(log.events[0]?.settlement).toBe('failed')
  })

  it('普通 listener 同步抛错被记录（warn），不改变调用方结果', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.host.onSettled(() => { throw new Error('watcher broke') })
    rt.service.registerFlow(committingFlow(k, rt))
    await expect(rt.service.begin({ key: k, interaction: makeInteraction() })).resolves.toEqual({ status: 'authorized' })
    expect(rt.host.logger.warnLog.length).toBeGreaterThan(0)
  })

  it('普通 listener 异步拒绝被记录，不改变调用方结果', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.host.onSettled(async () => { throw new Error('async watcher broke') })
    rt.service.registerFlow(committingFlow(k, rt))
    await expect(rt.service.begin({ key: k, interaction: makeInteraction() })).resolves.toEqual({ status: 'authorized' })
    await tick()
    expect(rt.host.logger.warnLog.length).toBeGreaterThan(0)
  })

  it('INVARIANT listener 抛错在所有 listener 跑完后由 begin 再抛', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const order: string[] = []
    rt.host.onSettled(() => { order.push('a'); return undefined })
    const invariant = Object.assign(new Error('invariant veto'), { code: 'INVARIANT' })
    rt.host.onSettled(() => { order.push('b'); throw invariant })
    rt.host.onSettled(() => { order.push('c'); return undefined })
    rt.service.registerFlow(committingFlow(k, rt))
    await expect(rt.service.begin({ key: k, interaction: makeInteraction() })).rejects.toBe(invariant)
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('settle 在 key 释放后 fan-out：监听者立即重启 begin 不被拒', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    let nested: Promise<import('../src/index.ts').AuthorizationOutcome> | undefined
    let reacted = false
    rt.host.onSettled(() => {
      // 只反应第一次 settle：一个正在重启下次尝试的监听者，它的新尝试结束时会
      // 再次触发本监听者，若不加护栏会无限级联。
      if (reacted) return
      reacted = true
      nested = rt.service.begin({ key: k, interaction: makeInteraction() })
    })
    rt.service.registerFlow(committingFlow(k, rt))
    const first = await rt.service.begin({ key: k, interaction: makeInteraction() })
    expect(first.status).toBe('authorized')
    const second = await nested
    expect(second.status).toBe('authorized')
  })
})

// —— 小工具：把 settled 事件收集进一个可断言的数组 ——
function settledLogFor(_getRt: () => ReturnType<typeof createAuthorizationRuntime>) {
  const events: { readonly key: string; readonly settlement: string }[] = []
  return {
    events,
    listener: (k: import('../src/index.ts').CredentialKey, s: string) => {
      events.push({ key: k, settlement: s })
    },
  }
}

describe('notify 转发与防火', () => {
  it('flow 的 notify 被转发到 interaction', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    const log = noticeLog()
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async session => { session.notify({ message: 'open your browser' }); rt.credentials.commit(k) },
    })
    await rt.service.begin({ key: k, interaction: makeInteraction({ notify: log.notify }) })
    expect(log.messages).toContain('open your browser')
  })

  it('interaction.notify 抛错被记录，不拖住 flow，也不影响结果', async () => {
    const rt = createAuthorizationRuntime()
    const k = key('p', 'c')
    rt.service.registerFlow({
      ...committingFlow(k, rt),
      run: async session => { session.notify({ message: 'x' }); rt.credentials.commit(k) },
    })
    const outcome = await rt.service.begin({
      key: k,
      interaction: makeInteraction({ notify: () => { throw new Error('surface gone') } }),
    })
    expect(outcome.status).toBe('authorized')
    expect(rt.host.logger.warnLog.length).toBeGreaterThan(0)
  })
})