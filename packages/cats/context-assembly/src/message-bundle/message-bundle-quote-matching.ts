/**
 * Quote anchoring for Message Bundles (F294) — self-contained port of clowder
 * `message-bundle-quote-matching.ts`.
 *
 * - `resolveExactQuoteAnchor` — sources whose stored text *is* the rendered text.
 * - `resolveReadableQuoteAnchor` — Markdown planes where whitespace is normalized
 *   on both sides and client offsets are ignored (only uniqueness identifies the
 *   human's range).
 */

export type QuoteAnchorFailure = 'quote_mismatch' | 'ambiguous_quote';

export interface QuoteAnchor {
  selectionStart: number;
  selectionEnd: number;
}

interface NormalizedText {
  text: string;
  /** sourceOffsets[i] = offset in the original text of normalized character i. */
  sourceOffsets: number[];
}

const WHITESPACE = /\s/;

function normalize(input: string): NormalizedText {
  let text = '';
  const sourceOffsets: number[] = [];
  let pendingSpaceFrom = -1;

  for (let index = 0; index < input.length; index++) {
    const character = input[index] as string;
    if (WHITESPACE.test(character)) {
      if (text.length > 0 && pendingSpaceFrom === -1) pendingSpaceFrom = index;
      continue;
    }
    if (pendingSpaceFrom !== -1) {
      text += ' ';
      sourceOffsets.push(pendingSpaceFrom);
      pendingSpaceFrom = -1;
    }
    text += character;
    sourceOffsets.push(index);
  }

  return { text, sourceOffsets };
}

function allMatchIndexes(haystack: string, needle: string): number[] {
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;
    matches.push(index);
    cursor = index + 1;
  }
  return matches;
}

function verifiedCoordinates(
  item: { text: string; selectionStart?: number; selectionEnd?: number },
  projection: string,
): QuoteAnchor | null {
  if (item.selectionStart === undefined || item.selectionEnd === undefined) return null;
  if (projection.slice(item.selectionStart, item.selectionEnd) !== item.text) return null;
  return { selectionStart: item.selectionStart, selectionEnd: item.selectionEnd };
}

export function resolveExactQuoteAnchor(
  item: { text: string; selectionStart?: number; selectionEnd?: number },
  projection: string,
): QuoteAnchor | QuoteAnchorFailure {
  const verified = verifiedCoordinates(item, projection);
  if (verified) return verified;
  if (item.text.length === 0) return 'quote_mismatch';

  const matches = allMatchIndexes(projection, item.text);
  if (matches.length === 0) return 'quote_mismatch';
  if (matches.length > 1) return 'ambiguous_quote';
  const selectionStart = matches[0];
  if (selectionStart === undefined) return 'quote_mismatch';
  return { selectionStart, selectionEnd: selectionStart + item.text.length };
}

export function resolveReadableQuoteAnchor(
  item: { text: string },
  projection: string,
): QuoteAnchor | QuoteAnchorFailure {
  const normalizedProjection = normalize(projection);
  const normalizedQuote = normalize(item.text);
  if (normalizedQuote.text.length === 0) return 'quote_mismatch';

  const matches = allMatchIndexes(normalizedProjection.text, normalizedQuote.text);
  if (matches.length === 0) return 'quote_mismatch';
  if (matches.length > 1) return 'ambiguous_quote';

  const matchIndex = matches[0];
  if (matchIndex === undefined) return 'quote_mismatch';
  const selectionStart = normalizedProjection.sourceOffsets[matchIndex];
  const lastOffset = normalizedProjection.sourceOffsets[matchIndex + normalizedQuote.text.length - 1];
  if (selectionStart === undefined || lastOffset === undefined) return 'quote_mismatch';
  return { selectionStart, selectionEnd: lastOffset + 1 };
}