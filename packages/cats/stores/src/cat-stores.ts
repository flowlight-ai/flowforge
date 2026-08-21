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
  IDeliveryCursorStore,
  IDossierDistillationProposalStore,
  IDossierObservationStore,
  IInvocationRecordStore,
  IMemoryGovernanceStore,
  IMemoryStore,
  IMessageStore,
  IProfileUpdateProposalStore,
  IProposalStore,
  ISessionChainStore,
  ISessionHandoffProposalStore,
  ISignalArticleStore,
  ISummaryStore,
  ITaskManagedWorkRegistrationStore,
  ITaskProgressStore,
  ITaskStore,
  IThreadMemoryStore,
  IThreadReadStateStore,
  IThreadStore,
  IVoteStore,
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
  /** Profile-update proposal store (batch 4.2). */
  readonly profileUpdateProposalStore?: IProfileUpdateProposalStore
  /** Orchestration-related ports (batch 5.2). */
  readonly summaryStore?: ISummaryStore
  readonly dossierDistillationProposalStore?: IDossierDistillationProposalStore
  readonly dossierObservationStore?: IDossierObservationStore
  readonly deliveryCursorStore?: IDeliveryCursorStore
  /** Session chain store (batch 6.2a — F24 session lineage per cat × thread). */
  readonly sessionChainStore?: ISessionChainStore
  /** Thread read-state store (stage-5 batch 1 — F069 unread cursor). */
  readonly threadReadStateStore?: IThreadReadStateStore
  /** F128 cross-thread proposal store (stage-5 batch 4). */
  readonly proposalStore?: IProposalStore
  /** F079 per-thread vote state store (stage-5 batch 4). */
  readonly voteStore?: IVoteStore
  /** F225 session-handoff proposal store (stage-5 batch 6). */
  readonly sessionHandoffProposalStore?: ISessionHandoffProposalStore
  /** F3-lite thread KV memory store (stage-5 batch 7). */
  readonly threadMemoryStore?: IThreadMemoryStore
  /** Memory publish governance state machine (stage-5 batch 7). */
  readonly memoryGovernanceStore?: IMemoryGovernanceStore
  /** Signal-hunter article store (stage-5 batch 7). */
  readonly signalArticleStore?: ISignalArticleStore
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

  /**
   * Resolve the active IProfileUpdateProposalStore. Throws if the active
   * backend did not register one (only backends from batch 4.2+ do).
   */
  profileUpdateProposals(): IProfileUpdateProposalStore {
    const store = this.active().profileUpdateProposalStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IProfileUpdateProposalStore; ' +
          'load @flowforge/cats-stores/memory (batch 4.2) or a backend that supports profile-update proposals.',
      )
    }
    return store
  }

  /**
   * Resolve the active ISummaryStore. Throws if the active backend did not
   * register one (only backends from batch 5.2+ do).
   */
  summaries(): ISummaryStore {
    const store = this.active().summaryStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an ISummaryStore; ' +
          'load @flowforge/cats-stores/memory (batch 5.2) or a backend that supports thread summaries.',
      )
    }
    return store
  }

  /**
   * Resolve the active IDossierDistillationProposalStore. Throws if the
   * active backend did not register one (only backends from batch 5.2+ do).
   */
  dossierDistillationProposals(): IDossierDistillationProposalStore {
    const store = this.active().dossierDistillationProposalStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IDossierDistillationProposalStore; ' +
          'load @flowforge/cats-stores/memory (batch 5.2) or a backend that supports dossier distillation.',
      )
    }
    return store
  }

  /**
   * Resolve the active IDossierObservationStore. Throws if the active
   * backend did not register one (only backends from batch 5.2+ do).
   */
  dossierObservations(): IDossierObservationStore {
    const store = this.active().dossierObservationStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IDossierObservationStore; ' +
          'load @flowforge/cats-stores/memory (batch 5.2) or a backend that supports dossier observations.',
      )
    }
    return store
  }

  /**
   * Resolve the active IDeliveryCursorStore. Throws if the active backend
   * did not register one (only backends from batch 5.2+ do).
   */
  deliveryCursors(): IDeliveryCursorStore {
    const store = this.active().deliveryCursorStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IDeliveryCursorStore; ' +
          'load @flowforge/cats-stores/memory (batch 5.2) or a backend that supports delivery cursors.',
      )
    }
    return store
  }

  /**
   * Resolve the active ISessionChainStore. Throws if the active backend
   * did not register one (only backends from batch 6.2a+ do).
   */
  sessionChains(): ISessionChainStore {
    const store = this.active().sessionChainStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an ISessionChainStore; ' +
          'load @flowforge/cats-stores/memory (batch 6.2a) or a backend that supports session chains.',
      )
    }
    return store
  }

  /**
   * Resolve the active IThreadReadStateStore. Throws if the active backend
   * did not register one (only backends from stage-5 batch 1+ do).
   */
  readStates(): IThreadReadStateStore {
    const store = this.active().threadReadStateStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IThreadReadStateStore; ' +
          'load @flowforge/cats-stores/memory (stage-5 batch 1) or a backend that supports read states.',
      )
    }
    return store
  }


  /**
   * Resolve the active IProposalStore (F128). Throws if the active backend
   * did not register one (only backends from stage-5 batch 4+ do).
   */
  proposals(): IProposalStore {
    const store = this.active().proposalStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IProposalStore; ' +
          'load @flowforge/cats-stores/memory (stage-5 batch 4) or a backend that supports proposals.',
      )
    }
    return store
  }

  /**
   * Resolve the active IVoteStore (F079). Throws if the active backend
   * did not register one (only backends from stage-5 batch 4+ do).
   */
  votes(): IVoteStore {
    const store = this.active().voteStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IVoteStore; ' +
          'load @flowforge/cats-stores/memory (stage-5 batch 4) or a backend that supports votes.',
      )
    }
    return store
  }

  /**
   * Resolve the active ISessionHandoffProposalStore (F225). Throws if the
   * active backend did not register one (only backends from stage-5 batch 6+ do).
   */
  sessionHandoffProposals(): ISessionHandoffProposalStore {
    const store = this.active().sessionHandoffProposalStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an ISessionHandoffProposalStore; ' +
          'load @flowforge/cats-stores/memory (stage-5 batch 6) or a backend that supports session handoffs.',
      )
    }
    return store
  }

  /**
   * Resolve the active IThreadMemoryStore (F3-lite). Throws if the active
   * backend did not register one (only backends from stage-5 batch 7+ do).
   */
  threadMemories(): IThreadMemoryStore {
    const store = this.active().threadMemoryStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IThreadMemoryStore; ' +
          'load @flowforge/cats-stores/memory (stage-5 batch 7) or a backend that supports thread memories.',
      )
    }
    return store
  }

  /**
   * Resolve the active IMemoryGovernanceStore. Throws if the active backend
   * did not register one (only backends from stage-5 batch 7+ do).
   */
  memoryGovernance(): IMemoryGovernanceStore {
    const store = this.active().memoryGovernanceStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an IMemoryGovernanceStore; ' +
          'load @flowforge/cats-stores/memory (stage-5 batch 7) or a backend that supports memory governance.',
      )
    }
    return store
  }

  /**
   * Resolve the active ISignalArticleStore. Throws if the active backend
   * did not register one (only backends from stage-5 batch 7+ do).
   */
  signalArticles(): ISignalArticleStore {
    const store = this.active().signalArticleStore
    if (!store) {
      throw new Error(
        'Active cats-stores backend did not register an ISignalArticleStore; ' +
          'load @flowforge/cats-stores/memory (stage-5 batch 7) or a backend that supports signal articles.',
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


