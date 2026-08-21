/**
 * MemoryMemoryGovernanceStore — in-memory implementation of
 * {@link IMemoryGovernanceStore}.
 *
 * Ported from clowder-ai `MemoryGovernanceStore.ts` (api/src/domains/cats/
 * services/stores/ports/): Map 实现，状态迁移走 `resolveTransition` 纯函数，
 * 冲突抛 `GovernanceConflictError`。
 *
 * @module @flowforge/cats-stores/memory
 */

import {
  GovernanceConflictError,
  resolveTransition,
  type GovernanceEntry,
  type IMemoryGovernanceStore,
  type PublishAction,
} from '../ports/memory-governance-store.ts'

/**
 * In-memory governance store. Not durable across processes — use the Sqlite
 * backend (`@flowforge/cats-stores-sqlite`) for persistence.
 */
export class MemoryMemoryGovernanceStore implements IMemoryGovernanceStore {
  private readonly entries = new Map<string, GovernanceEntry>()

  create(entryId: string, actor: string, anchors?: string[]): GovernanceEntry {
    const existing = this.entries.get(entryId)
    if (existing) {
      throw new GovernanceConflictError(`Entry ${entryId} already exists`, existing.status, 'submit_review')
    }

    const entry: GovernanceEntry = {
      entryId,
      status: 'draft',
      updatedBy: actor,
      updatedAt: Date.now(),
      ...(anchors ? { anchors } : {}),
    }

    this.entries.set(entryId, entry)
    return entry
  }

  transition(entryId: string, action: PublishAction, actor: string): GovernanceEntry {
    const existing = this.entries.get(entryId)
    if (!existing) {
      throw new GovernanceConflictError(`Entry ${entryId} not found`, 'draft', action)
    }

    const nextStatus = resolveTransition(existing.status, action)

    const updated: GovernanceEntry = {
      ...existing,
      status: nextStatus,
      updatedBy: actor,
      updatedAt: Date.now(),
    }

    this.entries.set(entryId, updated)
    return updated
  }

  get(entryId: string): GovernanceEntry | null {
    return this.entries.get(entryId) ?? null
  }

  list(): GovernanceEntry[] {
    return [...this.entries.values()]
  }
}
