/**
 * MemoryStoresBackend — Cordis plugin that mounts all Memory store implementations
 * and registers them with the {@link CatStores} aggregate.
 *
 * Following the dsh pattern (cf. `@flowforge/session-persistence-sqlite`):
 * - Backend plugins declare `static inject = ['catStores']` so Cordis
 *   schedules the backend after the aggregate is available.
 * - Backend mounts its store instances via `ctx.effect()` so they are
 *   torn down with the backend's fiber, not the aggregate's.
 * - Backend exposes a name (`memory`) used by the aggregate to route
 *   consumer requests through the registered backend.
 *
 * @module @flowforge/cats-stores/memory
 */

import { Context, Service } from '@flowforge/cordis'
import type {
  IBacklogStore,
  IMemoryStore,
  IMessageStore,
  ITaskStore,
  IThreadStore,
} from '../ports/index.ts'
import { MemoryBacklogStore } from './backlog-store.ts'
import { MemoryMemoryStore } from './memory-store.ts'
import { MemoryMessageStore } from './message-store.ts'
import { MemoryTaskStore } from './task-store.ts'
import { MemoryThreadStore } from './thread-store.ts'

/** Backend name registered with the CatStores aggregate. */
export const MEMORY_BACKEND_NAME = 'memory'

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Memory backend service for cats-stores. Mounted by the
     * `@flowforge/cats-stores` default plugin (or explicitly via
     * `ctx.plugin(MemoryStoresBackend)`). Provides direct access to the
     * in-memory store instances for tests / inspection.
     */
    catStoresMemory: MemoryStoresBackend
  }
}

/**
 * Memory backend plugin. Mounts all in-memory store implementations and
 * registers them with {@link CatStores}.
 *
 * Mount in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'
 * - name: '@flowforge/cats-stores/memory'  # or auto-mounted by default plugin
 * ```
 */
export class MemoryStoresBackend extends Service {
  static inject = ['catStores']

  override readonly name = MEMORY_BACKEND_NAME

  readonly messageStore: MemoryMessageStore
  readonly threadStore: MemoryThreadStore
  readonly taskStore: MemoryTaskStore
  readonly backlogStore: MemoryBacklogStore
  readonly memoryStore: MemoryMemoryStore

  constructor(ctx: Context) {
    super(ctx, 'catStoresMemory')
    this.messageStore = new MemoryMessageStore()
    this.threadStore = new MemoryThreadStore()
    this.taskStore = new MemoryTaskStore()
    this.backlogStore = new MemoryBacklogStore()
    this.memoryStore = new MemoryMemoryStore()

    ctx.effect(() => {
      ctx.catStores.registerBackend(MEMORY_BACKEND_NAME, {
        messageStore: this.messageStore,
        threadStore: this.threadStore,
        taskStore: this.taskStore,
        backlogStore: this.backlogStore,
        memoryStore: this.memoryStore,
      })
      return () => {
        ctx.catStores.unregisterBackend(MEMORY_BACKEND_NAME)
      }
    }, 'catStoresMemory.register')
  }

  /** Expose the underlying message store (for tests / direct inspection). */
  get messages(): MemoryMessageStore {
    return this.messageStore
  }

  /** Expose the underlying thread store (for tests / direct inspection). */
  get threads(): MemoryThreadStore {
    return this.threadStore
  }

  /** Expose the underlying task store (for tests / direct inspection). */
  get tasks(): MemoryTaskStore {
    return this.taskStore
  }

  /** Expose the underlying backlog store (for tests / direct inspection). */
  get backlogs(): MemoryBacklogStore {
    return this.backlogStore
  }

  /** Expose the underlying long-term memory store (for tests / direct inspection). */
  get longTermMemory(): MemoryMemoryStore {
    return this.memoryStore
  }
}

/** Type helpers for backend accessors. */
export type {
  IBacklogStore,
  IMemoryStore,
  IMessageStore,
  ITaskStore,
  IThreadStore,
}
