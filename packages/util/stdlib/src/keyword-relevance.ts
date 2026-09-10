/**
 * Keyword relevance scoring — tokenize a search keyword and score how much a
 * chunk of content matches it.
 *
 * Ported from clowder-ai `api/src/utils/keyword-relevance.ts` (F148 Phase B).
 * Replaces a naive `.includes()` with tokenized term matching + a 0..1 score.
 */

/** Split a keyword string into lowercase search terms. */
export function tokenizeKeyword(keyword: string): string[] {
  return keyword
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

/**
 * Score how relevant `content` is to the given search terms.
 * Returns a value between 0 (no match) and 1 (all terms matched).
 */
export function scoreKeywordRelevance(content: string, terms: string[]): number {
  if (terms.length === 0) return 0
  const lower = content.toLowerCase()
  const matched = terms.filter((t) => lower.includes(t)).length
  return matched / terms.length
}