/**
 * CatStores — Cordis service that aggregates all cats-domain store backends.
 *
 * Mounted at `ctx.catStores` by the `@flowforge/cats-stores` default plugin.
 * Backend plugins (Memory, Sqlite) declare `static inject = ['catStores']`
 * and register themselves via `ctx.catStores.registerBackend(name, backend)`.
 *
 * Consumers resolve the active backend through:
 *   - `ctx.catStores.messages()` — the IMessageStore for the active backend
 *   - `ctx.catStores.threads()` — the IThreadStore
 *   - `ctx.catStores.tasks()` — the ITaskStore
 *   - `ctx.catStores.backlogs()` — the IBacklogStore
 *   - `ctx.catStores.memory()` — the IMemoryStore (long-term memory)
 *   - `ctx.catStores.backend(name)` — direct lookup by backend name
 *
 * The active backend is the most-recently-registered backend; tests can
 * pin to a specific backend with `ctx.catStores.activate(name)`.
 *
 * @module @flowforge/cats-stores
 */

import { Context, Service } from '@flowforge/cordis'
import type {
  IBacklogStore,
  IInvocationRecordStore,
  IMemoryStore,
  IMessageStore,
  ITaskManagedWorkRegistrationStore,
  ITaskProgressStore,
  ITaskStore,
  IThreadStore,
} from './ports/index.ts'

/** A registered backend's store instances. */
export interface CatStoresBackend {
  readonly messageStore: IMessageStore
  readonly threadStore: IThreadStore
  readonly taskStore: ITaskStore
  readonly backlogStore: IBacklogStore
  readonly memoryStore: IMemoryStore
  /**
   * Invocation-related ports (batch 3.2). Backends registered before batch 3.2
   * (e.g. an old Sqlite backend) may omit these; consumers should fall back
   * via `backend.invocationRecordStore ?? null`.
   */
  readonly invocationRecordStore?: IInvocationRecordStore
  readonly taskProgressStore?: ITaskProgressStore
  readonly taskManagedWorkRegistrationStore?: ITaskManagedWorkRegistrationStore
  /** Additional ports may be added incrementally — backend plugins opt-in. */
  readonly [key: string]: unknown
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Forgekin (cats) store aggregate — mounted by `@flowforge/cats-stores`. */
    catStores: CatStores
  }
}

/**
 * Aggregate Cordis service for cats-domain stores. Mounts at `ctx.catStores`.
 */
export class CatStores extends Service {
  private backends = new Map<string, CatStoresBackend>()
  private activeName: string | undefined

  constructor(ctx: Context) {
    super(ctx, 'catStores')
  }

  /**
   * Register a backend under `name`. The most-recently-registered backend
   * becomes the active one. Effect-scoped: when the calling fiber disposes,
   * the backend is automatically unregistered (handled by the backend plugin).
   */
  registerBackend(name: string, backend: CatStoresBackend): void {
    if (this.backends.has(name)) {
      throw new Error(`cats-stores backend "${name}" is already registered`)
    }
    this.backends.set(name, backend)
    this.activeName = name
  }

  /** Unregister a backend by name. Active backend falls back to the most-recent. */
  unregisterBackend(name: string): void {
    if (!this.backends.delete(name)) return
    if (this.activeName === name) {
      this.activeName = Array.from(this.backends.keys()).at(-1)
    }
  }

  /** Pin a specific backend as active. */
  activate(name: string): void {
    if (!this.backends.has(name)) {
      throw new Error(`cats-stores backend "${name}" is not registered`)
    }
    this.activeName = name
  }

  /** Get a backend by name, or undefined if not registered. */
  backend(name: string): CatStoresBackend | undefined {
    return this.backends.get(name)
  }

  /** Get the active backend. Throws if no backend is registered. */
  active(): CatStoresBackend {
    if (this.activeName === undefined || !this.backends.has(this.activeName)) {
      throw new Error('No cats-stores backend registered; did you load @flowforge/cats-stores/memory?')
    }
    return this.backends.get(this.activeName)!
  }

  /** Resolve the active IMessageStore. */
  messages(): IMessageStore {
    return this.active().messageStore
  }

  /** Resolve the active IThreadStore. */
  threads(): IThreadStore {
    return this.active().threadStore
  }

  /** Resolve the active ITaskStore. */
  tasks(): ITaskStore {
    return this.active().taskStore
  }

  /** Resolve the active IBacklogStore. */
  backlogs(): IBacklogStore {
    return this.active().backlogStore
  }

  /** Resolve the active IMemoryStore (long-term memory). */
  memory(): IMemoryStore {
    return this.active().memoryStore
  }

  /**
   * Resolve the active IInvocationRecordStore. Throws if the active backend
   * did not register one (only backends from batch 3.2+ do). Tests / callers
   * that need to detect optional support should use `active().invocationRecordStore`.
   */
  invocationRecords(): IInvocationRecordStore {
    const store = this.active().invocationRecordStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IInvocationRecordStore; ' +
          'load @flowforge/cats-stores/memory (batch 3.2) or a backend that supports invocation records.',
      )
    }
    return store
  }

  /**
   * Resolve the active ITaskProgressStore. Throws if the active backend
   * did not register one (only backends from batch 3.2+ do).
   */
  taskProgress(): ITaskProgressStore {
    const store = this.active().taskProgressStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an ITaskProgressStore; ' +
          'load @flowforge/cats-stores/memory (batch 3.2) or a backend that supports task progress.',
      )
    }
    return store
  }

  /**
   * Resolve the active ITaskManagedWorkRegistrationStore. Throws if the
   * active backend did not register one (only backends from batch 3.2+ do).
   */
  taskManagedWorkRegistrations(): ITaskManagedWorkRegistrationStore {
    const store = this.active().taskManagedWorkRegistrationStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an ITaskManagedWorkRegistrationStore; ' +
          'load @flowforge/cats-stores/memory (batch 3.2) or a backend that supports managed-work bindings.',
      )
    }
    return store
  }

  /** List all registered backend names. */
  backendNames(): readonly string[] {
    return Array.from(this.backends.keys())
  }

  /** Active backend name (or undefined if none registered). */
  activeBackendName(): string | undefined {
    return this.activeName
  }
}
