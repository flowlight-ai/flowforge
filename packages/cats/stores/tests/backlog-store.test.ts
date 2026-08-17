/**
 * MemoryBacklogStore port contract — verifies in-memory IBacklogStore
 * semantics: create / list by thread / list by cat (lease) / audit /
 * suggestion / lease acquire+release / update / delete.
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import { MemoryBacklogStore } from '../src/memory/backlog-store.ts'
import type { BacklogAuditEntry, BacklogClaimSuggestion, BacklogLease, CreateBacklogInput } from '../src/ports/backlog-store.ts'

const CAT_OPUS = createCatId('opus')
const CAT_CODEX = createCatId('codex')
const USER_ALICE = createUserId('alice')

function backlogInput(overrides: Partial<CreateBacklogInput> = {}): CreateBacklogInput {
  return {
    userId: USER_ALICE,
    title: 'do something',
    summary: 'summary',
    priority: 'p1',
    tags: ['bug'],
    status: 'open',
    createdBy: 'user',
    ...overrides,
  } as CreateBacklogInput
}

function sampleLease(ownerCatId = CAT_OPUS, ttlMs = 60_000): BacklogLease {
  const now = Date.now()
  return {
    ownerCatId,
    state: 'active',
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: now + ttlMs,
  }
}

function sampleSuggestion(catId = CAT_OPUS): BacklogClaimSuggestion {
  return {
    catId,
    why: 'I can help',
    plan: 'do it',
    requestedPhase: 'coding',
    status: 'pending',
    suggestedAt: Date.now(),
  }
}

function sampleAudit(action: BacklogAuditEntry['action'] = 'created'): BacklogAuditEntry {
  return {
    id: 'audit-1',
    action,
    actor: { kind: 'cat', id: CAT_OPUS },
    timestamp: Date.now(),
  }
}

describe('MemoryBacklogStore — create + get', () => {
  it('assigns id + timestamps + empty audit', () => {
    const store = new MemoryBacklogStore()
    const item = store.create(backlogInput())
    expect(item.id).toMatch(/^backlog_/)
    expect(item.audit).toEqual([])
    expect(item.createdAt).toBe(item.updatedAt)
  })

  it('rejects duplicate ids', () => {
    const store = new MemoryBacklogStore()
    store.create(backlogInput({ id: 'dup' }))
    expect(() => store.create(backlogInput({ id: 'dup' }))).toThrow(/already exists/)
  })

  it('getById returns null for unknown ids', () => {
    const store = new MemoryBacklogStore()
    expect(store.getById('nope')).toBeNull()
  })
})

describe('MemoryBacklogStore — listForThread', () => {
  it('filters by dispatchedThreadId + status + priority', () => {
    const store = new MemoryBacklogStore()
    store.create(backlogInput({ id: 'b1', dispatchedThreadId: 't1', status: 'open', priority: 'p1' }))
    store.create(backlogInput({ id: 'b2', dispatchedThreadId: 't1', status: 'done', priority: 'p1' }))
    store.create(backlogInput({ id: 'b3', dispatchedThreadId: 't2' }))

    expect(store.listForThread('t1').map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(store.listForThread('t1', { status: 'done' }).map((b) => b.id)).toEqual(['b2'])
    expect(store.listForThread('t1', { priority: 'p0' })).toHaveLength(0)
  })
})

describe('MemoryBacklogStore — listForCat (lease-based ownership)', () => {
  it('returns items whose lease.ownerCatId matches', () => {
    const store = new MemoryBacklogStore()
    store.create(backlogInput({ id: 'b1', lease: sampleLease(CAT_OPUS) }))
    store.create(backlogInput({ id: 'b2', lease: sampleLease(CAT_CODEX) }))
    store.create(backlogInput({ id: 'b3' }))

    expect(store.listForCat(CAT_OPUS).map((b) => b.id)).toEqual(['b1'])
    expect(store.listForCat(CAT_CODEX).map((b) => b.id)).toEqual(['b2'])
    expect(store.listForCat(createCatId('unseen'))).toHaveLength(0)
  })
})

describe('MemoryBacklogStore — appendAudit', () => {
  it('appends to audit log and bumps updatedAt', () => {
    const store = new MemoryBacklogStore()
    const item = store.create(backlogInput({ id: 'b1' }))
    const before = item.updatedAt
    const updated = store.appendAudit(item.id, sampleAudit('refreshed'))
    expect(updated?.audit).toHaveLength(1)
    expect(updated?.audit[0]?.action).toBe('refreshed')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('returns null for unknown id', () => {
    const store = new MemoryBacklogStore()
    expect(store.appendAudit('nope', sampleAudit())).toBeNull()
  })
})

describe('MemoryBacklogStore — addClaimSuggestion', () => {
  it('replaces the suggestion field (single pending suggestion)', () => {
    const store = new MemoryBacklogStore()
    const item = store.create(backlogInput({ id: 'b1' }))
    const first = store.addClaimSuggestion(item.id, sampleSuggestion(CAT_OPUS))
    expect(first?.suggestion?.catId).toBe(CAT_OPUS)
    const second = store.addClaimSuggestion(item.id, sampleSuggestion(CAT_CODEX))
    expect(second?.suggestion?.catId).toBe(CAT_CODEX)
    // Still only one suggestion (replaces, not appends).
    expect(second?.suggestion).toBeDefined()
  })
})

describe('MemoryBacklogStore — setLease', () => {
  it('acquiring sets lease; releasing clears it', () => {
    const store = new MemoryBacklogStore()
    const item = store.create(backlogInput({ id: 'b1' }))

    const acquired = store.setLease(item.id, sampleLease(CAT_OPUS))
    expect(acquired?.lease?.ownerCatId).toBe(CAT_OPUS)

    const released = store.setLease(item.id, null)
    expect(released?.lease).toBeUndefined()
  })

  it('returns null for unknown id', () => {
    const store = new MemoryBacklogStore()
    expect(store.setLease('nope', sampleLease())).toBeNull()
    expect(store.setLease('nope', null)).toBeNull()
  })
})

describe('MemoryBacklogStore — update + delete', () => {
  it('update applies patch and bumps updatedAt; preserves id/createdAt', () => {
    const store = new MemoryBacklogStore()
    const item = store.create(backlogInput({ id: 'fixed', title: 'orig' }))
    const updated = store.update(item.id, { title: 'renamed', status: 'done' })
    expect(updated?.title).toBe('renamed')
    expect(updated?.status).toBe('done')
    expect(updated?.id).toBe('fixed')
    expect(updated?.createdAt).toBe(item.createdAt)
  })

  it('delete returns true/false appropriately', () => {
    const store = new MemoryBacklogStore()
    store.create(backlogInput({ id: 'gone' }))
    expect(store.delete('gone')).toBe(true)
    expect(store.delete('gone')).toBe(false)
  })
})
