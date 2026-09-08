/**
 * 会议入站存储契约：原子幂等入账、来源冲突、CAS 写。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MemoryMeetingIntakeStore } from '../src/MeetingIntakeStore.ts'
import { digest, makeIntake } from './fixtures.ts'

describe('MemoryMeetingIntakeStore.accept', () => {
  it('accepts a fresh intake with a unique settlement', async () => {
    const store = new MemoryMeetingIntakeStore()
    const intake = makeIntake()
    const result = await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
    expect(result.outcome).toBe('accepted')
    if (result.outcome === 'accepted') expect(result.intake.intakeId).toBe('intake-1')
  })

  it('returns duplicate for an identical settlement replay', async () => {
    const store = new MemoryMeetingIntakeStore()
    const intake = makeIntake()
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
    const again = await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src-other', intake })
    expect(again.outcome).toBe('duplicate')
  })

  it('returns idempotency_conflict when a settlement is bound to different content', async () => {
    const store = new MemoryMeetingIntakeStore()
    const intake = makeIntake()
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
    // different canonical digest on the same settlement → conflict
    const clash = await store.accept({
      settlementKey: 's1',
      sourceIdentityKey: 'src2',
      intake: makeIntake({ intakeId: 'intake-9', ingress: { ...makeIntake().ingress, canonicalDigest: digest({ x: 2 }) } }),
    })
    expect(clash.outcome).toBe('idempotency_conflict')
  })

  it('returns source_identity_conflict when the source artifact already has an intake', async () => {
    const store = new MemoryMeetingIntakeStore()
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake() })
    const result = await store.accept({
      settlementKey: 's2',
      sourceIdentityKey: 'src1',
      intake: makeIntake({ intakeId: 'intake-2' }),
    })
    expect(result.outcome).toBe('source_identity_conflict')
  })

  it('lookupSettlement round-trips a valid settlement', async () => {
    const store = new MemoryMeetingIntakeStore()
    const intake = makeIntake()
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
    const settlement = await store.lookupSettlement('s1')
    expect(settlement?.intakeId).toBe('intake-1')
    expect(settlement?.canonicalDigest).toBe(intake.ingress.canonicalDigest)
  })
})

describe('MemoryMeetingIntakeStore.compareAndSet', () => {
  it('writes a candidate whose revision is exactly expected + 1', async () => {
    const store = new MemoryMeetingIntakeStore()
    const intake = makeIntake()
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
    const next = { ...intake, revision: 2, judgmentState: 'confirmed' as const }
    const result = await store.compareAndSet('intake-1', 1, next)
    expect(result.outcome).toBe('written')
  })

  it('returns revision_conflict on stale expectation', async () => {
    const store = new MemoryMeetingIntakeStore()
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake() })
    const result = await store.compareAndSet('intake-1', 999, makeIntake())
    expect(result.outcome).toBe('revision_conflict')
  })

  it('returns missing for an unknown intake', async () => {
    const store = new MemoryMeetingIntakeStore()
    const result = await store.compareAndSet('nope', 1, makeIntake())
    expect(result.outcome).toBe('missing')
  })
})