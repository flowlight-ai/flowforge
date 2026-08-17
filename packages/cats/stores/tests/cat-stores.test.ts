/**
 * CatStores aggregate + MemoryStoresBackend plugin integration — verifies
 * the dsh-style Cordis service aggregation pattern:
 *
 *  - Mounting `@flowforge/cats-stores` default plugin registers both
 *    CatStores (at `ctx.catStores`) AND MemoryStoresBackend (at
 *    `ctx.catStoresMemory`).
 *  - The Memory backend auto-registers itself as the active backend via
 *    `static inject = ['catStores']` + `ctx.effect()`.
 *  - Consumer accessors (`ctx.catStores.messages()`, `.threads()`, etc.)
 *    route through the active backend.
 *  - `activate(name)` switches the active backend; `unregisterBackend`
 *    (effect teardown) reverts to the previous-most-recent backend.
 *
 * @module @flowforge/cats-stores/tests
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import Plugin, { CatStores, MEMORY_BACKEND_NAME, MemoryStoresBackend } from '../src/index.ts'

const CAT_OPUS = createCatId('opus')
const USER_ALICE = createUserId('alice')

/**
 * Track plugin fibers so each test tears down cleanly. Cordis disposal is via
 * Fiber.dispose() (returned by ctx.plugin), NOT ctx.dispose — Context has no
 * dispose method; services/effects clean up when their owning fiber is torn
 * down.
 */
const fibers: Array<{ dispose: () => Promise<void> | void }> = []
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!
    await fiber.dispose()
  }
})

async function withPlugin(): Promise<Context> {
  const ctx = new Context()
  // Cordis `ctx.plugin()` returns a Promise<Fiber> that resolves once the
  // plugin (and any services it mounts) has fully started. Awaiting it
  // guarantees `ctx.catStores` and `ctx.catStoresMemory` are populated
  // before assertions run. Fiber.dispose() (not Context.dispose) tears
  // down the plugin's effects/services.
  const fiber = await ctx.plugin(Plugin) as unknown as { dispose: () => Promise<void> | void }
  fibers.push(fiber)
  return ctx
}

describe('CatStores + MemoryStoresBackend — default plugin', () => {
  it('mounts ctx.catStores aggregate + ctx.catStoresMemory backend', async () => {
    const ctx = await withPlugin()
    expect(ctx.catStores).toBeInstanceOf(CatStores)
    expect(ctx.catStoresMemory).toBeInstanceOf(MemoryStoresBackend)
  })

  it('auto-registers the Memory backend as active', async () => {
    const ctx = await withPlugin()
    expect(ctx.catStores.activeBackendName()).toBe(MEMORY_BACKEND_NAME)
    expect(ctx.catStores.backendNames()).toContain(MEMORY_BACKEND_NAME)
  })

  it('throws when no backend is registered (e.g. caller mounts CatStores alone)', async () => {
    const ctx = new Context()
    await ctx.plugin(CatStores)
    expect(() => ctx.catStores.messages()).toThrow(/No cats-stores backend registered/)
  })

  it('resolves each store type through the active backend', async () => {
    const ctx = await withPlugin()
    expect(typeof ctx.catStores.messages().append).toBe('function')
    expect(typeof ctx.catStores.threads().create).toBe('function')
    expect(typeof ctx.catStores.tasks().create).toBe('function')
    expect(typeof ctx.catStores.backlogs().create).toBe('function')
    expect(typeof ctx.catStores.memory().create).toBe('function')
  })
})

describe('CatStores — backend switching', () => {
  it('rejects duplicate backend names', async () => {
    const ctx = await withPlugin()
    // Re-registering under an existing name must fail. Use a minimal fake
    // backend object — we only exercise the aggregate's name-uniqueness check,
    // not Service instantiation (which is itself name-unique in Cordis).
    const fakeBackend = {
      messageStore: {} as never,
      threadStore: {} as never,
      taskStore: {} as never,
      backlogStore: {} as never,
      memoryStore: {} as never,
    }
    expect(() => ctx.catStores.registerBackend(MEMORY_BACKEND_NAME, fakeBackend)).toThrow(/already registered/)
  })

  it('activate(name) pins the active backend; throws for unknown', async () => {
    const ctx = await withPlugin()
    expect(() => ctx.catStores.activate('unknown')).toThrow(/not registered/)
    ctx.catStores.activate(MEMORY_BACKEND_NAME)
    expect(ctx.catStores.activeBackendName()).toBe(MEMORY_BACKEND_NAME)
  })

  it('backend(name) returns the backend; undefined for unknown', async () => {
    const ctx = await withPlugin()
    expect(ctx.catStores.backend(MEMORY_BACKEND_NAME)).toBeDefined()
    expect(ctx.catStores.backend('nope')).toBeUndefined()
  })
})

describe('CatStores + MemoryStoresBackend — end-to-end store ops', () => {
  it('append + read a message through ctx.catStores.messages()', async () => {
    const ctx = await withPlugin()
    // The port interface widens return types to `X | Promise<X>` (allowing
    // async Sqlite backends); for the Memory backend — which is sync — use
    // the concrete MemoryMessageStore (exposed via ctx.catStoresMemory) so
    // assertions can read fields without awaiting.
    const store = ctx.catStoresMemory.messageStore
    const stored = store.append({
      userId: USER_ALICE,
      catId: CAT_OPUS,
      content: 'hello via aggregate',
      mentions: [],
      timestamp: Date.now(),
    })
    expect(stored.threadId).toBe('default')
    expect(store.getById(stored.id)?.content).toBe('hello via aggregate')
  })

  it('create + read a thread through ctx.catStores.threads()', async () => {
    const ctx = await withPlugin()
    const store = ctx.catStoresMemory.threadStore
    const t = store.create({ userId: USER_ALICE, title: 'aggregate-thread' })
    expect(store.getById(t.id)?.title).toBe('aggregate-thread')
  })

  it('create + read a task through ctx.catStores.tasks()', async () => {
    const ctx = await withPlugin()
    const store = ctx.catStoresMemory.taskStore
    const t = store.create({
      threadId: 't1',
      userId: USER_ALICE,
      catId: CAT_OPUS,
      title: 'aggregate-task',
      status: 'todo',
      kind: 'work',
    })
    expect(store.getById(t.id)?.title).toBe('aggregate-task')
  })

  it('create + read a backlog item through ctx.catStores.backlogs()', async () => {
    const ctx = await withPlugin()
    const store = ctx.catStoresMemory.backlogStore
    const item = store.create({
      userId: USER_ALICE,
      title: 'aggregate-backlog',
      summary: 'verify aggregate',
      priority: 'p1',
      tags: ['test'],
      status: 'open',
      createdBy: 'user',
    })
    expect(store.getById(item.id)?.title).toBe('aggregate-backlog')
  })

  it('create + read a long-term memory through ctx.catStores.memory()', async () => {
    const ctx = await withPlugin()
    const store = ctx.catStoresMemory.memoryStore
    const m = store.create({
      catId: CAT_OPUS,
      kind: 'episode',
      content: 'aggregate-memory',
      importance: 0.7,
    })
    expect(store.getById(m.id)?.content).toBe('aggregate-memory')
  })
})

describe('CatStores — backend disposal', () => {
  it('disposing the Memory backend fiber unregisters it from the aggregate', async () => {
    const ctx = new Context()
    await ctx.plugin(CatStores)
    const fiber = await ctx.plugin(MemoryStoresBackend) as unknown as { dispose: () => Promise<void> | void }
    expect(ctx.catStores.activeBackendName()).toBe(MEMORY_BACKEND_NAME)
    await fiber.dispose()
    expect(ctx.catStores.backendNames()).not.toContain(MEMORY_BACKEND_NAME)
    expect(() => ctx.catStores.messages()).toThrow(/No cats-stores backend registered/)
  })
})
