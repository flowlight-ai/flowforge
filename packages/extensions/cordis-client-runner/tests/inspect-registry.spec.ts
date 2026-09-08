import { describe, expect, it } from 'vitest'
import { ClientCordisInspectRegistry } from '../src/inspect-registry.ts'
import type {
  ClientCordisInspectHost, ClientCordisInspectProviderRegistration,
} from '../src/inspect-registry.ts'

function makeRegistry() {
  const synced: Array<readonly { id: string }[]> = []
  const resolved: string[] = []
  const host: ClientCordisInspectHost = {
    sync: async (providers) => { synced.push(providers) },
    resolve: async (_session, _request, _resolution) => { resolved.push('resolved') },
  }
  const registry = new ClientCordisInspectRegistry(host)
  return { registry, synced, resolved }
}

function provider(id: string): ClientCordisInspectProviderRegistration {
  return {
    manifest: {
      id,
      description: `provider ${id}`,
      methods: [{ name: 'dir', description: 'directory' }],
    },
    query: async (method) => ({ id, method }),
  }
}

/** Flush microtasks + the queued-manifest same-loop publish. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  await Promise.resolve()
}

describe('ClientCordisInspectRegistry', () => {
  it('registers a provider, publishes its manifest and resolves a query', async () => {
    const { registry, synced, resolved } = makeRegistry()
    registry.register(provider('svc'))
    await flush()
    expect(synced).toHaveLength(1)
    expect(synced[0][0].id).toBe('svc')

    await registry.query({
      requestId: 'q1', provider: 'svc', method: 'dir', agentId: 'a', input: undefined,
    })
    expect(resolved).toEqual(['resolved'])
  })

  it('rejects duplicate providers, empty ids and repeated method names', () => {
    const { registry } = makeRegistry()
    registry.register(provider('a'))
    expect(() => registry.register(provider('a'))).toThrow(/already registered/)
    const empty = provider('b')
    empty.manifest = { ...empty.manifest, id: '  ' }
    expect(() => registry.register(empty)).toThrow(/must not be empty/)
    const repeat = provider('c')
    repeat.manifest = {
      ...repeat.manifest,
      methods: [{ name: 'x', description: '1' }, { name: 'x', description: '2' }],
    }
    expect(() => registry.register(repeat)).toThrow(/repeats method/)
  })

  it('reports provider-missing and method-missing resolutions', async () => {
    const { registry, resolved } = makeRegistry()
    await registry.query({ requestId: 'q1', provider: 'nope', method: 'dir', agentId: 'a', input: undefined })
    expect(resolved).toEqual(['resolved'])
  })

  it('disposing a registration republishes the manifest without it', async () => {
    const { registry, synced } = makeRegistry()
    const dispose = registry.register(provider('a'))
    registry.register(provider('b'))
    await flush()
    expect(synced.at(-1)!.map(p => p.id).sort()).toEqual(['a', 'b'])
    dispose()
    await flush()
    expect(synced.at(-1)!.map(p => p.id)).toEqual(['b'])
  })
})