/**
 * Loader/module-table seam + a real in-memory implementation.
 *
 * Stands in for the dsh `cordis-plugin-loader` (entries with fibers) and the
 * client-modules `ClientModuleSystem` (factory registration / invalidation)
 * that the runner rode to seat dynamic packages as loader entries. The runner's
 * guarded surface is what a `LoaderModulesPort` runs; the guard reaches
 * declared services through the service host, so the loader itself stays a dumb
 * execution seam.
 *
 * Per the seam pattern: a port interface + a real memory implementation, no
 * mocks.
 *
 * @module @flowforge/cordis-client-runner/ports/loader-modules
 */

/** A loader entry's execution fiber: its declared injects and run state. */
export interface PackageFiber {
  /** Service names the seated plugin declared (drives parked-detection). */
  inject: Record<string, unknown>
  /** Whether `await()` already ran the guarded apply once. */
  active: boolean
  /** Run the seated surface's apply (idempotent; no-op once active). */
  await(): Promise<void>
}

/** The module-table + loader surface the runner drives. */
export interface LoaderModulesPort {
  /** Replace (seat) one module factory; prior registrations are superseded. */
  registerModule(id: string, factory: () => unknown): void
  /** Drop one module factory so a later re-seat is legal. */
  invalidateModule(id: string): void
  /** Create a loader entry for a module name, answering its entry id. */
  createEntry(name: string): Promise<string>
  /** Remove a loader entry (fiber disposal/cascade path). */
  removeEntry(id: string): Promise<void>
  /** Resolve the fiber of one entry (undefined when the entry is gone). */
  fiberOf(id: string): PackageFiber | undefined
}

/** Minimal bounds a seatable module must expose for the loader to run it. */
interface SeatableModule {
  readonly inject?: readonly string[]
  apply(ctx: unknown, config?: unknown): unknown
}

/** Real in-memory loader + module table. */
export class MemoryLoaderModules implements LoaderModulesPort {
  private readonly modules = new Map<string, () => unknown>()
  private readonly entries = new Map<string, { name: string; fiber: PackageFiber }>()
  private nextId = 0

  registerModule(id: string, factory: () => unknown): void {
    this.modules.set(id, factory)
  }

  invalidateModule(id: string): void {
    this.modules.delete(id)
  }

  createEntry(name: string): Promise<string> {
    let ran = false
    const fiber: PackageFiber = {
      inject: {},
      active: false,
      await: async (): Promise<void> => {
        if (ran) return
        ran = true
        const factory = this.modules.get(name)
        if (factory === undefined) throw new Error(`no module registered for "${name}"`)
        const surface = factory() as SeatableModule
        fiber.inject = Object.fromEntries((surface.inject ?? []).map(service => [service, true]))
        surface.apply(undefined)
        fiber.active = true
      },
    }
    this.nextId += 1
    const id = `entry-${this.nextId}`
    this.entries.set(id, { name, fiber })
    return Promise.resolve(id)
  }

  removeEntry(id: string): Promise<void> {
    this.entries.delete(id)
    return Promise.resolve()
  }

  fiberOf(id: string): PackageFiber | undefined {
    return this.entries.get(id)?.fiber
  }

  /** Live entry count (diagnostics / tests). */
  entryCount(): number {
    return this.entries.size
  }
}

export function createMemoryLoaderModules(): MemoryLoaderModules {
  return new MemoryLoaderModules()
}

export default MemoryLoaderModules