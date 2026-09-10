import type { CloudSegment } from './cloud-bridge-types.ts'

/**
 * Derive a short summary from a cloud response's segments. Pure helper so the
 * bridge stays testable without string-heavy orchestration.
 */
export function deriveSummary(segments: CloudSegment[], maxTextLength = 400): string {
  const texts: string[] = []
  let length = 0
  for (const seg of segments) {
    if (seg.kind !== 'text') continue
    const snippet = collapseWhitespace(seg.content)
    const remaining = maxTextLength - length
    if (remaining <= 0) break
    const take = snippet.length > remaining ? `${snippet.slice(0, remaining - 1)}…` : snippet
    texts.push(take)
    length += take.length
  }
  return texts.join(' ')
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}