import type { CloudInvokeResponse, CloudSegment, HostSnapshot } from './cloud-bridge-types.ts'
import { applyDeltaPayload, buildDeltaPayload } from './build-delta-payload.ts'
import { ReturnBindingConflictError } from './errors.ts'

export interface BoundInvocationResult {
  invocationId: string
  appendedSegments: CloudSegment[]
  summary?: string
  committedAt: number
}

/**
 * Return-binding port. Re-materializes a cloud response (as deltas over the
 * host snapshot, against the locally-known committed base) back onto the local
 * thread. `getLocalBase` exposes the last committed base so the bridge can
 * pass the correct `previousSegments`. If the committed base no longer matches
 * the caller's `previousSegments`, a concurrent writer already advanced the
 * thread and rebinding is rejected to avoid clobbering it.
 */
export interface IReturnBinding {
  getLocalBase(threadId: string): Promise<CloudSegment[]>
  bind(input: {
    invocationId: string
    threadId: string
    response: CloudInvokeResponse
    snapshot: HostSnapshot
    previousSegments: CloudSegment[]
    committedAt: number
  }): Promise<BoundInvocationResult>
}

export const DEFAULT_RETURN_BINDING_BASE: CloudSegment[] = []

export interface IReturnBindingRepository {
  getBase(threadId: string): Promise<CloudSegment[]>
  setBase(threadId: string, segments: CloudSegment[]): Promise<void>
}

export class InMemoryReturnBindingRepository implements IReturnBindingRepository {
  private bases = new Map<string, CloudSegment[]>()

  async getBase(threadId: string): Promise<CloudSegment[]> {
    return (this.bases.get(threadId) ?? []).map((seg) => ({ ...seg }))
  }

  async setBase(threadId: string, segments: CloudSegment[]): Promise<void> {
    this.bases.set(threadId, segments.map((seg) => ({ ...seg })))
  }
}

export class MemoryReturnBinding implements IReturnBinding {
  constructor(private readonly repository: IReturnBindingRepository) {}

  async getLocalBase(threadId: string): Promise<CloudSegment[]> {
    return this.repository.getBase(threadId)
  }

  async bind(input: {
    invocationId: string
    threadId: string
    response: CloudInvokeResponse
    snapshot: HostSnapshot
    previousSegments: CloudSegment[]
    committedAt: number
  }): Promise<BoundInvocationResult> {
    // Rebind detection: if the committed base no longer matches the caller's
    // previous segments, a concurrent writer advanced the thread first.
    const base = await this.repository.getBase(input.threadId)
    if (!sameSegments(base, input.previousSegments)) {
      throw new ReturnBindingConflictError()
    }

    const nextSegments = input.snapshot.assistantSegments
    const delta = buildDeltaPayload(input.previousSegments, nextSegments)
    const applied = applyDeltaPayload(input.previousSegments, delta)
    await this.repository.setBase(input.threadId, applied)

    return {
      invocationId: input.invocationId,
      appendedSegments: applied.slice(input.previousSegments.length),
      ...(input.response.summary !== undefined ? { summary: input.response.summary } : {}),
      committedAt: input.committedAt,
    }
  }
}

function sameSegments(a: CloudSegment[], b: CloudSegment[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (!x || !y || x.seq !== y.seq || x.kind !== y.kind || x.content !== y.content) return false
  }
  return true
}