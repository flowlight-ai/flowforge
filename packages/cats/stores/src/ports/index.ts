/**
 * Ports barrel — pure TypeScript interfaces for all cats-domain stores.
 *
 * Backend implementations (Memory, Sqlite) implement these interfaces and
 * register themselves with the {@link CatStores} Cordis service via a backend
 * plugin. Consumers resolve a store through `ctx.catStores.messages()` etc.
 *
 * @module @flowforge/cats-stores/ports
 */

export type {
  AppendMessageInput,
  IMessageStore,
  MarkCanceledResult,
  MarkDeliveredResult,
  MessageAppendListener,
  StoredMessage,
  StoredToolEvent,
} from './message-store.ts'

export type {
  CreateThreadInput,
  IThreadStore,
  StoredThread,
  UpdateThreadPatch,
} from './thread-store.ts'

export type {
  CreateTaskInput,
  ITaskStore,
  StoredTask,
  UpdateTaskPatch,
} from './task-store.ts'

export type {
  BacklogAuditEntry,
  BacklogClaimSuggestion,
  BacklogItem,
  BacklogLease,
  BacklogPriority,
  BacklogStatus,
  CreateBacklogInput,
  IBacklogStore,
  UpdateBacklogPatch,
} from './backlog-store.ts'

export type {
  CreateMemoryInput,
  IMemoryStore,
  StoredMemory,
  UpdateMemoryPatch,
} from './memory-store.ts'

// ============================================================================
// Invocation-related ports (batch 3.2) — full branded contracts.
// Branded primitive types (InvocationId / ThreadId / UserId / CatId /
// ManagedWorkBinding) are imported by consumers directly from
// `@flowforge/cats-shared`; each port only exports its own contract types.
// ============================================================================

export type {
  IInvocationRecordStore,
  StoreCreateInvocationOutcome,
  StoreUpdateInvocationInput,
  StoreUpdateInvocationOutcome,
} from './invocation-record-store.ts'

export type {
  ITaskProgressStore,
  SetSnapshotOptions,
  TaskProgressItem,
  TaskProgressSnapshot,
  TaskProgressStatus,
} from './task-progress-store.ts'

export type {
  ITaskManagedWorkRegistrationStore,
  ManagedWorkBindingConflict,
  UpsertManagedWorkBindingOutcome,
} from './task-managed-work-registration-store.ts'

export type {
  IAuthorizationAuditStore,
  IAuthorizationRuleStore,
  ICommunityIssueDraftStore,
  ICommunityIssueStore,
  ICommunityPrStore,
  IDeliveryCursorStore,
  IDossierDistillationProposalStore,
  IDossierObservationStore,
  IDraftStore,
  IFrustrationIssueStore,
  IGameStore,
  ILabelStore,
  IMemoryGovernanceStore,
  IPendingRequestStore,
  IProfileUpdateProposalStore,
  IProposalStore,
  IPushSubscriptionStore,
  IReadStateStore,
  ISessionChainStore,
  ISessionHandoffProposalStore,
  ISummaryStore,
  ITurnExecutionStore,
  IWorkflowSopStore,
} from './stub-ports.ts'
