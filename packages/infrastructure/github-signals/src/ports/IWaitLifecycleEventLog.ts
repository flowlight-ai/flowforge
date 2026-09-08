/**
 * @flowforge/infrastructure-github-signals — IWaitLifecycleEventLog port + memory impl
 *
 * Self-contained port of the clowder-ai `../ball-custody/WaitLifecycleEventLog.ts`
 * `IWaitLifecycleEventLog` seam. The lifecycle appends termination events
 * (idempotent by `eventId`); persistence is a host-side concern (EP2/EP4).
 */

import type { WaitTerminationEventV1 } from '../contract/github-wait.ts'

export interface IWaitLifecycleEventLog {
  append(event: WaitTerminationEventV1): Promise<{ appended: boolean; sequence: number }>
  read(waitId: string, fromSequence?: number): Promise<WaitTerminationEventV1[]>
}

/** In-memory, idempotent (by eventId) event log — the real contract for tests. */
export class MemoryWaitLifecycleEventLog implements IWaitLifecycleEventLog {
  private readonly events = new Map<string, WaitTerminationEventV1[]>()
  private readonly seen = new Set<string>()

  async append(event: WaitTerminationEventV1): Promise<{ appended: boolean; sequence: number }> {
    if (this.seen.has(event.eventId)) return { appended: false, sequence: -1 }
    this.seen.add(event.eventId)
    const entries = this.events.get(event.waitId) ?? []
    entries.push(event)
    this.events.set(event.waitId, entries)
    return { appended: true, sequence: entries.length - 1 }
  }

  async read(waitId: string, fromSequence = 0): Promise<WaitTerminationEventV1[]> {
    return [...(this.events.get(waitId) ?? []).slice(fromSequence)]
  }
}