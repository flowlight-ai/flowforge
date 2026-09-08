/**
 * Redis 会议入站 store：accept（跨键原子）、CAS 写、settlement 回查、list。
 * 忠实移植 clowder-ai `domains/signal-intake/RedisMeetingIntakeStore.ts`，
 * 经本地 `SignalIntakeRedisClient` seam（见 `redis/seam.ts`）。
 *
 * @flowforge/cats-signal-intake — redis/RedisMeetingIntakeStore
 */

import type { MeetingIntake } from '../contract/signals.ts'
import type {
  AcceptMeetingIntakeInput,
  AcceptMeetingIntakeResult,
  MeetingIntakeCasResult,
  MeetingIntakeSettlement,
  MeetingIntakeStore,
} from '../MeetingIntakeStore.ts'
import { parseMeetingIntake } from '../meeting-intake-codec.ts'
import { SignalIntakeKeys } from '../signal-intake-keys.ts'
import { SIGNAL_INTAKE_LUA, type SignalIntakeRedisClient } from './seam.ts'

export class RedisMeetingIntakeStore implements MeetingIntakeStore {
  constructor(private readonly redis: SignalIntakeRedisClient) {}

  async accept(input: AcceptMeetingIntakeInput): Promise<AcceptMeetingIntakeResult> {
    const intakeKey = SignalIntakeKeys.intake(input.intake.intakeId)
    const settlement = JSON.stringify({
      canonicalDigest: input.intake.ingress.canonicalDigest,
      intakeId: input.intake.intakeId,
      publicationId: input.intake.ingress.publicationId,
    })
    const result = await this.redis.eval(
      SIGNAL_INTAKE_LUA.accept,
      4,
      SignalIntakeKeys.settlement(input.settlementKey),
      SignalIntakeKeys.sourceIdentity(input.sourceIdentityKey),
      intakeKey,
      SignalIntakeKeys.allIntakes(),
      input.intake.ingress.canonicalDigest,
      settlement,
      input.intake.intakeId,
      JSON.stringify(input.intake),
    )
    const [outcome, raw] = result as readonly string[]
    if (outcome === 'accepted' || outcome === 'duplicate') {
      if (!raw) throw new Error('Redis meeting intake admission omitted intake payload')
      return { outcome, intake: parseMeetingIntake(raw) }
    }
    if (outcome === 'idempotency_conflict' || outcome === 'source_identity_conflict') return { outcome }
    throw new Error(`Redis meeting intake admission invariant failed: ${outcome}`)
  }

  async get(intakeId: string): Promise<MeetingIntake | null> {
    const raw = await this.redis.get(SignalIntakeKeys.intake(intakeId))
    return raw ? parseMeetingIntake(raw) : null
  }

  async lookupSettlement(settlementKey: string): Promise<MeetingIntakeSettlement | null> {
    const raw = await this.redis.get(SignalIntakeKeys.settlement(settlementKey))
    if (!raw) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Redis meeting intake settlement is not valid JSON')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Redis meeting intake settlement is malformed')
    }
    const settlement = parsed as Record<string, unknown>
    if (
      typeof settlement.canonicalDigest !== 'string' ||
      typeof settlement.intakeId !== 'string' ||
      typeof settlement.publicationId !== 'string'
    ) {
      throw new Error('Redis meeting intake settlement is malformed')
    }
    const intake = await this.get(settlement.intakeId)
    if (
      !intake ||
      intake.ingress.canonicalDigest !== settlement.canonicalDigest ||
      intake.ingress.publicationId !== settlement.publicationId
    ) {
      throw new Error('Redis meeting intake settlement is inconsistent with its intake')
    }
    return {
      canonicalDigest: settlement.canonicalDigest,
      intakeId: settlement.intakeId,
      publicationId: settlement.publicationId,
    }
  }

  async list(): Promise<MeetingIntake[]> {
    const intakeIds = await this.redis.smembers(SignalIntakeKeys.allIntakes())
    if (intakeIds.length === 0) return []
    const raw = await this.redis.mget(...intakeIds.map(SignalIntakeKeys.intake))
    return raw.filter((value): value is string => value !== null).map(parseMeetingIntake)
  }

  async compareAndSet(intakeId: string, expectedRevision: number, next: MeetingIntake): Promise<MeetingIntakeCasResult> {
    if (next.intakeId !== intakeId || next.revision !== expectedRevision + 1) {
      throw new Error('meeting intake CAS candidate has invalid identity or revision')
    }
    const result = (await this.redis.eval(
      SIGNAL_INTAKE_LUA.casMeetingIntake,
      1,
      SignalIntakeKeys.intake(intakeId),
      String(expectedRevision),
      JSON.stringify(next),
    )) as readonly string[]
    const [outcome, raw] = result
    if (outcome === 'missing') return { outcome }
    if (!raw) throw new Error('Redis meeting intake CAS omitted intake payload')
    if (outcome === 'written' || outcome === 'revision_conflict') {
      return { outcome, intake: parseMeetingIntake(raw) }
    }
    throw new Error(`unexpected Redis meeting intake CAS outcome: ${outcome}`)
  }
}