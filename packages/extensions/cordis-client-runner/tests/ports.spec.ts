import { describe, expect, it } from 'vitest'
import { createMemoryClientSlots } from '../src/ports/slots.ts'
import { createMemoryServiceHost } from '../src/ports/service-host.ts'
import { createMemoryStyleDocument } from '../src/ports/style.ts'
import { createMemoryLoaderModules } from '../src/ports/loader-modules.ts'

describe('MemoryClientSlots (slot registry seam)', () => {
  it('declares specs, registers/unregisters entries and reads them back', () => {
    const slots = createMemoryClientSlots()
    slots.declare('sidebar.footer.action', { kind: 'list', scope: 'root' })
    expect(slots.spec('sidebar.footer.action')?.kind).toBe('list')

    const component = { render: 'CordisPanel' }
    const dispose = slots.register({ name: 'sidebar.footer.action', locale: 'cordis' }, component)
    expect(slots.entries('sidebar.footer.action')).toHaveLength(1)
    expect(slots.entries('sidebar.footer.action')[0].component).toBe(component)

    dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('projects a root/anchor slot subtree', () => {
    const slots = createMemoryClientSlots()
    slots.declare('root', { kind: 'list', scope: 'root' })
    slots.declare('child', { kind: 'chain', scope: 'session', parent: 'root' })
    slots.register({ name: 'child' }, { view: 'x' })

    const tree = slots.snapshot()
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('root')
    expect(tree[0].children[0].name).toBe('child')
    expect(tree[0].children[0].occupants).toHaveLength(1)

    const anchored = slots.snapshot('child')
    expect(anchored).toHaveLength(1)
    expect(anchored[0].name).toBe('child')
  })

  it('fans a crash out to every subscribed supervisor', () => {
    const slots = createMemoryClientSlots()
    const seen: string[] = []
    const unsubscribe = slots.onEntryError((slot, entry, error) => {
      seen.push(`${slot}/${entry.key}/${error instanceof Error ? error.message : ''}`)
    })
    slots.declare('boom', { kind: 'single', scope: 'root' })
    const entry = { key: 'b', options: {}, component: {} }
    slots.crash('boom', entry, new Error('kaboom'), { abdicated: true })
    expect(seen).toEqual(['boom/b/kaboom'])
    unsubscribe()
    slots.crash('boom', entry, new Error('again'), { abdicated: false })
    expect(seen).toHaveLength(1)
  })
})

describe('MemoryServiceHost (service-host seam)', () => {
  it('provides, gets and disposes services and fiber effects', () => {
    const host = createMemoryServiceHost()
    const timer = { timeout() {} }
    expect(host.get('timer')).toBeUndefined()
    const dispose = host.provide('timer', timer)
    expect(host.get('timer')).toBe(timer)
    dispose()
    expect(host.get('timer')).toBeUndefined()

    let cleaned = 0
    const undo = host.registerEffect(() => { cleaned += 1 })
    host.disposeEffects()
    expect(cleaned).toBe(1)
    // disposing again must not re-run an already-cleared effect set
    host.disposeEffects()
    expect(cleaned).toBe(1)
    // the disposer removed it from the set too
    undo()
    expect(cleaned).toBe(1)
  })

  it('tracks the declared service set', () => {
    const host = createMemoryServiceHost()
    host.setDeclaredServices(['slots', 'theme'])
    expect([...host.declaredServices()]).toEqual(['slots', 'theme'])
    host.setDeclaredServices(['slots'])
    expect(host.declaredServices().has('slots')).toBe(true)
    expect(host.declaredServices().has('theme')).toBe(false)
  })
})

describe('MemoryStyleDocument', () => {
  it('attaches/detaches style nodes and stamps fresh identities', () => {
    const doc = createMemoryStyleDocument()
    const node = doc.createStyleNode('p1')
    expect(node.attached).toBe(false)
    doc.attach(node)
    expect(node.attached).toBe(true)
    doc.attach(node) // idempotent
    expect(doc.attachedNodes).toHaveLength(1)
    doc.detach(node)
    expect(doc.attachedNodes).toHaveLength(0)
    expect(doc.stamp()).toBe('node-1')
    expect(doc.stamp()).toBe('node-2')
  })
})

describe('MemoryLoaderModules (loader/module-table seam)', () => {
  it('seats a module, runs its apply on the fiber and captures inject', async () => {
    const loader = createMemoryLoaderModules()
    loader.registerModule('dyn/p1', () => ({ inject: ['slots'], apply() {} }))
    const id = await loader.createEntry('dyn/p1')
    const fiber = loader.fiberOf(id)
    expect(fiber).toBeDefined()
    await fiber!.await()
    expect(fiber!.active).toBe(true)
    expect(fiber!.inject).toHaveProperty('slots')
  })

  it('invalidates a module and tears the entry down', async () => {
    const loader = createMemoryLoaderModules()
    loader.registerModule('dyn/p1', () => ({ apply() {} }))
    const id = await loader.createEntry('dyn/p1')
    loader.invalidateModule('dyn/p1')
    await loader.removeEntry(id)
    expect(loader.fiberOf(id)).toBeUndefined()
    expect(loader.entryCount()).toBe(0)
  })
})