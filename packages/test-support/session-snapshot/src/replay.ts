/**
 * Snapshot replay: drive a recorded session forward. Replay is a pure,
 * pull-based async sequence over the frozen entries, so a harness may feed it
 * directly into a conversation loop or abort early without side effects.
 * @module @flowforge/session-snapshot/replay
 */

import type { SessionEntry, SessionSnapshot } from './types.ts'

/** Marker chosen for the protocol `next()` completion sentinel. */
type ReplayResult =
  | { done: false; value: SessionEntry }
  | { done: true; value: undefined }

/** Pull-based replay cursor over a snapshot's entries. */
export interface ReplayCursor {
  next(): Promise<ReplayResult>
  [Symbol.asyncIterator](): ReplayCursor
}

/**
 * Create a pull-based async iterator that yields every entry in order.
 * @param snapshot - the snapshot to replay.
 * @returns an async iterable cursor advancing over `snapshot.entries`.
 */
export function replaySnapshot(snapshot: SessionSnapshot): ReplayCursor {
  const entries = snapshot.entries
  let index = 0
  const cursor: ReplayCursor = {
    async next(): Promise<ReplayResult> {
      if (index >= entries.length) return { done: true, value: undefined }
      const value = entries[index]!
      index += 1
      return { done: false, value }
    },
    [Symbol.asyncIterator](): ReplayCursor {
      return cursor
    },
  }
  return cursor
}