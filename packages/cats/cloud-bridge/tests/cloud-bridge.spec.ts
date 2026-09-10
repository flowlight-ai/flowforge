import { describe, expect, it } from 'vitest'
import { buildDeltaPayload, applyDeltaPayload } from '../src/build-delta-payload.ts'
import type { CloudInvokeRequest, CloudSegment } from '../src/cloud-bridge-types.ts'
import { resolveRouting } from '../src/routing.ts'
import { deriveSummary } from '../src/summary.ts'
import { MemoryCapabilityRegistry } from '../src/capabilities.ts'
import { MemoryCloudBridgeStore } from '../src/store.ts'
import { MemoryConversationHostAdapter } from '../src/conversation-host-adapter.ts'
import { InMemoryReturnBindingRepository, MemoryReturnBinding } from '../src/return-binding.ts'
import { ReturnBindingConflictError } from '../src/errors.ts'
import { invokeThroughCloudBridge, type CloudInvokeBridgeDeps } from '../src/cloud-invoke-bridge.ts'

function segment(seq: number, kind: 'text' | 'tool', content: string): CloudSegment {
  return { seq, kind, content }
}

describe('buildDeltaPayload', () => {
  it('appends new segments and omits unchanged ones', () => {
    const previous = [segment(0, 'text', 'hello')]
    const next = [segment(0, 'text', 'hello'), segment(1, 'text', ' world')]
    const delta = buildDeltaPayload(previous, next)
    expect(delta).toEqual([{ op: 'append', segmentSeq: 1, kind: 'text', content: ' world' }])
  })

  it('replaces changed segments and removes deleted ones', () => {
    const previous = [segment(0, 'text', 'old'), segment(1, 'text', 'keep'), segment(2, 'tool', 'gone')]
    const next = [segment(0, 'text', 'new'), segment(1, 'text', 'keep')]
    const delta = buildDeltaPayload(previous, next)
    expect(delta).toEqual([
      { op: 'replace', segmentSeq: 0, kind: 'text', content: 'new' },
      { op: 'remove', segmentSeq: 2 },
    ])
  })

  it('round-trips through applyDeltaPayload', () => {
    const previous = [segment(0, 'text', 'a'), segment(1, 'text', 'b')]
    const next = [segment(0, 'text', 'A'), segment(2, 'text', 'c')]
    expect(applyDeltaPayload(previous, buildDeltaPayload(previous, next))).toEqual(next)
  })
})

describe('resolveRouting', () => {
  it('routes to local when all capabilities are advertised', () => {
    const request: CloudInvokeRequest = {
      invocationId: 'i1',
      threadId: 't1',
      catId: 'gpt-pro',
      userId: 'u1',
      query: 'q',
      contextMessages: [],
      requiredCapabilities: ['a', 'b'],
    }
    expect(resolveRouting(request, ['a', 'b', 'c'])).toEqual({ outcome: 'local', missingCapabilities: [] })
  })

  it('routes to cloud when a capability is missing, listing what is missing', () => {
    const request: CloudInvokeRequest = {
      invocationId: 'i2',
      threadId: 't1',
      catId: 'gpt-pro',
      userId: 'u1',
      query: 'q',
      contextMessages: [],
      requiredCapabilities: ['a', 'missing-cap'],
    }
    expect(resolveRouting(request, ['a'])).toEqual({ outcome: 'cloud', missingCapabilities: ['missing-cap'] })
  })
})

describe('deriveSummary', () => {
  it('concats text segments and skips tool segments', () => {
    expect(deriveSummary([segment(0, 'text', 'foo'), segment(1, 'tool', 'x'), segment(2, 'text', 'bar')])).toBe('foo bar')
  })
})

describe('MemoryCapabilityRegistry', () => {
  it('adds, checks, removes and lists capabilities', () => {
    const registry = new MemoryCapabilityRegistry(['a'])
    registry.add('b')
    expect(registry.has('a')).toBe(true)
    expect(registry.has('b')).toBe(true)
    registry.remove('a')
    expect(registry.has('a')).toBe(false)
    expect(registry.list()).toEqual(['b'])
  })
})

function makeBridge(advertised: string[] = []): { deps: CloudInvokeBridgeDeps; host: MemoryConversationHostAdapter } {
  const host = new MemoryConversationHostAdapter()
  const deps: CloudInvokeBridgeDeps = {
    capabilityRegistry: new MemoryCapabilityRegistry(advertised),
    hostAdapter: host,
    returnBinding: new MemoryReturnBinding(new InMemoryReturnBindingRepository()),
    store: new MemoryCloudBridgeStore(),
  }
  return { deps, host }
}

const request: CloudInvokeRequest = {
  invocationId: 'inv-1',
  threadId: 't1',
  catId: 'gpt-pro',
  userId: 'u1',
  query: 'summarize the diff',
  contextMessages: [{ role: 'user', content: 'go' }],
  requiredCapabilities: ['deep-research'],
}

describe('invokeThroughCloudBridge', () => {
  it('returns a local route when capabilities are satisfied', async () => {
    const { deps } = makeBridge(['deep-research'])
    const result = await invokeThroughCloudBridge(request, deps)
    expect(result.route).toBe('local')
    expect(result.status).toBe('completed')
    expect(await deps.store.listByStatus('dispatched')).toHaveLength(0)
  })

  it('dispatches to the cloud host and binds output back', async () => {
    const { deps, host } = makeBridge()
    host.replaceContent('t1', [segment(0, 'text', 'Here is the summary:'), segment(1, 'text', ' done.')])

    const result = await invokeThroughCloudBridge(request, deps)

    expect(result.route).toBe('cloud')
    expect(result.bound?.appendedSegments.map((s) => s.content)).toEqual(['Here is the summary:', ' done.'])
    expect(result.bound?.summary).toContain('summary')

    const record = await deps.store.get('inv-1')
    expect(record?.status).toBe('bound')
    expect(record?.boundSegmentCount).toBe(2)
  })

  it('marks the bridge record failed and rejects when the cloud errors', async () => {
    const { deps, host } = makeBridge()
    host.replaceContent('t1', [])
    host.streamDeltas = async () => ({ invocationId: 'inv-1', status: 'failed', segments: [], errorCode: 'upstream_down' })

    await expect(invokeThroughCloudBridge(request, deps)).rejects.toThrow()
    expect((await deps.store.get('inv-1'))?.status).toBe('failed')
  })
})

describe('MemoryReturnBinding conflict', () => {
  it('throws ReturnBindingConflictError when base diverged', async () => {
    const repository = new InMemoryReturnBindingRepository()
    const binding = new MemoryReturnBinding(repository)
    await repository.setBase('t1', [segment(0, 'text', 'authoritative')])

    await expect(
      binding.bind({
        invocationId: 'i',
        threadId: 't1',
        response: { invocationId: 'i', status: 'completed', segments: [segment(0, 'text', 'x')] },
        snapshot: { threadId: 't1', assistantSegments: [segment(0, 'text', 'x')], updatedAt: 1 },
        previousSegments: [segment(0, 'text', 'stale')],
        committedAt: 100,
      }),
    ).rejects.toBeInstanceOf(ReturnBindingConflictError)
  })
})