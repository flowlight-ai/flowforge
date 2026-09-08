/**
 * 来源访问租约契约：颁发一次性 grant、消费、吊销与过期语义。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import {
  MemorySourceAccessLeaseStore,
  SourceAccessError,
  SourceAccessLeaseService,
  SourceResolverRegistry,
  type SourceArtifact,
  type SourceResolver,
} from '../src/SourceAccessLeaseService.ts'
import { MemoryMeetingIntakeStore } from '../src/MeetingIntakeStore.ts'
import { makeIntake } from './fixtures.ts'

const HANDLE = 'minute://obcn123456'

class EchoResolver implements SourceResolver {
  readonly adapterId = 'echo.v1'
  supports(sourceHandle: string): boolean {
    return sourceHandle === HANDLE
  }
  async resolve(): Promise<SourceArtifact> {
    return { contentType: 'text/plain', text: 'meeting transcript' }
  }
}

function setup(overrides: { now?: () => number; ttlMs?: number } = {}) {
  const intakes = new MemoryMeetingIntakeStore()
  const leases = new MemorySourceAccessLeaseStore()
  const resolvers = new SourceResolverRegistry()
  resolvers.register(new EchoResolver())
  const service = new SourceAccessLeaseService({
    intakes,
    leases,
    resolvers,
    now: overrides.now ?? (() => 1_000),
    createGrant: () => 'grant-xxxx',
    ttlMs: overrides.ttlMs ?? 60_000,
  })
  return { service, intakes, leases }
}

describe('SourceAccessLeaseService.issue', () => {
  it('issues a short-lived grant for an admitted intake', async () => {
    const { service, intakes } = setup()
    await intakes.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake({ source: { handle: HANDLE } }) })
    const issued = await service.issue({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' })
    expect(issued.grant).toBe('grant-xxxx')
    expect(issued.expiresAt).toBe(1_000 + 60_000)
  })

  it('rejects an unknown intake', async () => {
    const { service } = setup()
    const error = await service.issue({ intakeId: 'missing', principalId: 'p1', purpose: 'transcript' }).catch((e) => e)
    expect(error).toBeInstanceOf(SourceAccessError)
    expect(error.code).toBe('INTAKE_NOT_FOUND')
  })

  it('rejects when no resolver accepts the source handle', async () => {
    const { service, intakes } = setup()
    await intakes.accept({
      settlementKey: 's1',
      sourceIdentityKey: 'src1',
      intake: makeIntake({ source: { handle: 'unknown://x' } }),
    })
    const error = await service.issue({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' }).catch((e) => e)
    expect(error).toBeInstanceOf(SourceAccessError)
    expect(error.code).toBe('RESOLVER_UNAVAILABLE')
  })

  it('rejects an out-of-range ttl at construction', () => {
    expect(() =>
      new SourceAccessLeaseService({
        intakes: new MemoryMeetingIntakeStore(),
        leases: new MemorySourceAccessLeaseStore(),
        resolvers: new SourceResolverRegistry(),
        ttlMs: 999_999,
      }),
    ).toThrow('source access lease ttl')
  })
})

describe('SourceAccessLeaseService.resolve', () => {
  it('claims a grant and returns a data_only artifact with provenance', async () => {
    const { service, intakes } = setup()
    await intakes.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake({ source: { handle: HANDLE } }) })
    const issued = await service.issue({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' })
    const resolved = await service.resolve(
      { intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript', grant: issued.grant },
      new AbortController().signal,
    )
    expect(resolved.text).toBe('meeting transcript')
    expect(resolved.provenance.trust).toBe('untrusted_external')
    expect(resolved.provenance.instructionPolicy).toBe('data_only')
  })

  it('throws GRANT_CONSUMED on a second claim', async () => {
    const { service, intakes } = setup()
    await intakes.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake({ source: { handle: HANDLE } }) })
    const issued = await service.issue({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' })
    const access = () =>
      service.resolve({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript', grant: issued.grant }, new AbortController().signal)
    await access()
    await expect(access()).rejects.toMatchObject({ code: 'GRANT_CONSUMED' })
  })

  it('throws GRANT_EXPIRED when the clock passes expiry', async () => {
    const intakes = new MemoryMeetingIntakeStore()
    await intakes.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake({ source: { handle: HANDLE } }) })
    const leases = new MemorySourceAccessLeaseStore()
    const resolvers = new SourceResolverRegistry()
    resolvers.register(new EchoResolver())
    const issuing = new SourceAccessLeaseService({ intakes, leases, resolvers, now: () => 1_000, ttlMs: 60_000 })
    const issued = await issuing.issue({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' })
    // A later Host clock (beyond expiry) rejects the grant as expired.
    const lateService = new SourceAccessLeaseService({ intakes, leases, resolvers, now: () => 1_000_000_000 })
    await expect(
      lateService.resolve({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript', grant: issued.grant }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'GRANT_EXPIRED' })
  })

  it('throws GRANT_SCOPE_MISMATCH for the wrong principal', async () => {
    const { service, intakes } = setup()
    await intakes.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake({ source: { handle: HANDLE } }) })
    const issued = await service.issue({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' })
    await expect(
      service.resolve({ intakeId: 'intake-1', principalId: 'p2', purpose: 'transcript', grant: issued.grant }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'GRANT_SCOPE_MISMATCH' })
  })

  it('revokes an issued grant before claim', async () => {
    const { service, intakes } = setup()
    await intakes.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake: makeIntake({ source: { handle: HANDLE } }) })
    const issued = await service.issue({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript' })
    await service.revoke(issued.grant)
    await expect(
      service.resolve({ intakeId: 'intake-1', principalId: 'p1', purpose: 'transcript', grant: issued.grant }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'GRANT_REVOKED' })
  })
})

describe('SourceResolverRegistry', () => {
  it('registers resolvers and resolves by support', () => {
    const registry = new SourceResolverRegistry()
    registry.register(new EchoResolver())
    expect(registry.resolve(HANDLE)?.adapterId).toBe('echo.v1')
    expect(registry.resolve('other://x')).toBeNull()
  })

  it('rejects duplicate adapter ids', () => {
    const registry = new SourceResolverRegistry()
    registry.register(new EchoResolver())
    expect(() => registry.register(new EchoResolver())).toThrow('duplicate source resolver')
  })
})