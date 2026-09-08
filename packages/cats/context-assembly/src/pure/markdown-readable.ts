/**
 * Markdown → readable-text projection (self-contained port of clowder
 * `markdown-readable-text.ts`, F294 quote plane v2).
 *
 * The browser lets a human select characters from *rendered* Markdown while the
 * server stores *raw* Markdown. These are two different character planes, so
 * validating a browser selection against raw Markdown rejects every quote that
 * crosses a heading, bold run, inline code, link or blockquote.
 *
 * Design rules (kept from the original):
 *  1. Preserve what is not understood — unknown constructs fall back to their raw
 *     source slice (extra text is the safe direction: it can only cause a refused
 *     or ambiguous quote, never a mis-anchored one).
 *  2. Some renderer output has NO source counterpart — footnote labels, KaTeX
 *     glyphs. Those nodes are reported by `findGeneratedTextConstructs`, and the
 *     caller must refuse to anchor a quote from such a message.
 *
 * clowder relies on remark/unified; this package ships a dependency-free,
 * deterministic parser covering the common block/inline constructs.
 */

// ── Generated-text construct detection ──────────────────────────────────

/** Delimiters the chat renderer normalizes into math before parsing. */
const NORMALIZED_MATH_DELIMITERS = /\\\[|\\\(/;

export function findGeneratedTextConstructs(markdown: string): string[] {
  const found = new Set<string>();
  if (/\$\$[\s\S]*?\$\$/.test(markdown)) found.add('math');
  if (/\$[^$\n]+?\$/.test(markdown)) found.add('inlineMath');
  if (NORMALIZED_MATH_DELIMITERS.test(markdown)) found.add('math');
  if (/\[\^[^\]]+\]/.test(markdown)) found.add('footnoteReference');
  return [...found].sort();
}

// ── Inline projection ───────────────────────────────────────────────────

/**
 * Project inline Markdown constructs to readable text.
 * Unknown constructs fall back to their raw source (safe over-approximation).
 */
export function projectInline(source: string): string {
  let out = '';
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i] as string;

    // Inline code span.
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end === -1) {
        out += ch;
        i += 1;
      } else {
        out += source.slice(i + 1, end);
        i = end + 1;
      }
      continue;
    }

    // Display math $$...$$ → generated glyph; emit nothing.
    if (ch === '$' && source[i + 1] === '$') {
      const end = source.indexOf('$$', i + 2);
      if (end !== -1) {
        i = end + 2;
      } else {
        out += ch;
        i += 1;
      }
      continue;
    }

    // Inline math $...$ → generated glyph; emit nothing.
    if (ch === '$') {
      const end = source.indexOf('$', i + 1);
      if (end !== -1 && end > i + 1 && !source.slice(i + 1, end).includes('\n')) {
        i = end + 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // Footnote reference [^n] → generated label; emit nothing.
    if (ch === '[' && source[i + 1] === '^') {
      const close = source.indexOf(']', i + 2);
      if (close !== -1) {
        i = close + 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // Image ![alt](url) → alt text.
    if (ch === '!' && source[i + 1] === '[') {
      const closeBracket = source.indexOf(']', i + 2);
      if (closeBracket !== -1 && source[closeBracket + 1] === '(') {
        const closeParen = source.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          out += projectInline(source.slice(i + 2, closeBracket));
          i = closeParen + 1;
          continue;
        }
      }
      out += ch;
      i += 1;
      continue;
    }

    // Footnote *definition* marker `[^n]: rest` → emit rest (block-scoped too).
    if (ch === '[' && source[i + 1] === '^') {
      // handled above; unreachable.
    }

    // Link [text](url) or [text][ref].
    if (ch === '[') {
      const closeBracket = source.indexOf(']', i + 1);
      if (closeBracket !== -1) {
        const after = source[closeBracket + 1];
        const inner = source.slice(i + 1, closeBracket);
        if (after === '(') {
          const closeParen = source.indexOf(')', closeBracket + 2);
          if (closeParen !== -1) {
            out += projectInline(inner);
            i = closeParen + 1;
            continue;
          }
        } else if (after === '[') {
          const closeRef = source.indexOf(']', closeBracket + 2);
          if (closeRef !== -1) {
            out += projectInline(inner);
            i = closeRef + 1;
            continue;
          }
        }
      }
      out += ch;
      i += 1;
      continue;
    }

    // Bold **x** / __x__ (also ***x*** → inner emphasis then bold marker overlap;
    // treat the 2-char marker as the closer).
    if ((ch === '*' && source[i + 1] === '*') || (ch === '_' && source[i + 1] === '_')) {
      const marker = ch + ch;
      const close = findMarkerClose(source, i + 2, marker);
      if (close !== -1) {
        out += projectInline(source.slice(i + 2, close));
        i = close + 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // Emphasis *x* / _x_.
    if (ch === '*' || ch === '_') {
      // Avoid treating `~`-adjacent or already-consumed asterisks as emphasis.
      const close = findSingleMarkerClose(source, i + 1, ch);
      if (close !== -1) {
        out += projectInline(source.slice(i + 1, close));
        i = close + 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // Delete ~~x~~.
    if (ch === '~' && source[i + 1] === '~') {
      const close = findMarkerClose(source, i + 2, '~~');
      if (close !== -1) {
        out += projectInline(source.slice(i + 2, close));
        i = close + 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // Escape.
    if (ch === '\\') {
      const next = source[i + 1];
      if (next !== undefined && next !== '\n') {
        out += next;
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // Autolink <url>.
    if (ch === '<') {
      const close = source.indexOf('>', i + 1);
      if (close !== -1 && close - i <= 2048) {
        out += source.slice(i + 1, close);
        i = close + 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function findMarkerClose(source: string, from: number, marker: string): number {
  let i = from;
  while (i < source.length) {
    const idx = source.indexOf(marker, i);
    if (idx === -1) return -1;
    // Ensure the marker isn't part of a longer run (***, ~~~).
    const prev = idx === 0 ? '' : source[idx - 1];
    if (prev !== source[idx]) return idx;
    i = idx + 1;
  }
  return -1;
}

function findSingleMarkerClose(source: string, from: number, marker: string): number {
  let i = from;
  while (i < source.length) {
    const idx = source.indexOf(marker, i);
    if (idx === -1) return -1;
    const prev = source[idx - 1];
    const next = source[idx + 1];
    // Must be a single, non-spaced, non-pair-occurrence marker (word boundary).
    if (prev !== undefined && prev === marker) {
      i = idx + 1;
      continue;
    }
    if (next !== undefined && next === marker) {
      i = idx + 1;
      continue;
    }
    if (prev === ' ' || mutatesBoundary(prev) || mutatesBoundary(next)) {
      i = idx + 1;
      continue;
    }
    if (source.slice(from, idx).trim().length === 0) {
      i = idx + 1;
      continue;
    }
    return idx;
  }
  return -1;
}

function mutatesBoundary(ch?: string): boolean {
  if (ch === undefined) return false;
  return /\s/.test(ch) || /[`*_{}[\]().#]/.test(ch);
}

// ── Block projection ────────────────────────────────────────────────────

function isFenceStart(line: string): string | null {
  const m = line.match(/^\s*(```|~~~)/);
  return m ? m[1] ?? null : null;
}

function renderBlocks(lines: string[]): string {
  const parts: string[] = [];
  let i = 0;

  const pushParagraph = (buffer: string[]) => {
    const joined = buffer.filter((s) => s !== undefined).join(' ').trim();
    if (joined) parts.push(joined);
  };

  while (i < lines.length) {
    const line = lines[i] as string;
    const trimmed = line.trim();

    // Blank lines are paragraph terminators, not tokens — skip them so the loop
    // always advances (an unconsumed blank line would otherwise spin forever).
    if (trimmed === '') {
      i += 1;
      continue;
    }

    const fence = isFenceStart(line);
    if (fence) {
      const closing = fence;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !(lines[j] as string).trim().startsWith(closing)) {
        body.push(lines[j] as string);
        j += 1;
      }
      parts.push(body.join('\n'));
      i = j + 1;
      continue;
    }

    if (/^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith('>')) {
        body.push((lines[i] as string).trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const nested = renderBlocks(body);
      if (nested) parts.push(nested);
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = (lines[i] as string).trim();
        if (/^([-*+]|\d+[.)])\s+/.test(cur)) {
          const rest = cur.replace(/^([-*+]|\d+[.)])\s+/, '');
          if (rest) items.push(projectInline(rest));
          i += 1;
        } else if (/^ {2,}/.test(lines[i] as string) || cur === '') {
          i += 1;
        } else {
          break;
        }
      }
      if (items.length > 0) parts.push(items.join('\n'));
      continue;
    }

    if (trimmed.startsWith('|') && looksLikeTable(lines, i)) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith('|')) {
        const cells = (lines[i] as string)
          .split('|')
          .slice(1, -1)
          .map((c) => projectInline(c.trim()));
        if (!cells.some((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')))) {
          rows.push(cells.join(' '));
        }
        i += 1;
      }
      if (rows.length > 0) parts.push(rows.join('\n\n'));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      parts.push(projectInline(heading[2] ?? ''));
      i += 1;
      continue;
    }

    const foot = trimmed.match(/^\[\^[^\]]+\]:\s*(.*)$/);
    if (foot) {
      const content = foot[1] ?? '';
      if (content) parts.push(projectInline(content));
      i += 1;
      continue;
    }

    if (trimmed.startsWith('<')) {
      parts.push(trimmed);
      i += 1;
      continue;
    }

    // Paragraph accumulation.
    const buffer: string[] = [];
    while (i < lines.length) {
      const t = (lines[i] as string).trim();
      if (
        t === '' ||
        isFenceStart(lines[i] as string) !== null ||
        t.startsWith('>') ||
        t.startsWith('#') ||
        /^\s*([-*+]|\d+[.)])\s+/.test(t) ||
        /^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/.test(t)
      ) {
        break;
      }
      buffer.push(projectInline(t));
      i += 1;
    }
    pushParagraph(buffer);
  }

  return parts.filter((p) => p.trim().length > 0).join('\n\n');
}

function looksLikeTable(lines: string[], index: number): boolean {
  const next = lines[index + 1];
  if (!next || !next.trim().startsWith('|')) return false;
  const cells = next
    .split('|')
    .slice(1, -1)
    .map((c) => c.replace(/\s/g, ''));
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

/** Project raw Markdown into the visible characters a renderer produces. */
export function projectMarkdownReadableText(markdown: string): string {
  return renderBlocks(markdown.split('\n'));
}