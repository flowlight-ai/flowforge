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
  IDeliveryCursorStore,
  IDossierDistillationProposalStore,
  IDossierObservationStore,
  IMemoryGovernanceStore,
  IMemoryStore,
  IMessageStore,
  IInvocationRecordStore,
  IProfileUpdateProposalStore,
  IProposalStore,
  ISessionChainStore,
  ISignalArticleStore,
  ISummaryStore,
  ITaskManagedWorkRegistrationStore,
  ITaskProgressStore,
  ITaskStore,
  IThreadMemoryStore,
  IThreadReadStateStore,
  IThreadStore,
} from '../ports/index.ts'
import { MemoryBacklogStore } from './backlog-store.ts'
import { MemoryThreadReadStateStore } from './read-state-store.ts'
import { MemoryDeliveryCursorStore } from './delivery-cursor-store.ts'
import { MemoryDossierDistillationProposalStore } from './dossier-distillation-proposal-store.ts'
import { MemoryDossierObservationStore } from './dossier-observation-store.ts'
import { MemoryInvocationRecordStore } from './invocation-record-store.ts'
import { MemoryMemoryGovernanceStore } from './memory-governance-store.ts'
import { MemoryMemoryStore } from './memory-store.ts'
import { MemoryMessageStore } from './message-store.ts'
import { MemoryProfileUpdateProposalStore } from './profile-update-proposal-store.ts'
import { MemoryProposalStore } from './proposal-store.ts'
import { MemorySessionHandoffProposalStore } from './session-handoff-proposal-store.ts'
import { MemorySignalArticleStore } from './signal-article-store.ts'
import { MemoryVoteStore } from './vote-store.ts'
import { MemorySessionChainStore } from './session-chain-store.ts'
import { MemorySummaryStore } from './summary-store.ts'
import { MemoryTaskManagedWorkRegistrationStore } from './task-managed-work-registration-store.ts'
import { MemoryTaskProgressStore } from './task-progress-store.ts'
import { MemoryTaskStore } from './task-store.ts'
import { MemoryThreadMemoryStore } from './thread-memory-store.ts'
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
  /** Batch 3.2 — invocation-related stores. */
  readonly invocationRecordStore: MemoryInvocationRecordStore
  readonly taskProgressStore: MemoryTaskProgressStore
  readonly taskManagedWorkRegistrationStore: MemoryTaskManagedWorkRegistrationStore
  /** Batch 4.2 — profile-update proposal store. */
  readonly profileUpdateProposalStore: MemoryProfileUpdateProposalStore
  /** Batch 5.2 — orchestration stores (audit-adjacent persistence). */
  readonly summaryStore: MemorySummaryStore
  readonly dossierDistillationProposalStore: MemoryDossierDistillationProposalStore
  readonly dossierObservationStore: MemoryDossierObservationStore
  readonly deliveryCursorStore: MemoryDeliveryCursorStore
  /** Batch 6.2a — session chain store (F24 session lineage). */
  readonly sessionChainStore: MemorySessionChainStore
  /** Stage-5 batch 1 — thread read-state store (F069 unread cursor). */
  readonly threadReadStateStore: MemoryThreadReadStateStore
  /** Stage-5 batch 4 — F128 proposal store. */
  readonly proposalStore: MemoryProposalStore
  /** Stage-5 batch 4 — F079 vote store. */
  readonly voteStore: MemoryVoteStore
  /** Stage-5 batch 6 — F225 session-handoff proposal store. */
  readonly sessionHandoffProposalStore: MemorySessionHandoffProposalStore
  /** Stage-5 batch 7 — F3-lite thread KV memory store. */
  readonly threadMemoryStore: MemoryThreadMemoryStore
  /** Stage-5 batch 7 — memory publish governance state machine. */
  readonly memoryGovernanceStore: MemoryMemoryGovernanceStore
  /** Stage-5 batch 7 — signal-hunter article store. */
  readonly signalArticleStore: MemorySignalArticleStore

  constructor(ctx: Context) {
    super(ctx, 'catStoresMemory')
    this.messageStore = new MemoryMessageStore()
    this.threadStore = new MemoryThreadStore()
    this.taskStore = new MemoryTaskStore()
    this.backlogStore = new MemoryBacklogStore()
    this.memoryStore = new MemoryMemoryStore()
    this.invocationRecordStore = new MemoryInvocationRecordStore()
    this.taskProgressStore = new MemoryTaskProgressStore()
    this.taskManagedWorkRegistrationStore = new MemoryTaskManagedWorkRegistrationStore()
    this.profileUpdateProposalStore = new MemoryProfileUpdateProposalStore()
    this.summaryStore = new MemorySummaryStore()
    this.dossierDistillationProposalStore = new MemoryDossierDistillationProposalStore()
    this.dossierObservationStore = new MemoryDossierObservationStore()
    this.deliveryCursorStore = new MemoryDeliveryCursorStore()
    this.sessionChainStore = new MemorySessionChainStore()
    this.threadReadStateStore = new MemoryThreadReadStateStore()
    this.proposalStore = new MemoryProposalStore()
    this.voteStore = new MemoryVoteStore()
    this.sessionHandoffProposalStore = new MemorySessionHandoffProposalStore()
    this.threadMemoryStore = new MemoryThreadMemoryStore()
    this.memoryGovernanceStore = new MemoryMemoryGovernanceStore()
    this.signalArticleStore = new MemorySignalArticleStore()

    ctx.effect(() => {
      ctx.catStores.registerBackend(MEMORY_BACKEND_NAME, {
        messageStore: this.messageStore,
        threadStore: this.threadStore,
        taskStore: this.taskStore,
        backlogStore: this.backlogStore,
        memoryStore: this.memoryStore,
        invocationRecordStore: this.invocationRecordStore,
        taskProgressStore: this.taskProgressStore,
        taskManagedWorkRegistrationStore: this.taskManagedWorkRegistrationStore,
        profileUpdateProposalStore: this.profileUpdateProposalStore,
        summaryStore: this.summaryStore,
        dossierDistillationProposalStore: this.dossierDistillationProposalStore,
        dossierObservationStore: this.dossierObservationStore,
        deliveryCursorStore: this.deliveryCursorStore,
        sessionChainStore: this.sessionChainStore,
        threadReadStateStore: this.threadReadStateStore,
        proposalStore: this.proposalStore,
        voteStore: this.voteStore,
        sessionHandoffProposalStore: this.sessionHandoffProposalStore,
        threadMemoryStore: this.threadMemoryStore,
        memoryGovernanceStore: this.memoryGovernanceStore,
        signalArticleStore: this.signalArticleStore,
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

  /** Expose the underlying invocation record store (for tests / direct inspection). */
  get invocationRecords(): MemoryInvocationRecordStore {
    return this.invocationRecordStore
  }

  /** Expose the underlying task progress store (for tests / direct inspection). */
  get taskProgress(): MemoryTaskProgressStore {
    return this.taskProgressStore
  }

  /** Expose the underlying task managed-work registration store (for tests / direct inspection). */
  get taskManagedWorkRegistrations(): MemoryTaskManagedWorkRegistrationStore {
    return this.taskManagedWorkRegistrationStore
  }

  /** Expose the underlying profile-update proposal store (for tests / direct inspection). */
  get profileUpdateProposals(): MemoryProfileUpdateProposalStore {
    return this.profileUpdateProposalStore
  }

  /** Expose the underlying summary store (for tests / direct inspection). */
  get summaries(): MemorySummaryStore {
    return this.summaryStore
  }

  /** Expose the underlying dossier distillation proposal store (for tests / direct inspection). */
  get dossierDistillationProposals(): MemoryDossierDistillationProposalStore {
    return this.dossierDistillationProposalStore
  }

  /** Expose the underlying dossier observation store (for tests / direct inspection). */
  get dossierObservations(): MemoryDossierObservationStore {
    return this.dossierObservationStore
  }

  /** Expose the underlying delivery cursor store (for tests / direct inspection). */
  get deliveryCursors(): MemoryDeliveryCursorStore {
    return this.deliveryCursorStore
  }

  /** Expose the underlying session chain store (for tests / direct inspection). */
  get sessionChains(): MemorySessionChainStore {
    return this.sessionChainStore
  }

  /** Expose the underlying session-handoff proposal store (for tests / direct inspection). */
  get sessionHandoffs(): MemorySessionHandoffProposalStore {
    return this.sessionHandoffProposalStore
  }

  /** Expose the underlying thread KV memory store (for tests / direct inspection). */
  get threadMemories(): MemoryThreadMemoryStore {
    return this.threadMemoryStore
  }

  /** Expose the underlying memory governance store (for tests / direct inspection). */
  get memoryGovernance(): MemoryMemoryGovernanceStore {
    return this.memoryGovernanceStore
  }

  /** Expose the underlying signal article store (for tests / direct inspection). */
  get signalArticles(): MemorySignalArticleStore {
    return this.signalArticleStore
  }
}

/** Type helpers for backend accessors. */
export type {
  IBacklogStore,
  IDeliveryCursorStore,
  IDossierDistillationProposalStore,
  IDossierObservationStore,
  IMemoryGovernanceStore,
  IMemoryStore,
  IMessageStore,
  IInvocationRecordStore,
  IProfileUpdateProposalStore,
  IProposalStore,
  ISessionChainStore,
  ISignalArticleStore,
  ISummaryStore,
  ITaskManagedWorkRegistrationStore,
  ITaskProgressStore,
  ITaskStore,
  IThreadMemoryStore,
  IThreadReadStateStore,
  IThreadStore,
}
