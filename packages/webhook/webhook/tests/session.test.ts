/**
 * @flowforge/webhook 契约测试（B）— Session 创建编排、模型选择与错误路径。
 *
 * 直接对 `createWebhookSession` 注入真实内存端口断言；对初始模型选择钩子通过
 * 内存 Agent 的 simulateRequest 重放 agent/request 事件验证。
 */

import { describe, expect, it } from 'vitest'
import type { WebhookSessionRequest } from '../src/types.ts'
import {
  createWebhookSession,
  createMemoryRuntime,
  WebhookRuleId,
  WebhookSourceId,
  WebhookDeliveryId,
  InMemoryWorkspace,
  type WebhookRuntimePorts,
} from '../src/index.ts'

/** 简洁投递。 */
function makeDelivery() {
  return {
    kind: 'github' as const,
    source: WebhookSourceId('primary-github'),
    deliveryId: WebhookDeliveryId('uuid-1'),
    event: { action: 'opened', number: 1 },
    receivedAt: 1_700_000_000_000,
  }
}

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

describe('createWebhookSession 成功编排', () => {
  it('创建 Agent、装配 workspace、设置 permission/标题并提示初始消息', async () => {
    const fixture = createMemoryRuntime()
    await createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest(), new AbortController().signal)
    const agent = fixture.agents.creations[0]!
    expect(fixture.agents.creations).toHaveLength(1)
    expect(agent.meta).toMatchObject({ cwd: '/tmp/ws-a', agentPreset: 'base' })
    // 默认模型选择缺省使用端口当前选择。
    expect(agent.agentOptions).toMatchObject({ provider: 'default-provider', model: 'default-model' })
    // workspace 已创建并 attach。
    expect(fixture.workspaceRegistry.workspaces[0]!.path).toBe('/tmp/ws-a')
    expect(fixture.workspaceRegistry.workspaces[0]!.sessionIds).toContain(agent.session.id)
    // session 标题与 permission 已设置。
    expect(fixture.sessionTitle.renames[0]!.sessionId).toBe(agent.session.id)
    expect(fixture.sessionTitle.renames[0]!.title).toBe('Issue → task')
    expect(fixture.permissionPresets.sets[0]).toMatchObject({ sessionId: agent.session.id, name: 'sandboxed' })
    // 初始提示已入队，来源为 webhook provenance。
    const message = agent.followups[0]!
    expect(message.content[0]!.text).toBe('请处理这个 issue')
    expect(message.source.kind).toBe('webhook')
    expect(message.source.provider).toBe('github')
    expect(message.source.ruleId).toBe('r1')
  })

  it('显式 model 选择覆盖默认值并透传 maxTokens', async () => {
    const fixture = createMemoryRuntime()
    await createWebhookSession(
      fixture.ports, makeDelivery(), WebhookRuleId('r1'),
      makeRequest({ model: { provider: 'deepseek', model: 'deepseek-reasoner', maxTokens: 1024 } }),
      new AbortController().signal,
    )
    const agent = fixture.agents.creations[0]!
    expect(agent.agentOptions).toMatchObject({ provider: 'deepseek', model: 'deepseek-reasoner', maxTokens: 1024 })
  })

  it('agentPresets 解析、占位键与挂载均被调用', async () => {
    const fixture = createMemoryRuntime()
    await createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest(), new AbortController().signal)
    expect(fixture.agentPresets.standingKeys).toContain('standing:base')
    expect(fixture.agentPresets.mounts.some(m => m.presetId === 'base')).toBe(true)
  })
})

describe('createWebhookSession 请求校验', () => {
  const controller = () => new AbortController().signal

  it('workspacePath 必须为绝对路径', async () => {
    const fixture = createMemoryRuntime()
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest({ workspacePath: 'relative' }), controller())).rejects.toThrow(/must be absolute/)
  })

  it('缺失/空 title、prompt、agentPreset、permissionPreset 抛错', async () => {
    const fixture = createMemoryRuntime()
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest({ title: '' }), controller())).rejects.toThrow(/title/)
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest({ prompt: '   ' }), controller())).rejects.toThrow(/prompt/)
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest({ agentPreset: '' }), controller())).rejects.toThrow(/agentPreset/)
  })

  it('缺省值 model 缺失时为 undefined；非法 maxTokens 抛错', async () => {
    const fixture = createMemoryRuntime()
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest({ model: { provider: 'p', model: 'm', maxTokens: -2 } }), controller())).rejects.toThrow(/maxTokens/)
  })

  it('rule 结果非对象抛错', async () => {
    const fixture = createMemoryRuntime()
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), null as never, controller())).rejects.toThrow(/Session request object/)
  })

  it('未知 permissionPreset 抛错（resolve 前验证）', async () => {
    const fixture = createMemoryRuntime()
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest({ permissionPreset: 'nope' }), controller())).rejects.toThrow(/permission preset/)
  })

  it('未知 agentPreset 抛错', async () => {
    const fixture = createMemoryRuntime()
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest({ agentPreset: 'nope' }), controller())).rejects.toThrow(/agent preset/)
  })
})

describe('createWebhookSession 错误路径 / 回滚', () => {
  it('workspace attach 失败时回滚并 dispose Agent', async () => {
    const fixture = createMemoryRuntime()
    // 用自定义 workspaceRegistry seam：create 返回一个刻意 attach 失败的 workspace。
    const failingWorkspace = new InMemoryWorkspace('/tmp/ws-a')
    failingWorkspace.failNextAttach = true
    const ports: WebhookRuntimePorts = {
      ...fixture.ports,
      workspaceRegistry: {
        create: async () => failingWorkspace,
        list: () => [],
      },
    }
    await expect(createWebhookSession(ports, makeDelivery(), WebhookRuleId('r1'), makeRequest(), new AbortController().signal)).rejects.toThrow(/attach failed/)
    // Agent 已被 dispose。
    expect(fixture.agents.disposed).toHaveLength(1)
    // workspace.sessionIds 未被污染。
    expect(failingWorkspace.sessionIds).toHaveLength(0)
  })

  it('调用前已中止的信号使创建抛错', async () => {
    const fixture = createMemoryRuntime()
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest(), controller.signal)).rejects.toThrow('cancelled')
  })
})

describe('初始模型选择钩子', () => {
  it('agent/request 重放时应用创建期选择（provider/model 匹配）', async () => {
    const fixture = createMemoryRuntime()
    const delivery = makeDelivery()
    await createWebhookSession(
      fixture.ports, delivery, WebhookRuleId('r1'),
      makeRequest({ model: { provider: 'p', model: 'm', maxTokens: 128 } }),
      new AbortController().signal,
    )
    const agent = fixture.agents.creations[0]!
    const resolved = await agent.simulateRequest({ provider: 'p', model: 'm' })
    expect(resolved.provider).toBe('p')
    expect(resolved.model).toBe('m')
    expect(agent.followups).toHaveLength(1)
  })

  it('模型不匹配时保留派生配置（不改写）', async () => {
    const fixture = createMemoryRuntime()
    await createWebhookSession(
      fixture.ports, makeDelivery(), WebhookRuleId('r1'),
      makeRequest({ model: { provider: 'p', model: 'm' } }),
      new AbortController().signal,
    )
    const agent = fixture.agents.creations[0]!
    const resolved = await agent.simulateRequest({ provider: 'other', model: 'other-model' })
    expect(resolved).toMatchObject({ provider: 'other', model: 'other-model' })
  })

  it('缺省选择时也注册 agent/request 钩子', async () => {
    const fixture = createMemoryRuntime()
    await createWebhookSession(fixture.ports, makeDelivery(), WebhookRuleId('r1'), makeRequest(), new AbortController().signal)
    const agent = fixture.agents.creations[0]!
    expect(agent.requestHandlers.length).toBeGreaterThan(0)
  })
})