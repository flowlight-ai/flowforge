/**
 * 会议入站服务契约：confirm/dismiss/markRepair/clearRepair 状态机（CAS）。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MemoryMeetingIntakeStore } from '../src/MeetingIntakeStore.ts'
import { MeetingIntakeService } from '../src/MeetingIntakeService.ts'
import { MemoryDestinationAuthority } from '../src/DestinationAuthority.ts'
import { ThreadDestinationAuthority } from '../src/ThreadDestinationAuthority.ts'
import { MemoryMeetingThreadStore } from '../src/ThreadDestinationAuthority.ts'
import { MeetingIntakeError } from '../src/errors.ts'
import { makeIntake } from './fixtures.ts'

const DEST = 'host:private-thread:thread-abc'

function setup(now = 5_000) {
  const store = new MemoryMeetingIntakeStore()
  const threads = new MemoryMeetingThreadStore()
  threads.put({ id: 'thread-abc', createdBy: 'owner-1', preferredCats: ['cat-a'], participants: ['cat-a'] })
  const destinations = new ThreadDestinationAuthority(threads)
  const service = new MeetingIntakeService(store, destinations, { now: () => now })
  return { store, service, destinations }
}

async function admitted(store: MemoryMeetingIntakeStore, overrides = {}, slot = 1) {
  const intake = makeIntake({ intakeId: `intake-${slot}`, judgmentState: 'unresolved', executionState: 'idle', choices: {}, ...overrides })
  await store.accept({ settlementKey: `s${slot}`, sourceIdentityKey: `src${slot}`, intake })
  return intake
}

const FULL_CHOICES = {
  speakerMap: { spk1: 'Alice' },
  context: 'Design review',
  destinationHandle: DEST,
  outputs: ['minutes', 'tasks'],
}

describe('MeetingIntakeService.confirm', () => {
  it('confirms an unresolved intake and clears unresolved fields', async () => {
    const { store, service } = setup()
    await admitted(store)
    const updated = await service.confirm('intake-1', 1, FULL_CHOICES)
    expect(updated.judgmentState).toBe('confirmed')
    expect(updated.executionState).toBe('queued')
    expect(updated.unresolved).toEqual([])
    expect(updated.revision).toBe(2)
  })

  it('rejects confirm on a non-unresolved intake', async () => {
    const { store, service } = setup()
    await admitted(store, { judgmentState: 'auto_resolved' })
    const error = await service.confirm('intake-1', 1, FULL_CHOICES).catch((e) => e)
    expect(error).toBeInstanceOf(MeetingIntakeError)
    expect(error.code).toBe('INVALID_TRANSITION')
  })

  it('rejects stale revision and unknown intake', async () => {
    const { store, service } = setup()
    await admitted(store)
    await expect(service.confirm('intake-1', 99, FULL_CHOICES)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(service.confirm('missing', 1, FULL_CHOICES)).rejects.toMatchObject({ code: 'INTAKE_NOT_FOUND' })
  })

  it('rejects an unauthorized private thread destination', async () => {
    const { store, service } = setup()
    await admitted(store)
    const error = await service
      .confirm('intake-1', 1, { ...FULL_CHOICES, destinationHandle: 'host:private-thread:not-shared' })
      .catch((e) => e)
    expect(error).toBeInstanceOf(MeetingIntakeError)
    expect(error.code).toBe('DESTINATION_UNAVAILABLE')
  })

  it('rejects invalid choices (empty speaker map / duplicate outputs)', async () => {
    const { store, service } = setup()
    await admitted(store)
    await expect(
      service.confirm('intake-1', 1, { ...FULL_CHOICES, speakerMap: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_CHOICES' })
    // the previous write was rejected, so the intake revision is still 1
    await expect(
      service.confirm('intake-1', 1, { ...FULL_CHOICES, outputs: ['minutes', 'minutes'] }),
    ).rejects.toMatchObject({ code: 'INVALID_CHOICES' })
  })
})

describe('MeetingIntakeService.dismiss', () => {
  it('dismisses a non-terminal intake', async () => {
    const { store, service } = setup()
    await admitted(store)
    const updated = await service.dismiss('intake-1', 1)
    expect(updated.judgmentState).toBe('dismissed')
    expect(updated.healthState).toBe('healthy')
  })

  it('rejects dismissal twice, or of a succeeded intake', async () => {
    const { store, service } = setup()
    await admitted(store)
    await service.dismiss('intake-1', 1)
    await expect(service.dismiss('intake-1', 2)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    await admitted(store, { executionState: 'succeeded' }, 2)
    await expect(service.dismiss('intake-2', 1)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
  })
})

describe('MeetingIntakeService.markRepair / clearRepair', () => {
  it('marks a failed execution with a repair record', async () => {
    const { store, service } = setup()
    await admitted(store, { judgmentState: 'confirmed', executionState: 'queued' })
    const updated = await service.markRepair('intake-1', 1, { code: 'execution_failed', safeDetail: 'timeout' })
    expect(updated.healthState).toBe('degraded')
    expect(updated.executionState).toBe('failed')
    expect(updated.repair?.code).toBe('execution_failed')
    expect(updated.repair?.action).toBe('retry')
  })

  it('clears a repair and restores health', async () => {
    const { store, service } = setup()
    await admitted(store, { judgmentState: 'confirmed', executionState: 'queued' })
    const repaired = await service.markRepair('intake-1', 1, { code: 'execution_failed' })
    const cleared = await service.clearRepair('intake-1', repaired.revision)
    expect(cleared.healthState).toBe('healthy')
    expect(cleared.repair).toBeUndefined()
  })

  it('rejects unsupported repair codes and unbounded detail', async () => {
    const { store, service } = setup()
    await admitted(store)
    await expect(service.markRepair('intake-1', 1, { code: 'bogus' as never })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    })
    await expect(
      service.markRepair('intake-1', 1, { code: 'execution_failed', safeDetail: 'x'.repeat(600) }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
  })
})

describe('MemoryDestinationAuthority', () => {
  it('authorizes by owner and rejects cross-owner records', async () => {
    const authority = new MemoryDestinationAuthority()
    authority.put({ handle: DEST, kind: 'private-thread', targetId: 'thread-abc', ownerId: 'owner-1' })
    expect(await authority.resolve(DEST, 'owner-1')).not.toBeNull()
    expect(await authority.resolve(DEST, 'owner-2')).toBeNull()
  })
})