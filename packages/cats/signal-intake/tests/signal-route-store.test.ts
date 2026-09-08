/**
 * 信号路由存储契约。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MemorySignalRouteStore } from '../src/SignalRouteStore.ts'
import { makeRoute } from './fixtures.ts'

describe('MemorySignalRouteStore', () => {
  it('get returns null when absent', async () => {
    const store = new MemorySignalRouteStore()
    expect(await store.get('p', 's')).toBeNull()
  })

  it('put then get round-trips a route', async () => {
    const store = new MemorySignalRouteStore()
    const route = makeRoute()
    await store.put(route)
    expect(await store.get('plugin-feishu', 'feishu.meeting.occurred')).toEqual(route)
  })

  it('routes are keyed by pluginId × signalType', async () => {
    const store = new MemorySignalRouteStore()
    await store.put(makeRoute({ signalType: 'a' }))
    expect(await store.get('plugin-feishu', 'b')).toBeNull()
  })

  it('putIfAbsent inserts only once', async () => {
    const store = new MemorySignalRouteStore()
    const route = makeRoute()
    expect(await store.putIfAbsent(route)).toBe(true)
    expect(await store.putIfAbsent(makeRoute({ generation: 2 }))).toBe(false)
    expect(await store.get('plugin-feishu', 'feishu.meeting.occurred')).toEqual(route)
  })
})