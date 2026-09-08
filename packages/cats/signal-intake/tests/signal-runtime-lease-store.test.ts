/**
 * 信号运行时租约存储契约。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MemorySignalRuntimeLeaseStore } from '../src/SignalRuntimeLeaseStore.ts'
import { makeLease } from './fixtures.ts'

describe('MemorySignalRuntimeLeaseStore', () => {
  it('get returns null for an unknown lease', async () => {
    const store = new MemorySignalRuntimeLeaseStore()
    expect(await store.get('nope')).toBeNull()
  })

  it('put then get round-trips a lease', async () => {
    const store = new MemorySignalRuntimeLeaseStore()
    const lease = makeLease()
    store.put(lease)
    expect(await store.get('lease-1')).toEqual(lease)
  })
})