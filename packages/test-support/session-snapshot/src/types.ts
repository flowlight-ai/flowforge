/** Shared session-snapshot value types. @module @flowforge/session-snapshot */

/** One message inside a recorded session snapshot. */
export interface SessionEntry {
  /** Stable per-entry identifier (opaque). */
  id: string
  /** Zero-based turn ordinal (messages share a turn when produced together). */
  turn: number
  /** Producer of the entry. */
  role: string
  /** Stable textual content of the entry. */
  content: string
}

/**
 * An immutable, structurally-frozen recording of one session. The snapshot is
 * the durable artifact tests build, compare, and replay — it never references
 * live objects, so a producer's later mutation can not corrupt a comparison.
 */
export interface SessionSnapshot {
  /** Serialization version (bumps on incompatible shapes). */
  version: 1
  /** Opaque label for where the snapshot was taken. */
  source: string
  /** ISO timestamp recorded when the snapshot was captured. */
  capturedAt: string
  /** Canonical, turn- and insertion-ordered entries. */
  entries: readonly SessionEntry[]
}