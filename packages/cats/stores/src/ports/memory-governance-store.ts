/**
 * IMemoryGovernanceStore — memory publish governance state machine port.
 *
 * Promoted from stub-ports.ts in stage-5 batch 7 (T5.7.2): the clowder-ai
 * `MemoryGovernanceStore.ts` contract (api/src/domains/cats/services/stores/
 * ports/) — 记忆发布门禁状态机 draft → pending_review → published → archived。
 * 旧的 stub 接口（audit 语义 `record/listForCat`）被完整状态机契约取代。
 *
 * 状态迁移是纯函数可测；冲突以 `GovernanceConflictError`（409 语义）抛出。
 *
 * @module @flowforge/cats-stores/ports
 */

export type GovernanceStatus = 'draft' | 'pending_review' | 'published' | 'archived'
export type PublishAction = 'submit_review' | 'approve' | 'archive' | 'rollback'

export interface GovernanceEntry {
  readonly entryId: string
  readonly status: GovernanceStatus
  readonly updatedBy: string
  readonly updatedAt: number
  readonly anchors?: string[]
}

/** Common interface for memory governance stores. */
export interface IMemoryGovernanceStore {
  create(entryId: string, actor: string, anchors?: string[]): GovernanceEntry | Promise<GovernanceEntry>
  transition(entryId: string, action: PublishAction, actor: string): GovernanceEntry | Promise<GovernanceEntry>
  get(entryId: string): GovernanceEntry | null | Promise<GovernanceEntry | null>
  list(): GovernanceEntry[] | Promise<GovernanceEntry[]>
}

/** Valid state transitions: [fromStatus, action] → toStatus. */
const TRANSITIONS: Record<string, GovernanceStatus | undefined> = {
  'draft:submit_review': 'pending_review',
  'pending_review:approve': 'published',
  'published:archive': 'archived',
  'published:rollback': 'draft',
}

/**
 * Resolve the next status for a given transition.
 * Throws a descriptive error (409-style) if the transition is invalid.
 */
export function resolveTransition(currentStatus: GovernanceStatus, action: PublishAction): GovernanceStatus {
  const key = `${currentStatus}:${action}`
  const next = TRANSITIONS[key]
  if (!next) {
    throw new GovernanceConflictError(`Invalid transition: cannot ${action} from ${currentStatus}`, currentStatus, action)
  }
  return next
}

/** Conflict error carrying the rejected transition for 409 responses. */
export class GovernanceConflictError extends Error {
  readonly currentStatus: GovernanceStatus
  readonly action: PublishAction

  constructor(message: string, currentStatus: GovernanceStatus, action: PublishAction) {
    super(message)
    this.name = 'GovernanceConflictError'
    this.currentStatus = currentStatus
    this.action = action
  }
}
