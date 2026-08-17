/**
 * IBacklogStore — Forgekin backlog store port.
 *
 * Ported from clowder-ai `BacklogStore.ts` (api/src/domains/cats/services/stores/ports/),
 * reduced to the essential contract for batch 2.
 *
 * @module @flowforge/cats-stores/ports
 */

import type {
  BacklogAuditEntry,
  BacklogClaimSuggestion,
  BacklogItem,
  BacklogLease,
  BacklogPriority,
  BacklogStatus,
  CatId,
} from '@flowforge/cats-shared'

/**
 * Re-export core Backlog domain types so consumers of `@flowforge/cats-stores/ports`
 * get a single, stable import surface (port + domain types together).
 *
 * Backends (Memory, Sqlite) import these from cats-shared directly; consumers
 * that only need the port contract should import from `@flowforge/cats-stores/ports`.
 */
export type {
  BacklogAuditEntry,
  BacklogClaimSuggestion,
  BacklogItem,
  BacklogLease,
  BacklogPriority,
  BacklogStatus,
  CatId,
} from '@flowforge/cats-shared'

/** Input for creating a backlog item. */
export type CreateBacklogInput = Omit<
  BacklogItem,
  'id' | 'createdAt' | 'updatedAt' | 'audit'
> & {
  readonly id?: string
}

/** Update patch. */
export interface UpdateBacklogPatch {
  readonly title?: string
  readonly description?: string
  readonly priority?: BacklogPriority
  readonly status?: BacklogStatus
  readonly labels?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

/** Common interface for backlog stores. */
export interface IBacklogStore {
  create(input: CreateBacklogInput): BacklogItem | Promise<BacklogItem>
  getById(id: string): BacklogItem | null | Promise<BacklogItem | null>
  listForThread(threadId: string, options?: {
    readonly status?: BacklogStatus
    readonly priority?: BacklogPriority
  }): BacklogItem[] | Promise<BacklogItem[]>
  listForCat(catId: CatId, options?: {
    readonly status?: BacklogStatus
  }): BacklogItem[] | Promise<BacklogItem[]>
  update(id: string, patch: UpdateBacklogPatch): BacklogItem | null | Promise<BacklogItem | null>
  delete(id: string): boolean | Promise<boolean>
  /** Append an audit entry to a backlog item's audit log. */
  appendAudit(id: string, entry: BacklogAuditEntry): BacklogItem | null | Promise<BacklogItem | null>
  /** Record a claim suggestion for a backlog item. */
  addClaimSuggestion(
    id: string,
    suggestion: BacklogClaimSuggestion,
  ): BacklogItem | null | Promise<BacklogItem | null>
  /** Acquire / refresh / release the lease on a backlog item. */
  setLease(id: string, lease: BacklogLease | null): BacklogItem | null | Promise<BacklogItem | null>
}
