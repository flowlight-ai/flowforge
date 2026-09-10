/**
 * Snapshot construction: turns an arbitrary producer shape into a canonical,
 * structurally-frozen SessionSnapshot. Construction is order-preserving and
 * clones every entry so the record is stable for later comparison and replay.
 * @module @flowforge/session-snapshot/snapshot
 */

import type { SessionEntry, SessionSnapshot } from './types.ts'

/** Any iterable of entries a producer may hand over; duplicate ids are allowed. */
export type SnapshotInput = readonly SessionEntry[]

function freezeEntry(entry: SessionEntry): SessionEntry {
  return {
    id: String(entry.id),
    turn: Number(entry.turn),
    role: String(entry.role),
    content: String(entry.content),
  }
}

/**
 * Build a canonical snapshot from producer entries.
 * @param source - opaque label recorded in the snapshot.
 * @param entries - ordered producer entries (individually cloned).
 * @param capturedAt - ISO timestamp override (defaults to the current time).
 * @returns a structurally-frozen snapshot.
 */
export function createSnapshot(
  source: string,
  entries: SnapshotInput,
  capturedAt: string = new Date().toISOString(),
): SessionSnapshot {
  const frozen = entries.map(entry => Object.freeze(freezeEntry(entry)))
  // Freeze the array and each entry so downstream code cannot drift a record.
  return Object.freeze({
    version: 1 as const,
    source,
    capturedAt,
    entries: Object.freeze(frozen) as readonly SessionEntry[],
  })
}

/**
 * Deep-equal two snapshots on their comparable projection (version + entries).
 * Metadata such as `capturedAt`/`source` is intentionally ignored.
 * @param a - one snapshot.
 * @param b - another snapshot.
 * @returns true when versions and every entry match element-wise.
 */
export function snapshotEqual(a: SessionSnapshot, b: SessionSnapshot): boolean {
  if (a === b) return true
  if (a.version !== b.version) return false
  if (a.entries.length !== b.entries.length) return false
  for (let index = 0; index < a.entries.length; index += 1) {
    const x = a.entries[index]!
    const y = b.entries[index]!
    if (x.id !== y.id || x.turn !== y.turn || x.role !== y.role || x.content !== y.content) return false
  }
  return true
}

/**
 * Rebuild a mutable, decoupled copy of a snapshot (useful for hand-editing a
 * recorded fixture before comparing again).
 * @param snapshot - the snapshot to clone.
 * @returns a logically-equal snapshot that is structurally separate.
 */
export function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return Object.freeze({
    version: 1 as const,
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
    entries: Object.freeze(snapshot.entries.map(entry => Object.freeze({ ...entry }))) as readonly SessionEntry[],
  })
}