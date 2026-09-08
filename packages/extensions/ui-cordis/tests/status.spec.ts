// Visible status derivation: how inventory rows and the page's Client live set
// combine into idle / client-pending / running (pure-logic port of the dsh
// status derivation).

import { describe, expect, it } from 'vitest'
import { cordisVisibleStatus, packageOf } from '../src/status.ts'
import type { DynamicCordisInventoryRow, DynamicCordisLivePackage } from '../src/events.ts'

function row(over: Partial<DynamicCordisInventoryRow> = {}): DynamicCordisInventoryRow {
  return {
    agentId: 'sess-1',
    pluginId: 'dyn-1',
    packages: [{ packageId: 'pkg-1', name: 'clock', purpose: '顶栏时钟', hasClientHalf: true }],
    ...over,
  }
}

describe('packageOf', () => {
  it('locates an immutable package inside a plugin row', () => {
    const r = row()
    expect(packageOf(r, 'pkg-1')?.name).toBe('clock')
    expect(packageOf(r, 'pkg-999')).toBeUndefined()
  })
})

describe('cordisVisibleStatus', () => {
  it('reports idle when the plugin is unknown or has no matching active run', () => {
    expect(cordisVisibleStatus(undefined, 'pkg-1', [])).toBe('idle')
    const idle = row({ activeRun: { pluginRunId: 'run-2', packageId: 'pkg-2' } })
    expect(cordisVisibleStatus(idle, 'pkg-1', [])).toBe('idle')
  })

  it('treats a package without a client half as fully running once its Host run is active', () => {
    const hostOnly = row({
      packages: [{ packageId: 'pkg-1', name: 'clock', purpose: '' }],
      activeRun: { pluginRunId: 'run-1', packageId: 'pkg-1' },
    })
    expect(cordisVisibleStatus(hostOnly, 'pkg-1', [])).toBe('running')
  })

  it('is client-pending until this page loads the exact activation', () => {
    const r = row({ activeRun: { pluginRunId: 'run-1', packageId: 'pkg-1' } })
    expect(cordisVisibleStatus(r, 'pkg-1', [])).toBe('client-pending')

    const loaded: DynamicCordisLivePackage[] = [
      { pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-1' },
    ]
    expect(cordisVisibleStatus(r, 'pkg-1', loaded)).toBe('running')
  })

  it('does not count a loaded live package of a different run as running', () => {
    const r = row({ activeRun: { pluginRunId: 'run-1', packageId: 'pkg-1' } })
    const loaded: DynamicCordisLivePackage[] = [
      { pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-2' },
    ]
    expect(cordisVisibleStatus(r, 'pkg-1', loaded)).toBe('client-pending')
  })
})