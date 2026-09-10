import type { CloudSegment, DeltaPayload } from './cloud-bridge-types.ts'

/**
 * Compute the delta between a previous local segment list and the next
 * (post-cloud) segment list. The delta is the minimal set of ops needed to
 * bring `previous` to `next`.
 *
 * Rules:
 * - Segments present and equal are omitted (no-op).
 * - A segment whose `seq` exists with different content is a `replace`.
 * - Segments that exist in `next` but not in `previous` (append position) are
 *   appended as `append` ops in `seq` order.
 * - Removed segments yield a `remove` op.
 */
export function buildDeltaPayload(previous: CloudSegment[], next: CloudSegment[]): DeltaPayload {
  const previousBySeq = new Map<number, CloudSegment>()
  for (const seg of previous) previousBySeq.set(seg.seq, seg)

  const nextBySeq = new Map<number, CloudSegment>()
  for (const seg of next) nextBySeq.set(seg.seq, seg)

  const ops: DeltaPayload = []

  // Replaces and appends in next order.
  for (const seg of next) {
    const prev = previousBySeq.get(seg.seq)
    if (!prev) {
      ops.push({ op: 'append', segmentSeq: seg.seq, kind: seg.kind, content: seg.content })
    } else if (prev.kind !== seg.kind || prev.content !== seg.content) {
      ops.push({ op: 'replace', segmentSeq: seg.seq, kind: seg.kind, content: seg.content })
    }
  }

  // Removals.
  for (const seg of previous) {
    if (!nextBySeq.has(seg.seq)) {
      ops.push({ op: 'remove', segmentSeq: seg.seq })
    }
  }

  return ops
}

/** Apply a delta payload over a previous segment list, producing the next list. */
export function applyDeltaPayload(previous: CloudSegment[], delta: DeltaPayload): CloudSegment[] {
  const working = new Map<number, CloudSegment>()
  for (const seg of previous) working.set(seg.seq, seg)

  for (const op of delta) {
    if (op.op === 'append' || op.op === 'replace') {
      if (op.segmentSeq === undefined || op.kind === undefined || op.content === undefined) {
        throw new Error('invalid delta op: append/replace require segmentSeq, kind and content')
      }
      working.set(op.segmentSeq, { seq: op.segmentSeq, kind: op.kind, content: op.content })
    } else if (op.op === 'remove') {
      if (op.segmentSeq === undefined) throw new Error('invalid delta op: remove requires segmentSeq')
      working.delete(op.segmentSeq)
    }
  }

  return Array.from(working.values()).sort((a, b) => a.seq - b.seq)
}