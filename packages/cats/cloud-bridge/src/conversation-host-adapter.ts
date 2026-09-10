import type {
  CloudInvokeContextMessage,
  CloudInvokeResponse,
  CloudSegment,
  HostSnapshot,
} from './cloud-bridge-types.ts'

/**
 * Adapter seam to a "conversation host" — the remote surface that actually
 * drives the cloud cat. Implementations may talk to a hosted runtime over any
 * transport; the in-memory implementation lets the bridge be exercised in real
 * contract tests without a network hop.
 */
export interface IConversationHostAdapter {
  /** Push the accumulated local context into the host conversation. */
  sendContext(threadId: string, contextMessages: CloudInvokeContextMessage[]): Promise<void>
  /** Read the host's current assistant output for a thread. */
  getSnapshot(threadId: string): Promise<HostSnapshot>
  /**
   * Stream assistant output deltas from the host as they are produced and
   * resolve with the final response.
   */
  streamDeltas(threadId: string, onDelta: (delta: import('./cloud-bridge-types.ts').DeltaPayload) => void | Promise<void>): Promise<CloudInvokeResponse>
}

/** In-memory host adapter backed by a mutable segment buffer per thread. */
export class MemoryConversationHostAdapter implements IConversationHostAdapter {
  private buffers = new Map<string, CloudSegment[]>()
  private timestamps = new Map<string, number>()

  constructor(private readonly now: () => number = Date.now) {}

  replaceContent(threadId: string, segments: CloudSegment[], updatedAt = this.now()): void {
    this.buffers.set(threadId, segments.map((seg) => ({ ...seg })))
    this.timestamps.set(threadId, updatedAt)
  }

  getContent(threadId: string): CloudSegment[] {
    return (this.buffers.get(threadId) ?? []).map((seg) => ({ ...seg }))
  }

  async sendContext(): Promise<void> {
    return
  }

  async getSnapshot(threadId: string): Promise<HostSnapshot> {
    return { threadId, assistantSegments: this.getContent(threadId), updatedAt: this.timestamps.get(threadId) ?? this.now() }
  }

  async streamDeltas(
    threadId: string,
    onDelta: (delta: import('./cloud-bridge-types.ts').DeltaPayload) => void | Promise<void>,
  ): Promise<CloudInvokeResponse> {
    const segments = this.getContent(threadId)
    const invocationId = `cloud-inv-${dateHash(this.now())}`
    const delta = segments.map((seg) => ({ op: 'append' as const, segmentSeq: seg.seq, kind: seg.kind, content: seg.content }))
    await onDelta(delta)
    return { invocationId, status: 'completed', segments }
  }
}

function dateHash(ts: number): string {
  return ts.toString(36)
}