/**
 * Session transcript pagination + view envelope + search schema (pure; F24).
 *
 * Rebuilds `session-transcript-route-helpers.ts` + the pagination/type-envelope
 * semantics of `session-transcript.ts`.
 */

import { z } from 'zod';
import { VALID_TRANSCRIPT_VIEWS } from '../contract/messages.ts';

/** Strict integer parse: only pure decimal digit strings (no whitespace). */
export function strictParseTranscriptInteger(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

export const transcriptSearchSchema = z.object({
  q: z.string().min(1).max(500),
  cats: z.string().optional(),
  sessionIds: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  scope: z.enum(['digests', 'transcripts', 'both']).optional(),
});

export function checkTranscriptCatAccess(
  headers: Record<string, string | undefined>,
  sessionCatId: string,
): string | null {
  const callerCatId = headers['x-cat-id'];
  return callerCatId && sessionCatId !== callerCatId ? 'Access denied: session belongs to a different cat' : null;
}

export interface TranscriptEvent {
  id: string;
  seq: number;
  ts: number;
  type: string;
  payload: Record<string, any>;
}

export interface TranscriptPage {
  events: TranscriptEvent[];
  nextCursor: string | null;
  hasMore: boolean;
  count: number;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export function cursorOf(event: { seq: number }): string {
  return String(event.seq);
}

/**
 * Paginate a time-ordered event list by numeric cursor (strict decimal).
 * Returns an envelope carrying events + nextCursor + hasMore.
 */
export function paginateTranscriptEvents(
  events: TranscriptEvent[],
  opts: { limit?: number; cursor?: string | null },
): TranscriptPage {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  let start = 0;
  if (opts.cursor) {
    const parsed = strictParseTranscriptInteger(opts.cursor);
    if (Number.isInteger(parsed)) {
      start = events.findIndex((e) => e.seq >= parsed);
      if (start === -1) start = events.length;
    }
  }
  const slice = events.slice(start, start + limit);
  const hasMore = start + slice.length < events.length;
  return {
    events: slice,
    nextCursor: hasMore && slice.length > 0 ? cursorOf(slice[slice.length - 1] as TranscriptEvent) : null,
    hasMore,
    count: slice.length,
  };
}

/** Type-envelope guard: any requested view must be a member of VALID_TRANSCRIPT_VIEWS. */
export function normalizeTranscriptView(view: string | undefined, fallback: string = 'raw'): string {
  if (!view) return fallback;
  return VALID_TRANSCRIPT_VIEWS.has(view) ? view : fallback;
}