import { describe, expect, it } from 'vitest'
import { CordisRunOrchestrator } from '../src/orchestrator.ts'
import type { CordisRunHostSeam, CordisRunRequest, CordisUserRunRequest } from '../src/orchestrator.ts'
import type { DynamicCordisInventoryRow } from '../src/types.ts'
import { createCordisClientRuntime } from '../src/memory.ts'

/** A real in-memory host seam whose behavior a test can script (no module mocks). */
function hostSeam(overrides: Partial<CordisRunHostSeam> = {}): CordisRunHostSeam & {
  calls: { resolveRequestRun: string[]; settleUserRun: string[] }
} {
  const calls = { resolveRequestRun: [], settleUserRun: [] } as {
    resolveRequestRun: string[]
    settleUserRun: string[]
  }
  return {
    runHostHalf: async () => ({ ok: true, pluginId: 'p1', packageId: 'p1@v1', pluginRunId: 'p1#1', waitingFor: [], startedHere: true }),
    getClientCode: async () => ({ pluginId: 'p1', packageId: 'p1@v1', pluginRunId: 'p1#1', name: 'n', code: 'return () => {}' }),
    resolveRequestRun: async () => {
      calls.resolveRequestRun.push('resolved')
      return { accepted: true }
    },
    settleUserRun: async () => {
      calls.settleUserRun.push('settled')
      return { ok: true }
    },
    ...overrides,
    calls,
  }
}

function request(overrides: Partial<CordisRunRequest> = {}): CordisRunRequest {
  return {
    requestId: 'req-1',
    agentId: 'agent-1',
    pluginId: 'p1',
    packageId: 'p1@v1',
    mode: 'run',
    name: 'n',
    purpose: 'purpose',
    requiresApproval: true,
    ...overrides,
  }
}

function makeOrchestrator(seam: CordisRunHostSeam) {
  const runtime = createCordisClientRuntime({
    transport: {
      invoke: () => Promise.resolve(null),
      reportRenderFailure: () => {},
      reportGuardFailure: () => {},
    },
    installTimer: false,
    installInspect: false,
  })
  return new CordisRunOrchestrator({ runner: runtime.runner, host: seam })
}

describe('CordisRunOrchestrator', () => {
  it('holds an open approval request as awaiting-approval', () => {
    const seam = hostSeam()
    const o = makeOrchestrator(seam)
    o.open(request())
    const activity = o.activeRuns.getSnapshot().get('p1')
    expect(activity?.phase).toBe('awaiting-approval')
    if (activity?.phase === 'awaiting-approval') {
      expect(activity.requestId).toBe('req-1')
    }
  })

  it('approve runs the host half, loads the client half and answers the request', async () => {
    const seam = hostSeam()
    const o = makeOrchestrator(seam)
    o.open(request())
    await o.approve('req-1', false)
    expect(seam.calls.resolveRequestRun).toEqual(['resolved'])
    // activity is cleared after settling
    expect(o.activeRuns.getSnapshot().has('p1')).toBe(false)
    expect(o.lastRunError.getSnapshot().has('p1')).toBe(false)
  })

  it('decline answers with a rejection and clears the activity', async () => {
    const seam = hostSeam()
    const o = makeOrchestrator(seam)
    o.open(request())
    await o.decline('req-1')
    expect(seam.calls.resolveRequestRun).toEqual(['resolved'])
    expect(o.activeRuns.getSnapshot().has('p1')).toBe(false)
  })

  it('decline is a no-op for an unknown or non-approval request', async () => {
    const seam = hostSeam()
    const o = makeOrchestrator(seam)
    o.open({ ...request(), requiresApproval: false, requestId: 'req-auto' })
    await o.decline('req-auto')
    // auto requests are not pending approvals, so nothing is answered by decline
    expect(seam.calls.resolveRequestRun).toEqual([])
  })

  it('startUserRun drives a direct (already authorized) activation with settlement', async () => {
    const seam = hostSeam()
    const o = makeOrchestrator(seam)
    const run: CordisUserRunRequest = {
      agentId: 'agent-1', pluginId: 'p1', packageId: 'p1@v1', mode: 'run', hasClientHalf: true,
    }
    await o.startUserRun(run)
    expect(seam.calls.settleUserRun).toEqual(['settled'])
  })

  it('host-only packages settle without a client load', async () => {
    const seam: CordisRunHostSeam = {
      ...hostSeam(),
      getClientCode: async () => { throw new Error('must not read client code for host-only runs') },
      runHostHalf: async () => ({ ok: true, pluginId: 'p1', packageId: 'p1@v1', pluginRunId: 'p1#1', waitingFor: [], startedHere: true }),
    }
    const o = makeOrchestrator(seam)
    await o.startUserRun({ agentId: 'agent-1', pluginId: 'p1', packageId: 'p1@v1', mode: 'run', hasClientHalf: false })
    // host-only runs finish without a client load and without a settle call.
    expect(seam.calls.settleUserRun).toEqual([])
  })

  it('records a host-half failure and answers the request', async () => {
    const seam = hostSeam({
      runHostHalf: async () => ({ ok: false, message: 'host refused' }),
    })
    const o = makeOrchestrator(seam)
    o.open(request())
    await o.approve('req-1', false)
    expect(seam.calls.resolveRequestRun).toEqual(['resolved'])
    const failure = o.lastRunError.getSnapshot().get('p1')
    expect(failure).toBeDefined()
    expect(failure?.reason).toBe('host-half-failed')
  })

  it('reconcileApprovals rebuilds pending approvals from an authoritative inventory read', () => {
    const seam = hostSeam()
    const o = makeOrchestrator(seam)
    const row: DynamicCordisInventoryRow = {
      agentId: 'agent-1',
      pluginId: 'p1',
      packages: [{ packageId: 'p1@v1', name: 'n', purpose: 'purpose' }],
      latestRun: { approvalRequestId: 'req-r', status: 'awaiting-approval', packageId: 'p1@v1', mode: 'run' },
    }
    o.reconcileApprovals([row])
    const activity = o.activeRuns.getSnapshot().get('p1')
    expect(activity?.phase).toBe('awaiting-approval')
    if (activity?.phase === 'awaiting-approval') expect(activity.requestId).toBe('req-r')
    // A subsequent authoritative read that drops the approval clears it.
    o.reconcileApprovals([])
    expect(o.activeRuns.getSnapshot().has('p1')).toBe(false)
  })
})