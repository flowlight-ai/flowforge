import { describe, expect, it } from 'vitest'
import { DynamicCordisPackageRunner } from '../src/runtime.ts'
import type { DynamicCordisRunnerEnv, DynamicCordisClientHalf, DynamicCordisRenderFailure } from '../src/runtime.ts'
import { createMemoryClientSlots } from '../src/ports/slots.ts'
import { createMemoryServiceHost } from '../src/ports/service-host.ts'
import { createMemoryStyleDocument } from '../src/ports/style.ts'
import { createMemoryLoaderModules } from '../src/ports/loader-modules.ts'
import type {
  CordisDynamicPluginId, CordisDynamicPackageId, CordisDynamicPluginRunId,
} from '../src/types.ts'

function half(pluginId: CordisDynamicPluginId): DynamicCordisClientHalf {
  return {
    pluginId,
    packageId: `${pluginId}@v1` as CordisDynamicPackageId,
    pluginRunId: `${pluginId}#1` as CordisDynamicPluginRunId,
    agentId: 'agent-1',
    name: pluginId,
    code: 'return (ctx) => { ctx.slots.register({ name: "sidebar.footer.action" }, { render() {} }) }',
  }
}

/** Assemble a real in-memory runner directly over the memory ports. */
function makeRunner() {
  const slots = createMemoryClientSlots()
  const host = createMemoryServiceHost()
  const styleDocument = createMemoryStyleDocument()
  const loader = createMemoryLoaderModules()
  const renderFailures: DynamicCordisRenderFailure[] = []
  const guardFailures: string[] = []
  // The page shell declares which services a dynamic ctx exposes; the facade
  // whitelists exactly those. slots + theme are the usual UI seats, and slots
  // is provided so the guarded register reaches the real registry.
  host.setDeclaredServices(['slots', 'theme'])
  host.provide('slots', slots)
  const env: DynamicCordisRunnerEnv = {
    host,
    slots,
    loader,
    styleDocument,
    invoke: async () => null,
    reportRenderFailure: (_a, _p, _r, failure) => { renderFailures.push(failure) },
    reportGuardFailure: (agent, plugin, run, failure) => {
      guardFailures.push(`${agent}/${plugin}/${run}: ${failure.message}`)
    },
  }
  const runner = new DynamicCordisPackageRunner(env)
  return { runner, slots, host, styleDocument, loader, renderFailures, guardFailures }
}

describe('DynamicCordisPackageRunner', () => {
  it('loads a browser half and reports the loaded live package', async () => {
    const { runner, slots } = makeRunner()
    slots.declare('sidebar.footer.action', { kind: 'list', scope: 'root' })
    const result = await runner.load(half('p1'))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pluginRunId).toBe('p1#1')
    expect(runner.isLoaded('p1')).toBe(true)
    const live = runner.getSnapshot()
    expect(live).toHaveLength(1)
    expect(live[0].pluginId).toBe('p1')
    expect(live[0].slots).toContain('sidebar.footer.action')
    // The guarded apply seated an entry through the real loader + slots.
    expect(slots.entries('sidebar.footer.action').length).toBeGreaterThan(0)
  })

  it('parks a package when a declared service is missing (still a success)', async () => {
    const { runner } = makeRunner()
    const result = await runner.load({
      ...half('p2'),
      code: 'return { name: "x", inject: ["slots", "missingService"], apply() {} }',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.waitingFor).toContain('missingService')
  })

  it('converges: re-loading the same plugin run id answers without re-mounting', async () => {
    const { runner, loader } = makeRunner()
    const first = await runner.load(half('p3'))
    expect(first.ok).toBe(true)
    const entriesBefore = loader.entryCount()
    const second = await runner.load(half('p3'))
    expect(second.ok).toBe(true)
    expect(loader.entryCount()).toBe(entriesBefore)
  })

  it('re-mounts when a newer plugin run id replaces the live one', async () => {
    const { runner, loader, slots } = makeRunner()
    slots.declare('sidebar.footer.action', { kind: 'list', scope: 'root' })
    await runner.load(half('p4'))
    const prior = loader.entryCount()
    const newer: DynamicCordisClientHalf = {
      ...half('p4'),
      pluginRunId: 'p4#2' as CordisDynamicPluginRunId,
    }
    await runner.load(newer)
    expect(loader.entryCount()).toBe(prior) // old entry removed, new seated
    expect(runner.getSnapshot()[0].pluginRunId).toBe('p4#2')
  })

  it('unloads a package on retract', async () => {
    const { runner } = makeRunner()
    await runner.load(half('p5'))
    expect(runner.isLoaded('p5')).toBe(true)
    await runner.retract('p5', 'p5#1')
    expect(runner.isLoaded('p5')).toBe(false)
    expect(runner.getSnapshot()).toHaveLength(0)
  })

  it('ignores a retract for an unknown run id', async () => {
    const { runner } = makeRunner()
    await runner.load(half('p6'))
    await runner.retract('p6', 'p6#999')
    expect(runner.isLoaded('p6')).toBe(true)
  })

  it('reports render crashes of a seated component back to the owner Agent', async () => {
    const { runner, slots, renderFailures } = makeRunner()
    await runner.load({
      ...half('p7'),
      code: 'return { inject: ["slots"], apply(ctx) { ctx.slots.register({ name: "boom" }, { name: "boom" }) } }',
    })
    const entry = slots.entries('boom')[0]
    expect(entry).toBeDefined()
    slots.crash('boom', entry, new Error('render exploded'), { abdicated: true })
    expect(renderFailures).toHaveLength(1)
    expect(renderFailures[0].slot).toBe('boom')
    expect(renderFailures[0].message).toContain('render exploded')
    expect(renderFailures[0].abdicated).toBe(true)
    expect(runner.renderFailures.getSnapshot().has('p7')).toBe(true)
  })

  it('notifies subscribers when the live set changes', async () => {
    const { runner } = makeRunner()
    let calls = 0
    const unsubscribe = runner.subscribe(() => { calls += 1 })
    await runner.load(half('p8'))
    expect(calls).toBeGreaterThan(0)
    unsubscribe()
  })

  it('disposes everything and unregisters the crash supervisor', async () => {
    const { runner } = makeRunner()
    await runner.load(half('p9'))
    await runner.dispose()
    expect(runner.isLoaded('p9')).toBe(false)
    expect(runner.getSnapshot()).toHaveLength(0)
    // Loading again still works after dispose (the manager object remains usable).
    const again = await runner.load(half('p9'))
    expect(again.ok).toBe(true)
  })
})