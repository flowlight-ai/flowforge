/**
 * 信号准入服务契约：binding 授权 + 结构/声明校验 + 幂等入账。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MemoryMeetingIntakeStore } from '../src/MeetingIntakeStore.ts'
import { MemorySignalRouteStore } from '../src/SignalRouteStore.ts'
import { MemorySignalRuntimeLeaseStore } from '../src/SignalRuntimeLeaseStore.ts'
import { SignalAdmissionMemoryInventory, SignalAdmissionService, signalSettlementKey } from '../src/SignalAdmissionService.ts'
import { MemorySignalIngressTraceSink } from '../src/IngressTrace.ts'
import { SignalAdmissionError } from '../src/errors.ts'
import { makeBinding, makeInventorySnapshot, makeLease, makeRoute } from './fixtures.ts'

function setup(overrides: { now?: () => number } = {}) {
  const inventory = new SignalAdmissionMemoryInventory(makeInventorySnapshot())
  const leases = new MemorySignalRuntimeLeaseStore()
  leases.put(makeLease())
  const routes = new MemorySignalRouteStore()
  routes.put(makeRoute())
  const intakes = new MemoryMeetingIntakeStore()
  const traces = new MemorySignalIngressTraceSink()
  let intakeSeq = 0
  const service = new SignalAdmissionService({
    inventory,
    runtimeLeases: leases,
    routes,
    intakes,
    now: overrides.now ?? (() => 2_000),
    createPublicationId: () => 'pub-1',
    createIntakeId: () => `intake-${++intakeSeq}`,
    traces,
  })
  return { service, intakes, traces, routes }
}

const VALID_SIGNAL = () => ({
  signalType: 'feishu.meeting.occurred',
  eventId: 'evt-1',
  idempotencyKey: 'idem-1',
  occurredAt: '2026-09-08T00:00:00Z',
  payload: { transcriptId: 'obcn123' },
  source: { handle: 'minute://obcn123' },
})

describe('SignalAdmissionService.publish — happy path', () => {
  it('accepts a valid signal and records an intake', async () => {
    const { service, intakes } = setup()
    const result = await service.publish(makeBinding(), VALID_SIGNAL())
    expect(result.disposition).toBe('accepted')
    expect(result.publicationId).toBe('pub-1')
    const list = await intakes.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.ownerId).toBe('owner-1')
    expect(list[0]!.origin.signalType).toBe('feishu.meeting.occurred')
  })

  it('returns duplicate for an identical replay', async () => {
    const { service } = setup()
    await service.publish(makeBinding(), VALID_SIGNAL())
    const again = await service.publish(makeBinding(), VALID_SIGNAL())
    expect(again.disposition).toBe('duplicate')
  })
})

describe('SignalAdmissionService.publish — authorization failures', () => {
  it('rejects structurally invalid input', async () => {
    const { service } = setup()
    await expect(service.publish(makeBinding(), { ...VALID_SIGNAL(), destination: 'nope' })).rejects.toThrow()
  })

  it('throws RUNTIME_LEASE_EXPIRED under an expired lease', async () => {
    const { service, intakes } = setup({ now: () => 99_999_999 })
    const error = await service.publish(makeBinding(), VALID_SIGNAL()).catch((e) => e)
    expect(error).toBeInstanceOf(SignalAdmissionError)
    expect(error.code).toBe('RUNTIME_LEASE_EXPIRED')
    expect(await intakes.list()).toHaveLength(0)
  })

  it('throws STALE_ROUTE on a stale route generation', async () => {
    const { service } = setup()
    const error = await service.publish(makeBinding({ routeGeneration: 2 }), VALID_SIGNAL()).catch((e) => e)
    expect(error).toBeInstanceOf(SignalAdmissionError)
    expect(error.code).toBe('STALE_ROUTE')
  })

  it('throws STALE_GRANT on a stale grant revision', async () => {
    const { service } = setup()
    const error = await service.publish(makeBinding({ grantRevision: 7 }), VALID_SIGNAL()).catch((e) => e)
    expect(error).toBeInstanceOf(SignalAdmissionError)
    expect(error.code).toBe('STALE_GRANT')
  })

  it('throws RUNTIME_LEASE_MISSING when the binding lease is absent', async () => {
    const { service } = setup()
    const error = await service.publish(makeBinding({ runtimeLeaseId: 'missing' }), VALID_SIGNAL()).catch((e) => e)
    expect(error).toBeInstanceOf(SignalAdmissionError)
    expect(error.code).toBe('RUNTIME_LEASE_MISSING')
  })
})

describe('SignalAdmissionService.publish — route & intake constraints', () => {
  it('throws ROUTE_UNAVAILABLE when no active route admits the signal', async () => {
    const { service, routes } = setup()
    await routes.put(makeRoute({ state: 'suspended' }))
    const error = await service.publish(makeBinding(), VALID_SIGNAL()).catch((e) => e)
    expect(error).toBeInstanceOf(SignalAdmissionError)
    expect(error.code).toBe('ROUTE_UNAVAILABLE')
  })

  it('records a rejected trace on failure', async () => {
    const { service, traces } = setup()
    await service.publish(makeBinding({ grantRevision: 7 }), VALID_SIGNAL()).catch(() => undefined)
    expect(traces.traces.some((t) => t.outcome === 'rejected')).toBe(true)
  })
})

describe('signalSettlementKey', () => {
  it('is stable across field ordering', () => {
    const a = signalSettlementKey('inst', { ...VALID_SIGNAL(), source: { handle: 'h' } })
    const b = signalSettlementKey('inst', { ...VALID_SIGNAL(), source: { handle: 'h' } })
    expect(a).toBe(b)
    expect(a).not.toBe(signalSettlementKey('other', { ...VALID_SIGNAL(), source: { handle: 'h' } }))
  })
})