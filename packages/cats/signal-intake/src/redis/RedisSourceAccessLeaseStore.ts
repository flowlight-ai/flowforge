/**
 * Redis 来源访问租约 store：create（PX·NX）、claim（claim Lua）、revoke。
 * 忠实移植 clowder-ai `domains/signal-intake/RedisSourceAccessLeaseStore.ts`，
 * 经本地 `SignalIntakeRedisClient` seam（见 `redis/seam.ts`）。
 *
 * @flowforge/cats-signal-intake — redis/RedisSourceAccessLeaseStore
 */

import { SignalIntakeKeys } from '../signal-intake-keys.ts'
import type {
  SourceAccessLeaseClaimResult,
  SourceAccessLeaseRecord,
  SourceAccessLeaseStore,
} from '../SourceAccessLeaseService.ts'
import { SIGNAL_INTAKE_LUA, type SignalIntakeRedisClient } from './seam.ts'

function parse(raw: string): SourceAccessLeaseRecord {
  const value = JSON.parse(raw) as SourceAccessLeaseRecord
  if (
    !value ||
    typeof value.grantHash !== 'string' ||
    typeof value.intakeId !== 'string' ||
    typeof value.principalId !== 'string' ||
    !Number.isSafeInteger(value.expiresAt)
  ) {
    throw new Error('source access lease record is corrupt')
  }
  return value
}

export class RedisSourceAccessLeaseStore implements SourceAccessLeaseStore {
  constructor(private readonly redis: SignalIntakeRedisClient) {}

  async create(record: SourceAccessLeaseRecord): Promise<void> {
    const retentionMs = Math.max(1, record.expiresAt - record.issuedAt + 60_000)
    const result = await this.redis.set(
      SignalIntakeKeys.sourceGrant(record.grantHash),
      JSON.stringify(record),
      { PX: retentionMs, NX: true },
    )
    if (result !== 'OK') throw new Error('source access grant collision')
  }

  async claim(
    grantHash: string,
    scope: Pick<SourceAccessLeaseRecord, 'intakeId' | 'principalId' | 'purpose'>,
    now: number,
  ): Promise<SourceAccessLeaseClaimResult> {
    const result = (await this.redis.eval(
      SIGNAL_INTAKE_LUA.claimSourceGrant,
      1,
      SignalIntakeKeys.sourceGrant(grantHash),
      scope.intakeId,
      scope.principalId,
      scope.purpose,
      String(now),
    )) as readonly string[]
    const [outcome, raw] = result
    if (outcome === 'claimed') {
      if (!raw) throw new Error('Redis source access claim omitted lease payload')
      return { outcome, record: parse(raw) }
    }
    if (
      outcome === 'not_found' ||
      outcome === 'scope_mismatch' ||
      outcome === 'expired' ||
      outcome === 'revoked' ||
      outcome === 'consumed'
    ) {
      return { outcome }
    }
    throw new Error(`unexpected Redis source access claim outcome: ${outcome}`)
  }

  async revoke(grantHash: string): Promise<void> {
    await this.redis.eval(SIGNAL_INTAKE_LUA.revokeSourceGrant, 1, SignalIntakeKeys.sourceGrant(grantHash))
  }
}