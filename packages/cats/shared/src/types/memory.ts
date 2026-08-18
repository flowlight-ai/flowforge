/**
 * Explicit per-thread key-value memory store types.
 * Part of F3-lite feature for Phase 4.0.
 */

import type { CatId } from './ids.ts';

/**
 * A single memory entry stored per-thread.
 */
export interface MemoryEntry {
  readonly key: string;
  readonly value: string;
  readonly threadId: string;
  readonly updatedBy: CatId | 'user';
  readonly updatedAt: number;
}

/**
 * Input for creating/updating a memory entry.
 */
export interface MemoryInput {
  readonly threadId: string;
  readonly key: string;
  readonly value: string;
  readonly updatedBy: CatId | 'user';
}
