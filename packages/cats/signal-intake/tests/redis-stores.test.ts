/**
 * Redis/KV seam 三 store 契约：经内存 `SignalIntakeRedisClient` 假实现驱动，
 * 验证 Lua 语义（accept CAS、claim、revoke）与 crud。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MemorySignalIntakeRedisClient } from '../src/redis/seam.ts'
import { RedisMeetingIntakeStore } from '../src/redis/RedisMeetingIntakeStore.ts'
import { RedisSignalRouteStore } from '../src/redis/RedisSignalRouteStore.ts'
import { RedisSourceAccessLeaseStore } from '../src/redis/RedisSourceAccessLeaseStore.ts'
import { digest, makeIntake, makeRoute } from './fixtures.ts'

describe('RedisMeetingIntakeStore (memory seam)', () => {
  it('accepts, dedupes, and lists intakes', async () => {
    const store = new RedisMeetingIntakeStore(new MemorySignalIntakeRedisClient())
    const intake = makeIntake()
    const accepted = await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
    expect(accepted.outcome).toBe('accepted')
    const again = await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
    expect(again.outcome).toBe('duplicate')
    expect(await store.get('intake-1')).not.toBeNull()
    expect(await store.list()).toHaveLength(1)
  })

  it('returns idempotency_conflict on a different canonical digest', async () => {
    const store = new RedisMeetingIntakeStore(new MemorySignalIntakeRedisClient())
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake() })
    const clash = await store.accept({
      settlementKey: 's1',
      sourceIdentityKey: 'src2',
      intake: makeIntake({ intakeId: 'intake-2', ingress: { ...makeIntake().ingress, canonicalDigest: digest({ z: 1 }) } }),
    })
    expect(clash.outcome).toBe('idempotency_conflict')
  })

  it('performs CAS writes and reports revision conflicts', async () => {
    const store = new RedisMeetingIntakeStore(new MemorySignalIntakeRedisClient())
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake() })
    const written = await store.compareAndSet('intake-1', 1, { ...makeIntake(), revision: 2, judgmentState: 'confirmed' })
    expect(written.outcome).toBe('written')
    const stale = await store.compareAndSet('intake-1', 1, { ...makeIntake(), revision: 2 })
    expect(stale.outcome).toBe('revision_conflict')
  })

  it('round-trips settlement lookup', async () => {
    const store = new RedisMeetingIntakeStore(new MemorySignalIntakeRedisClient())
    await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake() })
    expect(await store.lookupSettlement('s1')).toMatchObject({ intakeId: 'intake-1' })
  })
})

describe('RedisSignalRouteStore (memory seam)', () => {
  it('put/get/putIfAbsent round-trips', async () => {
    const store = new RedisSignalRouteStore(new MemorySignalIntakeRedisClient())
    const route = makeRoute()
    expect(await store.putIfAbsent(route)).toBe(true)
    expect(await store.putIfAbsent(makeRoute({ generation: 9 }))).toBe(false)
    expect(await store.get('plugin-feishu', 'feishu.meeting.occurred')).toEqual(route)
  })
})

describe('RedisSourceAccessLeaseStore (memory seam)', () => {
  it('create → claim → revoke follows Lua semantics', async () => {
    const store = new RedisSourceAccessLeaseStore(new MemorySignalIntakeRedisClient())
    await store.create({
      grantHash: 'hash-1',
      intakeId: 'intake-1',
      sourceHandle: 'minute://x',
      principalId: 'p1',
      purpose: 'transcript',
      state: 'issued',
      issuedAt: 1_000,
      expiresAt: 61_000,
    })
    const claimed = await store.claim('hash-1', { intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' }, 2_000)
    expect(claimed.outcome).toBe('claimed')
    const again = await store.claim('hash-1', { intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' }, 3_000)
    expect(again.outcome).toBe('consumed')
  })

  it('rejects a stale scope with scope_mismatch', async () => {
    const store = new RedisSourceAccessLeaseStore(new MemorySignalIntakeRedisClient())
    await store.create({
      grantHash: 'hash-1',
      intakeId: 'intake-1',
      sourceHandle: 'minute://x',
      principalId: 'p1',
      purpose: 'transcript',
      state: 'issued',
      issuedAt: 1_000,
      expiresAt: 61_000,
    })
    const result = await store.claim('hash-1', { intakeId: 'intake-1', principalId: 'other', purpose: 'transcript' }, 2_000)
    expect(result.outcome).toBe('scope_mismatch')
  })
})