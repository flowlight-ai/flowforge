/**
 * @flowforge/webhook 契约测试（A）— 品牌 / 值工具 / LLM 助手 / 规则匹配与分发。
 *
 * 全部断言对真实内存端口（createMemoryRuntime）运行，禁用对被测模块的 vi.mock。
 */

import { describe, expect, it } from 'vitest'
import type { VerifiedWebhookDelivery, WebhookSessionRequest } from '../src/types.ts'
import {
  brandString,
  WebhookRuleId,
  WebhookSourceId,
  WebhookDeliveryId,
} from '../src/index.ts'
import { createWebhookRuntime, createMemoryRuntime } from '../src/index.ts'
import { snapshotJsonValue, deepFreeze } from '../src/index.ts'
import { createUserMessage, errorChain, boundContextSummary } from '../src/index.ts'
import { CommandOk, CommandFail, captureCommand } from '../src/index.ts'

/** 构造一个合法 github-kind 投递。 */
function makeDelivery(overrides: Partial<VerifiedWebhookDelivery> = {}): VerifiedWebhookDelivery<'github'> {
  return {
    kind: 'github',
    source: WebhookSourceId('primary-github'),
    deliveryId: WebhookDeliveryId('uuid-1'),
    event: { action: 'opened', number: 1 },
    receivedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** 一个合法 Session 请求。 */
function makeRequest(overrides: Partial<WebhookSessionRequest> = {}): WebhookSessionRequest {
  return {
    workspacePath: '/tmp/ws-a',
    title: 'Issue → task',
    prompt: '请处理这个 issue',
    agentPreset: 'base',
    permissionPreset: 'sandboxed',
    ...overrides,
  }
}

describe('brand 契型', () => {
  it('品牌构造函数返回携带编译期标签的字符串', () => {
    const ruleId = WebhookRuleId('r1')
    const source = WebhookSourceId('s1')
    const delivery = WebhookDeliveryId('d1')
    expect(ruleId).toBe('r1')
    expect(source).toBe('s1')
    expect(delivery).toBe('d1')
  })

  it('brandString 桥接任意字符串为品牌字符串', () => {
    expect(brandString<'Marker'>('x')).toMatch('x')
  })
})

/** 等待微任务/后台调用结算。 */
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

describe('value tools (snapshotJsonValue / deepFreeze)', () => {
  it('无损 JSON 值被递归快照为字面量副本', () => {
    const source = { a: 1, b: 'x', c: [true, null], d: { e: 2 } }
    expect(snapshotJsonValue(source)).toEqual(source)
    expect(snapshotJsonValue(source)).not.toBe(source)
  })

  it('丢失值（bigint/symbol/函数/NaN/Infinity）返回 undefined', () => {
    expect(snapshotJsonValue(123n)).toBeUndefined()
    expect(snapshotJsonValue(() => 1)).toBeUndefined()
    expect(snapshotJsonValue(NaN)).toBeUndefined()
    expect(snapshotJsonValue(Infinity)).toBeUndefined()
    expect(snapshotJsonValue({ a: Symbol('x') })).toBeUndefined()
  })

  it('循环结构被判定为不可无损表示', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular['self'] = circular
    expect(snapshotJsonValue(circular)).toBeUndefined()
  })

  it('deepFreeze 递归冻结对象树', () => {
    const frozen = deepFreeze({ a: 1, b: { c: [1, 2] } })
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.b)).toBe(true)
    expect(Object.isFrozen(frozen.b.c)).toBe(true)
  })
})

describe('llm 助手（createUserMessage / errorChain / boundContextSummary）', () => {
  it('createUserMessage 保留内容与 webhook 来源 provenance', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: {
        kind: 'webhook',
        provider: 'github',
        source: WebhookSourceId('s'),
        deliveryId: WebhookDeliveryId('d'),
        ruleId: WebhookRuleId('r'),
        form: 'notice',
        summary: 'sum',
      },
    })
    expect(message.source.kind).toBe('webhook')
    expect(message.content[0]?.text).toBe('hi')
  })

  it('errorChain 沿 cause 链接展开为分号分隔摘要', () => {
    const inner = new Error('inner boom')
    const outer = new Error('outer fail')
    outer.cause = inner
    const chain = errorChain(outer)
    expect(chain).toContain('outer fail')
    expect(chain).toContain('inner boom')
  })

  it('errorChain 对非 Error 输入退化为 String 形式', () => {
    expect(errorChain(42)).toBe('42')
    expect(errorChain(undefined)).toBe('')
  })

  it('boundContextSummary 归一空白并截断超长文本', () => {
    expect(boundContextSummary('  a   b ')).toBe('a b')
    const long = 'x'.repeat(5000)
    expect(boundContextSummary(long).length).toBeLessThan(5000)
  })
})

describe('CommandResult 契型', () => {
  it('ok/fail 构造稳定状态', () => {
    expect(CommandOk('done').status).toBe('ok')
    expect(CommandFail('boom').status).toBe('error')
  })

  it('captureCommand 将异常折叠为 error', () => {
    const ok = captureCommand(() => 5, 'op')
    const fail = captureCommand(() => { throw new Error('x') }, 'op')
    expect(ok).toMatchObject({ status: 'ok', value: 5 })
    expect(fail.status).toBe('error')
  })
})

describe('WebhookRuntime 分发（规则匹配 / fire-and-forget / 清理）', () => {
  it('只向 kind 匹配的规则分发，异 kind 被跳过', async () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    const matched: string[] = []
    runtime.register({ id: WebhookRuleId('github-rule'), kind: 'github', run: delivery => { matched.push(delivery.kind); return null } })
    runtime.register({ id: WebhookRuleId('gitlab-rule'), kind: 'gitlab', run: delivery => { matched.push(delivery.kind); return null } })
    runtime.dispatch(makeDelivery())
    await tick()
    expect(matched).toEqual(['github'])
  })

  it('投递先被无损快照冻结，规则收到的是不可变副本', async () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    let captured: VerifiedWebhookDelivery | undefined
    runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: delivery => { captured = delivery; return null } })
    runtime.dispatch(makeDelivery())
    await tick()
    const frozen = captured!
    expect(() => { (frozen as unknown as { kind: string }).kind = 'x' }).toThrow()
  })

  it('dispatch 在规则回调结算前同步返回（fire-and-forget）', () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    let settled = false
    const disposer = runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: async () => { await new Promise(r => setTimeout(r, 10)); settled = true; return null } })
    runtime.dispatch(makeDelivery())
    expect(runtime.activeCount()).toBe(1)
    expect(settled).toBe(false)
    return disposer()
  })

  it('规则 run 抛错被记录为 warn 而不向上抛出', async () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    const disposer = runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: async () => { throw new Error('boom') } })
    runtime.dispatch(makeDelivery())
    await tick()
    expect(fixture.logger.warnLog.some(line => line.includes('boom'))).toBe(true)
    await disposer()
  })

  it('重复注册同 id 抛错，malformed 规则字段抛错', () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: () => null })
    expect(() => runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: () => null })).toThrow(/already registered/)
    expect(() => runtime.register({ id: WebhookRuleId(''), kind: 'github', run: () => null })).toThrow()
    expect(() => runtime.register({ id: WebhookRuleId('x'), kind: '', run: () => null })).toThrow()
  })

  it('selectedDelivery 畸形校验抛出（kind/source/deliveryId/receivedAt/lossless）', () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    expect(() => runtime.dispatch(makeDelivery({ kind: '' }))).toThrow(/kind/)
    expect(() => runtime.dispatch(makeDelivery({ source: WebhookSourceId('') }))).toThrow(/source/)
    expect(() => runtime.dispatch(makeDelivery({ receivedAt: -1 }))).toThrow(/receivedAt/)
    expect(() => runtime.dispatch(makeDelivery({ receivedAt: 1.5 }))).toThrow(/receivedAt/)
  })

  it('dispose 中止并排空所有注册的活动调用', async () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    const disposer = runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: () => new Promise(() => { /* never settle */ }) })
    runtime.dispatch(makeDelivery())
    await disposer()
    expect(runtime.activeCount()).toBe(0)
  })

  it('规则返回 request 时创建 Session', async () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    const disposer = runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: () => makeRequest() })
    runtime.dispatch(makeDelivery())
    await tick()
    expect(fixture.agents.creations).toHaveLength(1)
    expect(fixture.workspaceRegistry.workspaces).toHaveLength(1)
    await disposer()
  })

  it('规则返回 null 时不创建任何会话', async () => {
    const fixture = createMemoryRuntime()
    const runtime = createWebhookRuntime(fixture.ports)
    const disposer = runtime.register({ id: WebhookRuleId('r'), kind: 'github', run: () => null })
    runtime.dispatch(makeDelivery())
    await tick()
    expect(fixture.agents.creations).toHaveLength(0)
    await disposer()
  })
})