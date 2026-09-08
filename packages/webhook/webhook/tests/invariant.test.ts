/**
 * @flowforge/webhook 契约测试（C）— 不变量政策、安装与内存实现行为。
 */

import { describe, expect, it } from 'vitest'
import {
  evaluateWebhookInboxPlacement,
  extractWebhookInboxCount,
  installWebhookInvariant,
  createMemoryRuntime,
  createWebhookSession,
  WebhookRuleId,
  WebhookSourceId,
  WebhookDeliveryId,
  memorySessionId,
} from '../src/index.ts'
import type { VerifiedWebhookDelivery } from '../src/index.ts'
import type { InvariantSessionView, WorkspaceOwnerFact } from '../src/index.ts'

function session(id: string, cwd?: string): InvariantSessionView {
  return { id, header: cwd === undefined ? {} : { cwd } }
}

function owner(path: string, sessionIds: readonly string[]): WorkspaceOwnerFact {
  return { path, sessionIds }
}

function delivery(): VerifiedWebhookDelivery<'github'> {
  return {
    kind: 'github',
    source: WebhookSourceId('primary-github'),
    deliveryId: WebhookDeliveryId('uuid-1'),
    event: {},
    receivedAt: 1_700_000_000_000,
  }
}

describe('evaluateWebhookInboxPlacement（纯判定）', () => {
  it('单一归属且 cwd 匹配 → 合法', () => {
    expect(evaluateWebhookInboxPlacement(session('s1', '/a'), [owner('/a', ['s1'])])).toBeUndefined()
  })

  it('Session 无 cwd → 失败', () => {
    expect(evaluateWebhookInboxPlacement(session('s1'), [owner('/a', ['s1'])])).toContain('no cwd')
  })

  it('归属数量≠1 → 失败（含零归属）', () => {
    expect(evaluateWebhookInboxPlacement(session('s1', '/a'), [])).toContain('belongs to 0')
    expect(evaluateWebhookInboxPlacement(session('s1', '/a'), [owner('/a', ['s1']), owner('/b', ['s1'])])).toContain('belongs to 2')
  })

  it('归属 path 与 cwd 不一致 → 失败', () => {
    expect(evaluateWebhookInboxPlacement(session('s1', '/a'), [owner('/b', ['s1'])])).toContain('differs')
  })
})

describe('extractWebhookInboxCount', () => {
  it('agent/inbox/spliced 事件中统计 webhook 来源消息', () => {
    const event = {
      type: 'agent/inbox/spliced',
      data: {
        inserted: [
          { source: { kind: 'webhook' } },
          { source: { kind: 'user' } },
          { source: { kind: 'webhook' } },
        ],
      },
    }
    expect(extractWebhookInboxCount(event)).toBe(2)
  })

  it('非 spliced 事件返回 0', () => {
    expect(extractWebhookInboxCount({ type: 'other' })).toBe(0)
    expect(extractWebhookInboxCount({ type: 'agent/inbox/spliced', data: { inserted: [] } })).toBe(0)
  })
})

describe('installWebhookInvariant（经注入端口安装）', () => {
  it('无归属 workng 时产生“belongs to 0”失败', () => {
    const fixture = createMemoryRuntime({ installInvariant: false })
    installWebhookInvariant(fixture.invariants, id => fixture.workspaceRegistry.ownersOf(id))
    fixture.invariants.notifySessionEvent({
      session: session('s1', '/a'),
      event: { type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'webhook' } }] } },
    })
    expect(fixture.invariants.failures.some(f => f.message.includes('belongs to 0'))).toBe(true)
  })

  it('归属合法时不产生失败', async () => {
    const fixture = createMemoryRuntime({ installInvariant: false })
    installWebhookInvariant(fixture.invariants, id => fixture.workspaceRegistry.ownersOf(id))
    await createWebhookSession(fixture.ports, delivery(), WebhookRuleId('r1'), {
      workspacePath: '/tmp/a', title: 'T', prompt: 'p', agentPreset: 'base', permissionPreset: 'sandboxed',
    }, new AbortController().signal)
    const agent = fixture.agents.creations[0]!
    const cwd = agent.session.header.cwd
    // 注入一次恰有单一匹配归属的 event。
    fixture.invariants.notifySessionEvent({
      session: session(agent.session.id, cwd),
      event: { type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'webhook' } }] } },
    })
    expect(fixture.invariants.failures).toHaveLength(0)
  })

  it('安装后卸载清理器停止监听', () => {
    const fixture = createMemoryRuntime({ installInvariant: false })
    const release = installWebhookInvariant(fixture.invariants, id => fixture.workspaceRegistry.ownersOf(id))
    release()
    fixture.invariants.notifySessionEvent({
      session: session('s1', '/a'),
      event: { type: 'agent/inbox/spliced', data: { inserted: [{ source: { kind: 'webhook' } }] } },
    })
    expect(fixture.invariants.failures).toHaveLength(0)
  })

  it('invariant 重复注册同名抛错', () => {
    const fixture = createMemoryRuntime({ installInvariant: false })
    installWebhookInvariant(fixture.invariants, id => fixture.workspaceRegistry.ownersOf(id))
    expect(() => installWebhookInvariant(fixture.invariants, id => fixture.workspaceRegistry.ownersOf(id))).toThrow(/already registered/)
  })
})

describe('内存实现行为', () => {
  it('workspace attach/detach 维护 sessionIds', async () => {
    const fixture = createMemoryRuntime()
    const workspace = await fixture.workspaceRegistry.create('/tmp/x')
    await workspace.attachSession('s1')
    await workspace.attachSession('s2')
    expect(workspace.sessionIds).toEqual(['s1', 's2'])
    await workspace.detachSession('s1')
    expect(workspace.sessionIds).toEqual(['s2'])
  })

  it('agents.create 记录 meta/options 并执行 setup', async () => {
    const fixture = createMemoryRuntime()
    const handle = await fixture.agents.create({
      sessionId: 's1',
      signal: new AbortController().signal,
      meta: { cwd: '/c', agentPreset: 'p' },
      agentOptions: { provider: 'x', model: 'y' },
      setup: async target => { target.on('agent/request', async (_p, next) => next()) },
    })
    expect(handle.agent.session.id).toBe('s1')
    expect(fixture.agents.creations).toHaveLength(1)
  })

  it('createWebhookSession 记录 permission/sessionTitle/followup 足迹', async () => {
    const fixture = createMemoryRuntime()
    await createWebhookSession(fixture.ports, delivery(), WebhookRuleId('r1'), {
      workspacePath: '/tmp/a', title: 'T', prompt: 'p', agentPreset: 'base', permissionPreset: 'sandboxed',
    }, new AbortController().signal)
    const agent = fixture.agents.creations[0]!
    expect(fixture.permissionPresets.sets[0]?.name).toBe('sandboxed')
    expect(fixture.sessionTitle.renames[0]?.title).toBe('T')
    expect(agent.followups[0]?.content[0]?.text).toBe('p')
  })

  it('memorySessionId 构造品牌字符串', () => {
    expect(memorySessionId('abc')).toMatch(/^test-abc$/)
  })
})