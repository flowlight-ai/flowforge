/**
 * Snapshot comparison: a structural diff that pinpoints every mismatched field
 * between two snapshots. The per-field predicate is an injected seam, so tests
 * may swap the default strict equality for a normalizer-aware comparator
 * without changing the walking itself.
 * @module @flowforge/session-snapshot/compare
 */

import type { SessionEntry, SessionSnapshot } from './types.ts'

/** Options for {@link compareSnapshots}. */
export interface CompareOptions {
  /** Injectable scalar comparator; default is strict equality. */
  field?: (actual: unknown, expected: unknown) => boolean
  /** If set, only entries with these ids participate in the comparison. */
  only?: readonly string[]
}

/** One concrete field-level mismatch. */
export interface SnapshotDifference {
  /** Index of the mismatched entry within the compared projection. */
  index: number
  /** Id of the mismatched entry (undefined only for cross-project checks). */
  id?: string
  /** Dot path such as `entries[0].content`. */
  path: string
  /** Value found in the actual snapshot. */
  actual: unknown
  /** Value found in the expected snapshot. */
  expected: unknown
}

/** The reported result of a comparison. */
export interface SnapshotDiff {
  /** True when no differences remain over the compared projection. */
  equal: boolean
  /** The (possibly empty) list of field-level mismatches, in walk order. */
  differences: readonly SnapshotDifference[]
}

/** Default strict scalar comparison. */
const strict = (a: unknown, b: unknown): boolean => a === b

function projections(snapshot: SessionSnapshot, only: readonly string[] | undefined): readonly SessionEntry[] {
  if (only === undefined || only.length === 0) return snapshot.entries
  const wanted = new Set(only)
  return snapshot.entries.filter(entry => wanted.has(entry.id))
}

const ID_FIELDS = ['id', 'turn', 'role', 'content'] as const

/**
 * Compare two snapshots entry-by-entry and field-by-field.
 * @param actual - the live/hand-produced snapshot.
 * @param expected - the recorded/expected snapshot.
 * @param options - injected comparator and/or entry filter.
 * @returns a diff with every mismatch in walk order.
 */
export function compareSnapshots(
  actual: SessionSnapshot,
  expected: SessionSnapshot,
  options?: CompareOptions,
): SnapshotDiff {
  const field = options?.field ?? strict
  const actualEntries = projections(actual, options?.only)
  const expectedEntries = projections(expected, options?.only)
  const differences: SnapshotDifference[] = []

  if (actual.version !== expected.version) {
    differences.push({
      index: -1,
      path: 'version',
      actual: actual.version,
      expected: expected.version,
    })
  }

  const length = Math.max(actualEntries.length, expectedEntries.length)
  for (let index = 0; index < length; index += 1) {
    const actualEntry = actualEntries[index]
    const expectedEntry = expectedEntries[index]
    if (actualEntry === undefined) {
      differences.push({ index, path: `entries[${index}]`, actual: '<missing>', expected: expectedEntry! })
      continue
    }
    if (expectedEntry === undefined) {
      differences.push({ index, id: actualEntry.id, path: `entries[${index}]`, actual: actualEntry, expected: '<missing>' })
      continue
    }
    for (const name of ID_FIELDS) {
      if (!field(actualEntry[name], expectedEntry[name])) {
        differences.push({
          index,
          id: actualEntry.id,
          path: `entries[${index}].${name}`,
          actual: actualEntry[name],
          expected: expectedEntry[name],
        })
      }
    }
  }

  return { equal: differences.length === 0, differences }
}