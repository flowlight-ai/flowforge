/**
 * NDJSON 流解析 — 本地化自 clowder-ai `src/utils/ndjson-parser.ts`。
 * 将 Node.js Readable 流逐行解析为 JSON 对象；空行跳过，解析失败产出 ParseError 哨兵。
 *
 * @module @flowforge/terminal/cli/ndjson-parser
 */

import type { Readable } from 'node:stream';

const SKIP_RECORD = Symbol('skip-record');

/** Sentinel object for JSON parse errors */
interface ParseError {
  readonly __parseError: true;
  readonly line: string;
  readonly error: string;
}

/** Parse a Readable stream of NDJSON into an async iterable of parsed objects */
export async function* parseNDJSON(stream: Readable): AsyncGenerator<unknown> {
  stream.setEncoding('utf8');
  let pending = '';

  const parseRecord = (line: string): unknown | typeof SKIP_RECORD => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return SKIP_RECORD;

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return {
        __parseError: true,
        line: trimmed,
        error: 'Failed to parse JSON line',
      } satisfies ParseError as unknown;
    }
  };

  for await (const chunk of stream) {
    if (typeof chunk !== 'string') throw new TypeError('NDJSON stream emitted a non-text chunk after UTF-8 decoding');
    pending += chunk;

    let newlineIndex = pending.indexOf('\n');
    while (newlineIndex !== -1) {
      const recordEnd = newlineIndex > 0 && pending[newlineIndex - 1] === '\r' ? newlineIndex - 1 : newlineIndex;
      const parsed = parseRecord(pending.slice(0, recordEnd));
      if (parsed !== SKIP_RECORD) yield parsed;
      pending = pending.slice(newlineIndex + 1);
      newlineIndex = pending.indexOf('\n');
    }
  }

  const finalRecord = parseRecord(pending);
  if (finalRecord !== SKIP_RECORD) yield finalRecord;
}

/** Type guard for NDJSON parse error objects */
export function isParseError(value: unknown): value is ParseError {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__parseError' in value &&
    (value as Record<string, unknown>).__parseError === true
  );
}
