/**
 * MemoryTaskManagedWorkRegistrationStore port contract — verifies
 * ITaskManagedWorkRegistrationStore semantics:
 * - upsert (idempotent + conflict detection)
 * - bind (force replace)
 * - get
 * - getByWorkAttempt (reverse lookup)
 * - delete (idempotent)
 *
 * @module @flowforge/cats-stores/tests
 */

import { describe, expect, it } from 'vitest'
import { MemoryTaskManagedWorkRegistrationStore } from '../src/memory/task-managed-work-registration-store.ts'
import type { ManagedWorkBinding } from '@flowforge/cats-shared'

const TASK_1 = 'task_1'
const TASK_2 = 'task_2'
const WORK_A = 'work_a'
const WORK_B = 'work_b'
const ATTEMPT_1 = 'attempt_1'
const ATTEMPT_2 = 'attempt_2'

function binding(workId: string, attemptId: string): ManagedWorkBinding {
  return { workId, attemptId } as ManagedWorkBinding
}

describe('MemoryTaskManagedWorkRegistrationStore — upsert', () => {
  it('binds a fresh task', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    const out = store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    expect(out.outcome).toBe('bound')
    if (out.outcome !== 'bound') throw new Error('unreachable')
    expect(out.taskId).toBe(TASK_1)
    expect(out.binding.workId).toBe(WORK_A)
  })

  it('is idempotent when the same binding is upserted again', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    const out = store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    expect(out.outcome).toBe('bound')
  })

  it('returns conflict when a different binding is upserted on the same task', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    const out = store.upsert(TASK_1, binding(WORK_B, ATTEMPT_2))
    expect(out.outcome).toBe('conflict')
    if (out.outcome !== 'conflict') throw new Error('unreachable')
    expect(out.conflict.taskId).toBe(TASK_1)
    expect(out.conflict.existing.workId).toBe(WORK_A)
    expect(out.conflict.incoming.workId).toBe(WORK_B)
  })

  it('conflicts on attempt mismatch alone', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    const out = store.upsert(TASK_1, binding(WORK_A, ATTEMPT_2))
    expect(out.outcome).toBe('conflict')
  })
})

describe('MemoryTaskManagedWorkRegistrationStore — bind (force replace)', () => {
  it('overwrites the existing binding and refreshes the reverse index', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    store.bind(TASK_1, binding(WORK_B, ATTEMPT_2))
    const got = store.get(TASK_1)
    expect(got?.workId).toBe(WORK_B)
    expect(got?.attemptId).toBe(ATTEMPT_2)

    // Old reverse index entry must be gone
    expect(store.getByWorkAttempt(WORK_A, ATTEMPT_1)).toBeNull()
    // New reverse index entry must be present
    expect(store.getByWorkAttempt(WORK_B, ATTEMPT_2)).toBe(TASK_1)
  })
})

describe('MemoryTaskManagedWorkRegistrationStore — get / getByWorkAttempt', () => {
  it('get returns null for unbound task', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    expect(store.get(TASK_1)).toBeNull()
  })

  it('getByWorkAttempt reverse-looks up by (workId, attemptId)', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    store.upsert(TASK_2, binding(WORK_B, ATTEMPT_2))
    expect(store.getByWorkAttempt(WORK_A, ATTEMPT_1)).toBe(TASK_1)
    expect(store.getByWorkAttempt(WORK_B, ATTEMPT_2)).toBe(TASK_2)
    expect(store.getByWorkAttempt(WORK_A, ATTEMPT_2)).toBeNull()
  })
})

describe('MemoryTaskManagedWorkRegistrationStore — delete', () => {
  it('removes the binding and returns true', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    store.upsert(TASK_1, binding(WORK_A, ATTEMPT_1))
    expect(store.delete(TASK_1)).toBe(true)
    expect(store.get(TASK_1)).toBeNull()
    expect(store.getByWorkAttempt(WORK_A, ATTEMPT_1)).toBeNull()
  })

  it('returns false when there is no binding to delete', () => {
    const store = new MemoryTaskManagedWorkRegistrationStore()
    expect(store.delete(TASK_1)).toBe(false)
  })
})
